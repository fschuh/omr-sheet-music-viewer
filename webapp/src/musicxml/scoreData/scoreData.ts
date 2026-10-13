// The module's only access to the native bridge: reading the score file, and reading and
// writing its data folder. Nothing here writes the score file.
import {
  openScoreDataDirectory,
  openScoreSource,
  readMusicXmlScoreFile,
  readScoreData,
  writeScoreData,
  type MusicXmlScoreFile,
} from "../../native";

export type { MusicXmlScoreFile };

export function readScoreFile(path: string): Promise<MusicXmlScoreFile> {
  return readMusicXmlScoreFile(path);
}

/** Shows the score's data folder in the system file manager. */
export function showScoreDataFolder(scoreDataPath: string): Promise<void> {
  return openScoreDataDirectory(scoreDataPath);
}

/** Opens the original score file with the system's default application. */
export function showScoreSource(sourcePath: string): Promise<void> {
  return openScoreSource(sourcePath);
}

/** Reads and writes the files of one score's data folder. */
export interface ScoreDataStore {
  read(name: string): Promise<string | null>;
  write(name: string, contents: string): Promise<void>;
}

export function scoreDataStore(scoreDataPath: string): ScoreDataStore {
  return {
    read: (name) => readScoreData(scoreDataPath, name),
    write: (name, contents) => writeScoreData(scoreDataPath, name, contents),
  };
}
