import type { ScoreFingeringPage } from "./useScoreFingerings";

export function ScoreFingeringStatus({ pages, canRegenerate, onRegenerate }: {
  pages: Readonly<Record<number, ScoreFingeringPage>>; canRegenerate: boolean; onRegenerate: (index: number) => void;
}) {
  if (!Object.keys(pages).length) return <>Preparing layout…</>;
  return <>{Object.entries(pages).map(([index, page]) => <span key={index}>
    {` Page ${Number(index) + 1}: `}{page.layout
      ? `${page.layout.placed.reduce((sum, label) => sum + label.request.digits.length, 0)} digits after exclusions; unsupported/crowded notes omitted`
      : page.status}{" "}
    {!page.layout && page.status.toLowerCase().includes("regenerate this page") ? <button type="button"
      disabled={!canRegenerate} onClick={() => onRegenerate(Number(index))}>Regenerate page {Number(index) + 1}</button> : null}
  </span>)}</>;
}
