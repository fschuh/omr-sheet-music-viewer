import type { LayoutModel, PageFormat } from "../model/layout";
import type { ScoreModel } from "../model/score";

/**
 * The score's pages. For now a page holds everything up to the next encoded page break;
 * a page break before the first measure starts no extra page.
 */
export function layoutPages(score: ScoreModel, format: PageFormat): LayoutModel {
  const pageCount = 1 + score.measures.slice(1).filter((measure) => measure.newPage).length;
  return {
    format,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      index,
      width: format.width,
      height: format.height,
    })),
  };
}
