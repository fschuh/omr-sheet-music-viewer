import type { LoadedDocument } from "../../types";
import type { LayoutModel } from "../model/layout";

export interface ScoreFileInfo {
  path: string;
  name: string;
  scoreDataPath: string;
}

/** A laid-out score as a viewer document: every page is complete as soon as it opens. */
export function musicXmlLoadedDocument(
  jobId: string,
  file: ScoreFileInfo,
  layout: LayoutModel,
  documentMusicXml: string,
): LoadedDocument {
  return {
    jobId,
    name: file.name,
    pageCount: layout.pages.length,
    source: { kind: "musicxml", sourcePath: file.path, scoreDataPath: file.scoreDataPath },
    documentMusicXml,
    fingeringStatus: "pending",
    status: "complete",
    pages: layout.pages.map((page) => ({
      index: page.index,
      status: "complete",
      width: page.width,
      height: page.height,
      surface: page,
    })),
  };
}
