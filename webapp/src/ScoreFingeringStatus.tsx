import type { ScoreFingeringPage } from "./useScoreFingerings";

/**
 * One line per page, plus a regeneration button only where regenerating can help.
 *
 * The offer is driven by the classified action rather than by matching words in
 * the status line: a page whose geometry the producer examined and refused would
 * come back identical, so inviting a retry there is an invitation to a loop.
 */
export function ScoreFingeringStatus({ pages, canRegenerate, onRegenerate }: {
  pages: Readonly<Record<number, ScoreFingeringPage>>; canRegenerate: boolean; onRegenerate: (index: number) => void;
}) {
  if (!Object.keys(pages).length) return <>Preparing layout…</>;
  return <>{Object.entries(pages).map(([index, page]) => <span key={index}>
    {` Page ${Number(index) + 1}: `}{page.layout
      ? `${page.layout.placed.reduce((sum, label) => sum + label.request.digits.length, 0)} digits after exclusions; unsupported/crowded notes omitted`
      : page.status}
    {!page.layout && page.detail ? <span className="fingering-status-detail" title={page.detail}>{` (${page.detail})`}</span> : null}{" "}
    {!page.layout && page.action === "regenerate" ? <button type="button"
      disabled={!canRegenerate} onClick={() => onRegenerate(Number(index))}>Regenerate page {Number(index) + 1}</button> : null}
  </span>)}</>;
}
