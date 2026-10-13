// The module's only access to the native bridge: reading the score file and its data
// folder. Nothing here writes the score file.
import {
  openScoreDataDirectory,
  openScoreSource,
  readMusicXmlScoreFile,
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
