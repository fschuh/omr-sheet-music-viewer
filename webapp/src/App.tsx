import { useMemo, useState } from "react";
import { SheetViewer } from "./SheetViewer";
import type { Sidecar, SidecarNote, VisualGroup } from "./types";

const SAMPLE_IMAGE_URL = "/sample/mario castle.png";
const SAMPLE_XML_URL = "/sample/mario castle.musicxml";
const SAMPLE_SIDECAR_URL = "/sample/mario castle.homr.json";

interface LoadedFiles {
  imageUrl: string;
  imageName: string;
  musicXml: string;
  musicXmlName: string;
  sidecar: Sidecar;
  sidecarName: string;
}

function noteSummary(notes: SidecarNote[]): string {
  if (notes.length === 0) {
    return "No linked MusicXML notes";
  }

  return notes
    .map((note) => {
      const pitch = note.pitch ?? "rest";
      return `${pitch}, ${note.duration}, measure ${note.measure}`;
    })
    .join(" / ");
}

function readFileAsText(file: File): Promise<string> {
  return file.text();
}

function readFileAsObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

async function loadSample(): Promise<LoadedFiles> {
  const [xmlResponse, sidecarResponse] = await Promise.all([
    fetch(SAMPLE_XML_URL),
    fetch(SAMPLE_SIDECAR_URL),
  ]);
  if (!xmlResponse.ok || !sidecarResponse.ok) {
    throw new Error("Failed to load sample files from the Vite dev server.");
  }

  return {
    imageUrl: SAMPLE_IMAGE_URL,
    imageName: "mario castle.png",
    musicXml: await xmlResponse.text(),
    musicXmlName: "mario castle.musicxml",
    sidecar: (await sidecarResponse.json()) as Sidecar,
    sidecarName: "mario castle.homr.json",
  };
}

export function App() {
  const [files, setFiles] = useState<LoadedFiles | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [highlightAllNotes, setHighlightAllNotes] = useState(false);
  const [showOriginalNoteheadContours, setShowOriginalNoteheadContours] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () =>
      files?.sidecar.visual_groups.find((group) => group.visual_group_id === selectedGroupId) ??
      null,
    [files, selectedGroupId],
  );

  const notesByVisualGroup = useMemo(() => {
    const byGroup = new Map<string, SidecarNote[]>();
    if (!files) {
      return byGroup;
    }
    for (const note of files.sidecar.notes) {
      if (note.visual_group_id === null) {
        continue;
      }
      const notes = byGroup.get(note.visual_group_id) ?? [];
      notes.push(note);
      byGroup.set(note.visual_group_id, notes);
    }
    return byGroup;
  }, [files]);

  async function handleSampleLoad() {
    setError(null);
    try {
      setFiles(await loadSample());
      setSelectedGroupId(null);
      setHighlightAllNotes(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load sample files.");
    }
  }

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const selectedFiles = Array.from(event.target.files ?? []);
    const image = selectedFiles.find((file) => file.type.startsWith("image/"));
    const sidecar = selectedFiles.find((file) => file.name.endsWith(".homr.json"));
    const musicXml = selectedFiles.find(
      (file) => file.name.endsWith(".musicxml") || file.name.endsWith(".xml"),
    );

    if (!image || !sidecar || !musicXml) {
      setError("Select one image, one .musicxml file, and one .homr.json sidecar.");
      return;
    }

    try {
      const [musicXmlText, sidecarText] = await Promise.all([
        readFileAsText(musicXml),
        readFileAsText(sidecar),
      ]);
      setFiles({
        imageUrl: readFileAsObjectUrl(image),
        imageName: image.name,
        musicXml: musicXmlText,
        musicXmlName: musicXml.name,
        sidecar: JSON.parse(sidecarText) as Sidecar,
        sidecarName: sidecar.name,
      });
      setSelectedGroupId(null);
      setHighlightAllNotes(false);
      event.target.value = "";
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to read selected files.");
    }
  }

  function handleGroupSelect(group: VisualGroup | null) {
    setSelectedGroupId(group?.visual_group_id ?? null);
    setHighlightAllNotes(false);
  }

  function clearSelection() {
    setSelectedGroupId(null);
    setHighlightAllNotes(false);
  }

  function handleHighlightAllNotes() {
    setSelectedGroupId(null);
    setHighlightAllNotes(true);
  }

  const selectedNotes = selectedGroup
    ? notesByVisualGroup.get(selectedGroup.visual_group_id) ?? []
    : [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>HOMR Viewer</h1>
          <p>{files ? `${files.imageName} / ${files.musicXmlName} / ${files.sidecarName}` : ""}</p>
        </div>
        <div className="actions">
          <button type="button" onClick={handleSampleLoad}>
            Load sample
          </button>
          <label className="file-picker">
            Open files
            <input
              type="file"
              accept="image/*,.musicxml,.xml,.json"
              multiple
              onChange={handleFileSelection}
            />
          </label>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="workspace">
        {files ? (
          <>
            <SheetViewer
              imageUrl={files.imageUrl}
              sidecar={files.sidecar}
              selectedGroupId={selectedGroupId}
              highlightAllNotes={highlightAllNotes}
              showOriginalNoteheadContours={showOriginalNoteheadContours}
              onSelectGroup={handleGroupSelect}
            />
            <aside className="inspector">
              <h2>Display</h2>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showOriginalNoteheadContours}
                  onChange={(event) => setShowOriginalNoteheadContours(event.target.checked)}
                />
                Original notehead contours
              </label>
              <h2>Selection</h2>
              <button type="button" onClick={handleHighlightAllNotes}>
                Highlight all notes
              </button>
              {selectedGroup ? (
                <>
                  <dl>
                    <dt>Visual group</dt>
                    <dd>{selectedGroup.visual_group_id}</dd>
                    <dt>MusicXML IDs</dt>
                    <dd>{selectedGroup.musicxml_ids.join(", ") || "None"}</dd>
                    <dt>Notes</dt>
                    <dd>{noteSummary(selectedNotes)}</dd>
                  </dl>
                  <button type="button" onClick={clearSelection}>
                    Clear
                  </button>
                </>
              ) : highlightAllNotes ? (
                <>
                  <p>{files.sidecar.visual_groups.length.toLocaleString()} notes highlighted.</p>
                  <button type="button" onClick={clearSelection}>
                    Clear
                  </button>
                </>
              ) : (
                <p>Click a note or chord in the score.</p>
              )}
              <h2>Loaded Data</h2>
              <dl>
                <dt>MusicXML size</dt>
                <dd>{files.musicXml.length.toLocaleString()} chars</dd>
                <dt>Visual groups</dt>
                <dd>{files.sidecar.visual_groups.length.toLocaleString()}</dd>
                <dt>Linked notes</dt>
                <dd>{files.sidecar.notes.length.toLocaleString()}</dd>
              </dl>
            </aside>
          </>
        ) : (
          <div className="empty-state">
            <h2>Open a sheet music image, MusicXML file, and HOMR sidecar.</h2>
            <p>Use the sample set or choose matching files from disk.</p>
          </div>
        )}
      </section>
    </main>
  );
}
