// MusicXML text to the score model. This is the only part of the module that reads XML.
import { DOMParser } from "@xmldom/xmldom";
import type { MeasureModel, ScoreDefaults, ScoreModel } from "../model/score";

export class MusicXmlImportError extends Error {
  override name = "MusicXmlImportError";
}

function childElements(parent: Element, name: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (node as Element).localName === name,
  );
}

function childElement(parent: Element, name: string): Element | undefined {
  return childElements(parent, name)[0];
}

/** A child's positive number, or null when it is missing or not a positive number. */
function positiveNumber(parent: Element | undefined, name: string): number | null {
  const text = parent ? childElement(parent, name)?.textContent?.trim() : undefined;
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDefaults(root: Element): ScoreDefaults {
  const defaults = childElement(root, "defaults");
  const scaling = defaults ? childElement(defaults, "scaling") : undefined;
  const millimeters = positiveNumber(scaling, "millimeters");
  const tenths = positiveNumber(scaling, "tenths");
  const pageLayout = defaults ? childElement(defaults, "page-layout") : undefined;
  const width = positiveNumber(pageLayout, "page-width");
  const height = positiveNumber(pageLayout, "page-height");
  return {
    scaling: millimeters !== null && tenths !== null ? { millimeters, tenths } : null,
    pageSize: width !== null && height !== null ? { width, height } : null,
  };
}

function asksForNewPage(measure: Element): boolean {
  return childElements(measure, "print").some((print) => print.getAttribute("new-page") === "yes");
}

/** Measures by position. A partwise score lists them per part, a timewise score per measure. */
function parseMeasures(root: Element): MeasureModel[] {
  const measures: MeasureModel[] = [];
  const add = (position: number, measure: Element) => {
    measures[position] ??= { newPage: false };
    if (asksForNewPage(measure)) measures[position].newPage = true;
  };
  if (root.localName === "score-partwise") {
    for (const part of childElements(root, "part")) {
      childElements(part, "measure").forEach((measure, position) => add(position, measure));
    }
  } else {
    childElements(root, "measure").forEach((measure, position) => {
      measures[position] ??= { newPage: false };
      for (const part of childElements(measure, "part")) add(position, part);
    });
  }
  return measures;
}

export function parseMusicXml(text: string): ScoreModel {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (message: string) => errors.push(message),
      fatalError: (message: string) => errors.push(message),
    },
  }).parseFromString(text, "application/xml") as unknown as Document | undefined;
  const root = document?.documentElement;
  if (errors.length > 0 || !root) {
    throw new MusicXmlImportError(`The score is not well-formed XML${errors[0] ? `: ${errors[0].trim()}` : ""}`);
  }
  if (root.localName !== "score-partwise" && root.localName !== "score-timewise") {
    throw new MusicXmlImportError("The file is not a MusicXML score");
  }
  return { defaults: parseDefaults(root), measures: parseMeasures(root) };
}
