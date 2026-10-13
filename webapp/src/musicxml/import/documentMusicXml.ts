// The document MusicXML: an in-memory copy of the score that playback reads, as it reads a
// recognized PDF's merged MusicXML. Every note's `id` is its viewer ID, the page breaks are
// the viewer's own pages, and a timewise score becomes partwise. The source file is never
// written.
import { XMLSerializer } from "@xmldom/xmldom";
import type { ImportedScore, PartSource } from "./parseMusicXml";

function childElements(parent: Element, name: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (node as Element).localName === name,
  );
}

/** Rebuilds a timewise score as partwise, moving each part's measure content into place. */
function partwiseRoot(imported: ImportedScore): { root: Element; measures: Element[][] } {
  const { root } = imported;
  if (root.localName === "score-partwise") {
    return { root, measures: imported.parts.map((part) => part.measures.map((measure) => measure.content)) };
  }
  const document = root.ownerDocument;
  const partwise = document.createElement("score-partwise");
  const version = root.getAttribute("version");
  if (version) partwise.setAttribute("version", version);
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== 1 || (child as Element).localName !== "measure") partwise.appendChild(child.cloneNode(true));
  }
  const timewiseMeasures = childElements(root, "measure");
  const measures = imported.parts.map((source: PartSource) => {
    const part = document.createElement("part");
    part.setAttribute("id", source.id);
    partwise.appendChild(part);
    return timewiseMeasures.map((timewise, position) => {
      const measure = document.createElement("measure");
      for (const attribute of Array.from(timewise.attributes)) measure.setAttribute(attribute.name, attribute.value);
      const content = source.measures[position]?.content;
      // Moving the children keeps the note elements the import recorded.
      if (content) for (const child of Array.from(content.childNodes)) measure.appendChild(child);
      part.appendChild(measure);
      return measure;
    });
  });
  document.replaceChild(partwise, root);
  // A timewise doctype would contradict the new root.
  if (document.doctype) document.removeChild(document.doctype);
  return { root: partwise, measures };
}

/**
 * Writes the document MusicXML. `viewerIds` maps note keys to viewer IDs; `pageStarts` maps
 * the measure each page after the first starts with to that page's number.
 */
export function documentMusicXml(
  imported: ImportedScore,
  viewerIds: ReadonlyMap<string, string>,
  pageStarts: ReadonlyMap<number, number>,
): string {
  const { root, measures } = partwiseRoot(imported);
  // IDs the file brings are dropped, so every ID in the copy is a viewer ID.
  for (const note of Array.from(root.getElementsByTagName("note"))) note.removeAttribute("id");
  for (const [key, element] of imported.noteElements) {
    const id = viewerIds.get(key);
    if (id) element.setAttribute("id", id);
  }
  for (const partMeasures of measures) {
    partMeasures.forEach((measure, index) => {
      for (const print of childElements(measure, "print")) {
        print.removeAttribute("new-page");
        print.removeAttribute("page-number");
      }
      const page = pageStarts.get(index);
      if (page === undefined) return;
      let print = childElements(measure, "print")[0];
      if (!print) {
        print = measure.ownerDocument.createElement("print");
        measure.insertBefore(print, measure.firstChild);
      }
      print.setAttribute("new-page", "yes");
      print.setAttribute("page-number", String(page));
    });
  }
  return new XMLSerializer().serializeToString(root.ownerDocument);
}
