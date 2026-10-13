// Breaking measures into systems. A score that encodes its system breaks keeps them, as
// MuseScore does on import, and a system breaks early only when even its tightest spacing
// does not fit. Otherwise measures fill each system while it fits with springs at most
// a fifth tighter than natural, as MuseScore reduces stretch before breaking.
import {
  justify,
  NATURAL_SPACING,
  systemWidth,
  TIGHTEST_SPACING,
  type MeasureSpacing,
  type Spacing,
} from "./horizontal";

/** MuseScore's lastSystemFillLimit: a last system less full than this keeps natural spacing. */
const LAST_SYSTEM_FILL_LIMIT = 0.3;

export interface SystemPlan {
  /** Indexes of the system's measures. */
  measures: number[];
  spacing: Spacing;
}

/**
 * `breaks[i]` is true when the file asks for a system break before measure i;
 * `widthAt(i)` is the width available to a system that starts with measure i.
 */
export function breakSystems(
  spacings: MeasureSpacing[],
  breaks: boolean[],
  widthAt: (measureIndex: number) => number,
): SystemPlan[] {
  const encoded = breaks.some((value, index) => index > 0 && value);
  const plans: SystemPlan[] = [];
  let start = 0;
  while (start < spacings.length) {
    const width = widthAt(start);
    let end = start + 1;
    if (encoded) {
      while (end < spacings.length && !breaks[end]) end += 1;
      while (end - start > 1 && systemWidth(spacings.slice(start, end), TIGHTEST_SPACING) > width) end -= 1;
    } else {
      const fitting = { force: NATURAL_SPACING.force * 0.8, squeeze: 1 };
      while (end < spacings.length && systemWidth(spacings.slice(start, end + 1), fitting) <= width) {
        end += 1;
      }
    }
    const measures = spacings.slice(start, end);
    const isLast = end === spacings.length;
    const natural = systemWidth(measures, NATURAL_SPACING);
    const spacing =
      isLast && natural < width * LAST_SYSTEM_FILL_LIMIT ? NATURAL_SPACING : justify(measures, width);
    plans.push({ measures: measures.map((measure) => measure.measure.index), spacing });
    start = end;
  }
  return plans;
}
