import { boxesOverlap, FINGERING_FONT, type FingeringLayout } from "./fingeringLayout";
import type { VisualBBox } from "./types";

/** Inspection takes priority without ever moving a precomputed annotation. */
export function ScoreFingeringLayer({ layout, reserved = [] }: {
  layout?: FingeringLayout; reserved?: readonly VisualBBox[];
}) {
  return <g className="score-fingerings" pointerEvents="none" aria-hidden="true"
    fill="#174bb5" fontFamily={FINGERING_FONT} textAnchor="middle">
    {layout?.placed.filter(label => !reserved.some(box => boxesOverlap(label.bounds, box)))
      .map(label => <g key={label.request.id}>
        {label.request.digits.map((digit, index) => <text key={digit.documentId}
          data-fingering-note={digit.documentId} x={label.x} y={label.baselines[index]}
          fontSize={label.fontSize}>{digit.value.finger}</text>)}
      </g>)}
  </g>;
}
