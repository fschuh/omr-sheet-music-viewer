//! Opening MusicXML scores the user chooses, and the per-score data folders that hold what the
//! viewer adds to them. A source file is only ever read: everything the viewer stores for a
//! score lives in its data folder, `<app data>/musicxml-scores/<SHA-256 of the file>/`.

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Manager, State};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::open_with_system;

const SCORE_DATA_DIRECTORY: &str = "musicxml-scores";
const MANIFEST_SCHEMA_VERSION: u32 = 1;
/// Far above the largest score in the corpus (2.2 MB); bounds what a compressed file expands to.
const MAX_SCORE_XML_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ScoreFileFormat {
    /// Uncompressed `.musicxml` or `.xml`.
    MusicXml,
    /// Compressed `.mxl`: a zip archive whose `META-INF/container.xml` names the score.
    Mxl,
}

impl ScoreFileFormat {
    fn manifest_name(self) -> &'static str {
        match self {
            ScoreFileFormat::MusicXml => "musicxml",
            ScoreFileFormat::Mxl => "mxl",
        }
    }
}

pub(crate) fn score_file_format(path: &Path) -> Option<ScoreFileFormat> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "musicxml" | "xml" => Some(ScoreFileFormat::MusicXml),
        "mxl" => Some(ScoreFileFormat::Mxl),
        _ => None,
    }
}

/// MusicXML is UTF-8 or, from some exporters, UTF-16 with a byte-order mark.
fn decode_xml_text(bytes: Vec<u8>) -> Result<String, String> {
    let utf16 = |little_endian: bool| {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| {
                if little_endian {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| "The score is not valid UTF-16 text".to_string())
    };
    match bytes.as_slice() {
        [0xFF, 0xFE, ..] => utf16(true),
        [0xFE, 0xFF, ..] => utf16(false),
        [0xEF, 0xBB, 0xBF, rest @ ..] => {
            String::from_utf8(rest.to_vec()).map_err(|_| "The score is not valid UTF-8 text".into())
        }
        _ => String::from_utf8(bytes).map_err(|_| "The score is not valid UTF-8 text".into()),
    }
}

/// The name of the first element, skipping the declaration, comments and the doctype.
fn root_element_name(xml: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) | Ok(Event::Empty(element)) => {
                return Some(String::from_utf8_lossy(element.local_name().as_ref()).into_owned());
            }
            Ok(Event::Eof) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

fn check_score_root(xml: &str) -> Result<(), String> {
    match root_element_name(xml).as_deref() {
        Some("score-partwise" | "score-timewise") => Ok(()),
        _ => Err("The file is not a MusicXML score".into()),
    }
}

/// The score's path inside an `.mxl` archive: the first `rootfile` in `META-INF/container.xml`.
fn mxl_root_file(container: &str) -> Result<String, String> {
    let mut reader = Reader::from_str(container);
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) | Ok(Event::Empty(element))
                if element.local_name().as_ref() == b"rootfile" =>
            {
                for attribute in element.attributes().flatten() {
                    if attribute.key.local_name().as_ref() == b"full-path" {
                        return attribute
                            .unescape_value()
                            .map(|value| value.into_owned())
                            .map_err(|error| error.to_string());
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(format!(
                    "The compressed score's container is not valid XML: {error}"
                ))
            }
            Ok(_) => {}
        }
    }
    Err("The compressed score's container does not name a score file".into())
}

fn read_limited(reader: impl Read, max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err("The score is too large to open".into());
    }
    Ok(bytes)
}

fn read_mxl(archive: &[u8], max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|_| "The compressed score is not a valid .mxl archive".to_string())?;
    let container = {
        let entry = archive
            .by_name("META-INF/container.xml")
            .map_err(|_| "The compressed score has no META-INF/container.xml".to_string())?;
        decode_xml_text(read_limited(entry, max_bytes)?)?
    };
    let root = mxl_root_file(&container)?;
    let entry = archive
        .by_name(&root)
        .map_err(|_| format!("The compressed score does not contain {root}"))?;
    read_limited(entry, max_bytes)
}

/// The score's XML from file contents, checked to be a MusicXML score.
fn score_xml(format: ScoreFileFormat, contents: &[u8], max_bytes: u64) -> Result<String, String> {
    let xml_bytes = match format {
        ScoreFileFormat::MusicXml => {
            if contents.len() as u64 > max_bytes {
                return Err("The score is too large to open".into());
            }
            contents.to_vec()
        }
        ScoreFileFormat::Mxl => read_mxl(contents, max_bytes)?,
    };
    let xml = decode_xml_text(xml_bytes)?;
    check_score_root(&xml)?;
    Ok(xml)
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ScoreDataManifest {
    schema_version: u32,
    source_sha256: String,
    source_byte_length: u64,
    format: String,
    last_seen_path: String,
    last_seen_name: String,
    created_at: String,
    last_opened_at: String,
}

struct ScoreSource<'a> {
    path: &'a Path,
    sha256: &'a str,
    byte_length: u64,
    format: ScoreFileFormat,
}

fn write_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

/// Creates the score's data folder under `root` if needed and records this opening in its
/// manifest, keeping the date the folder was created.
fn ensure_score_data_folder(
    root: &Path,
    source: &ScoreSource,
    now: &str,
) -> Result<PathBuf, String> {
    let folder = root.join(source.sha256);
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let manifest_path = folder.join("manifest.json");
    let created_at = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|text| serde_json::from_str::<ScoreDataManifest>(&text).ok())
        .map(|manifest| manifest.created_at)
        .unwrap_or_else(|| now.to_string());
    let manifest = ScoreDataManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        source_sha256: source.sha256.to_string(),
        source_byte_length: source.byte_length,
        format: source.format.manifest_name().to_string(),
        last_seen_path: source.path.to_string_lossy().into_owned(),
        last_seen_name: source
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        created_at,
        last_opened_at: now.to_string(),
    };
    let text = serde_json::to_string(&manifest).map_err(|error| error.to_string())?;
    write_atomically(&manifest_path, &text)?;
    Ok(folder)
}

fn is_sha256_hex(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// `value` resolved, if it is an existing score data folder directly under `root`.
fn checked_score_data_folder(root: &Path, value: &str) -> Result<PathBuf, String> {
    let outside = || "The folder is not a score data folder".to_string();
    let root = root.canonicalize().map_err(|_| outside())?;
    let candidate = Path::new(value).canonicalize().map_err(|_| outside())?;
    let named_by_hash = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_sha256_hex);
    if candidate.parent() != Some(root.as_path()) || !named_by_hash || !candidate.is_dir() {
        return Err(outside());
    }
    Ok(candidate)
}

fn score_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(SCORE_DATA_DIRECTORY))
}

/// Source files opened in this session. Only these can be handed to the system's default
/// application, so the webview cannot open arbitrary files.
#[derive(Default)]
pub(crate) struct OpenedScores(Mutex<HashSet<PathBuf>>);

impl OpenedScores {
    fn insert(&self, path: PathBuf) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(path);
    }

    fn checked(&self, value: &str) -> Result<PathBuf, String> {
        let path = Path::new(value)
            .canonicalize()
            .map_err(|_| "The score file no longer exists".to_string())?;
        if !self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&path)
        {
            return Err("Only an opened score can be shown".into());
        }
        Ok(path)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedMusicXmlScore {
    path: String,
    name: String,
    music_xml: String,
    source_sha256: String,
    source_byte_length: u64,
    score_data_path: String,
}

#[tauri::command(async)]
pub(crate) fn open_music_xml_score(
    app: AppHandle,
    opened: State<'_, OpenedScores>,
    path: String,
) -> Result<OpenedMusicXmlScore, String> {
    let requested = PathBuf::from(&path);
    let format = score_file_format(&requested)
        .filter(|_| requested.is_file())
        .ok_or("Choose an existing .musicxml, .xml or .mxl file")?;
    let path = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let contents = fs::read(&path).map_err(|error| error.to_string())?;
    let music_xml = score_xml(format, &contents, MAX_SCORE_XML_BYTES)?;
    let sha256: String = Sha256::digest(&contents)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| error.to_string())?;
    let folder = ensure_score_data_folder(
        &score_data_root(&app)?,
        &ScoreSource {
            path: &path,
            sha256: &sha256,
            byte_length: contents.len() as u64,
            format,
        },
        &now,
    )?;
    opened.insert(path.clone());
    Ok(OpenedMusicXmlScore {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        music_xml,
        source_sha256: sha256,
        source_byte_length: contents.len() as u64,
        score_data_path: folder.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub(crate) fn open_score_source(
    opened: State<'_, OpenedScores>,
    path: String,
) -> Result<(), String> {
    open_with_system(&opened.checked(&path)?)
}

#[tauri::command]
pub(crate) fn open_score_data_directory(app: AppHandle, path: String) -> Result<(), String> {
    open_with_system(&checked_score_data_folder(&score_data_root(&app)?, &path)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    const PARTWISE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<!-- exported -->
<score-partwise version="4.0"><part-list/></score-partwise>"#;

    const CONTAINER: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles>
  <rootfile full-path="scores/score&amp;more.xml" media-type="application/vnd.recordare.musicxml+xml"/>
  <rootfile full-path="other.xml"/>
</rootfiles></container>"#;

    fn mxl(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn score_files_are_recognized_by_extension() {
        assert_eq!(
            score_file_format(Path::new("a.musicxml")),
            Some(ScoreFileFormat::MusicXml)
        );
        assert_eq!(
            score_file_format(Path::new("a.XML")),
            Some(ScoreFileFormat::MusicXml)
        );
        assert_eq!(
            score_file_format(Path::new("a.Mxl")),
            Some(ScoreFileFormat::Mxl)
        );
        assert_eq!(score_file_format(Path::new("a.pdf")), None);
        assert_eq!(score_file_format(Path::new("musicxml")), None);
    }

    #[test]
    fn text_is_decoded_from_utf8_and_utf16_with_byte_order_marks() {
        let utf16 = |little_endian: bool| {
            let mut bytes = if little_endian {
                vec![0xFF, 0xFE]
            } else {
                vec![0xFE, 0xFF]
            };
            for unit in "<a>é</a>".encode_utf16() {
                bytes.extend(if little_endian {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            bytes
        };
        assert_eq!(decode_xml_text(utf16(true)).unwrap(), "<a>é</a>");
        assert_eq!(decode_xml_text(utf16(false)).unwrap(), "<a>é</a>");
        assert_eq!(
            decode_xml_text(b"\xEF\xBB\xBF<a/>".to_vec()).unwrap(),
            "<a/>"
        );
        assert!(decode_xml_text(vec![b'<', 0xC3]).is_err());
    }

    #[test]
    fn only_partwise_and_timewise_roots_are_scores() {
        assert!(check_score_root(PARTWISE).is_ok());
        assert!(check_score_root("<score-timewise/>").is_ok());
        assert!(check_score_root("<?xml version='1.0'?><html><score-partwise/></html>").is_err());
        assert!(check_score_root("not xml at all").is_err());
        assert!(check_score_root("").is_err());
    }

    #[test]
    fn compressed_scores_are_read_through_their_container() {
        let archive = mxl(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("scores/score&more.xml", PARTWISE.as_bytes()),
            ("other.xml", b"<score-timewise/>"),
        ]);
        assert_eq!(
            score_xml(ScoreFileFormat::Mxl, &archive, 1 << 20).unwrap(),
            PARTWISE
        );
    }

    #[test]
    fn compressed_scores_without_a_usable_container_are_rejected() {
        let no_container = mxl(&[("score.xml", PARTWISE.as_bytes())]);
        assert!(score_xml(ScoreFileFormat::Mxl, &no_container, 1 << 20)
            .unwrap_err()
            .contains("container.xml"));
        let missing_root = mxl(&[("META-INF/container.xml", CONTAINER.as_bytes())]);
        assert!(score_xml(ScoreFileFormat::Mxl, &missing_root, 1 << 20)
            .unwrap_err()
            .contains("does not contain"));
        let unnamed = mxl(&[(
            "META-INF/container.xml",
            b"<container><rootfiles/></container>",
        )]);
        assert!(score_xml(ScoreFileFormat::Mxl, &unnamed, 1 << 20)
            .unwrap_err()
            .contains("does not name"));
        assert!(score_xml(ScoreFileFormat::Mxl, b"PK not a zip", 1 << 20).is_err());
    }

    #[test]
    fn a_compressed_file_that_is_not_a_score_is_rejected() {
        let archive = mxl(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("scores/score&more.xml", b"<html/>"),
        ]);
        assert!(score_xml(ScoreFileFormat::Mxl, &archive, 1 << 20).is_err());
    }

    #[test]
    fn scores_larger_than_the_limit_are_rejected() {
        let limit = PARTWISE.len() as u64 - 1;
        assert!(score_xml(ScoreFileFormat::MusicXml, PARTWISE.as_bytes(), limit).is_err());
        assert!(score_xml(ScoreFileFormat::MusicXml, PARTWISE.as_bytes(), limit + 1).is_ok());
        let archive = mxl(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("scores/score&more.xml", PARTWISE.as_bytes()),
        ]);
        assert!(score_xml(ScoreFileFormat::Mxl, &archive, limit)
            .unwrap_err()
            .contains("too large"));
    }

    fn source(path: &Path) -> ScoreSource<'_> {
        ScoreSource {
            path,
            sha256: "ab12",
            byte_length: 7,
            format: ScoreFileFormat::Mxl,
        }
    }

    fn manifest(folder: &Path) -> ScoreDataManifest {
        serde_json::from_str(&fs::read_to_string(folder.join("manifest.json")).unwrap()).unwrap()
    }

    #[test]
    fn the_manifest_keeps_its_creation_date_and_follows_the_file() {
        let root = tempfile::tempdir().unwrap();
        let folder =
            ensure_score_data_folder(root.path(), &source(Path::new("/scores/a.mxl")), "day-1")
                .unwrap();
        assert_eq!(folder, root.path().join("ab12"));
        ensure_score_data_folder(root.path(), &source(Path::new("/moved/b.mxl")), "day-2").unwrap();
        assert_eq!(
            manifest(&folder),
            ScoreDataManifest {
                schema_version: MANIFEST_SCHEMA_VERSION,
                source_sha256: "ab12".into(),
                source_byte_length: 7,
                format: "mxl".into(),
                last_seen_path: "/moved/b.mxl".into(),
                last_seen_name: "b.mxl".into(),
                created_at: "day-1".into(),
                last_opened_at: "day-2".into(),
            }
        );
    }

    #[test]
    fn an_unreadable_manifest_is_replaced() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("ab12")).unwrap();
        fs::write(root.path().join("ab12/manifest.json"), "{").unwrap();
        let folder =
            ensure_score_data_folder(root.path(), &source(Path::new("/a.mxl")), "day-2").unwrap();
        assert_eq!(manifest(&folder).created_at, "day-2");
    }

    #[test]
    fn only_hash_named_folders_directly_under_the_root_are_score_data_folders() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join(SCORE_DATA_DIRECTORY);
        let hash = "0123456789abcdef".repeat(4);
        let folder = root.join(&hash);
        fs::create_dir_all(folder.join(&hash)).unwrap();
        fs::create_dir_all(root.join("not-a-hash")).unwrap();
        fs::create_dir_all(root.join(hash.to_uppercase())).unwrap();
        fs::create_dir_all(base.path().join(&hash)).unwrap();
        fs::write(root.join("f".repeat(64)), "").unwrap();
        let check = |path: &Path| checked_score_data_folder(&root, path.to_str().unwrap());

        assert_eq!(check(&folder).unwrap(), folder.canonicalize().unwrap());
        assert!(check(&root.join(&hash).join("..").join(&hash)).is_ok());
        assert!(check(&root).is_err());
        assert!(check(&folder.join(&hash)).is_err());
        assert!(check(&root.join("not-a-hash")).is_err());
        assert!(check(&base.path().join(&hash)).is_err());
        assert!(check(&root.join("f".repeat(64))).is_err());
        assert!(check(&root.join(hash.to_uppercase())).is_err());
    }

    #[test]
    fn only_scores_opened_in_this_session_can_be_shown() {
        let directory = tempfile::tempdir().unwrap();
        let opened_path = directory.path().join("opened.musicxml");
        let other_path = directory.path().join("other.musicxml");
        fs::write(&opened_path, PARTWISE).unwrap();
        fs::write(&other_path, PARTWISE).unwrap();
        let opened = OpenedScores::default();
        opened.insert(opened_path.canonicalize().unwrap());

        let through_parent = directory.path().join(".").join("opened.musicxml");
        assert!(opened.checked(through_parent.to_str().unwrap()).is_ok());
        assert!(opened.checked(other_path.to_str().unwrap()).is_err());
        assert!(opened
            .checked(directory.path().join("gone.musicxml").to_str().unwrap())
            .is_err());
    }
}
