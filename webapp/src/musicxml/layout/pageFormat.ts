import type { PageFormat } from "../model/layout";
import type { ScoreDefaults } from "../model/score";

const PAGE_PIXELS_PER_MILLIMETER = 300 / 25.4;
/** Letter, MuseScore's default page in the United States. */
const DEFAULT_PAGE_MILLIMETERS = { width: 215.9, height: 279.4 };
/** MuseScore 4's default staff space and page margins. */
const DEFAULT_STAFF_SPACE_MILLIMETERS = 1.75;
const DEFAULT_MARGIN_MILLIMETERS = 15;
const TENTHS_PER_STAFF_SPACE = 10;

/** The page format a score asks for in `<defaults>`, with MuseScore's defaults for the rest. */
export function pageFormat(defaults: ScoreDefaults): PageFormat {
  const millimetersPerTenth = defaults.scaling
    ? defaults.scaling.millimeters / defaults.scaling.tenths
    : DEFAULT_STAFF_SPACE_MILLIMETERS / TENTHS_PER_STAFF_SPACE;
  const page = defaults.pageSize
    ? {
        width: defaults.pageSize.width * millimetersPerTenth,
        height: defaults.pageSize.height * millimetersPerTenth,
      }
    : DEFAULT_PAGE_MILLIMETERS;
  const margin = (tenths: number | undefined) =>
    (tenths === undefined ? DEFAULT_MARGIN_MILLIMETERS : tenths * millimetersPerTenth) * PAGE_PIXELS_PER_MILLIMETER;
  return {
    width: page.width * PAGE_PIXELS_PER_MILLIMETER,
    height: page.height * PAGE_PIXELS_PER_MILLIMETER,
    staffSpace: millimetersPerTenth * TENTHS_PER_STAFF_SPACE * PAGE_PIXELS_PER_MILLIMETER,
    margins: {
      left: margin(defaults.pageMargins?.left),
      right: margin(defaults.pageMargins?.right),
      top: margin(defaults.pageMargins?.top),
      bottom: margin(defaults.pageMargins?.bottom),
    },
  };
}
