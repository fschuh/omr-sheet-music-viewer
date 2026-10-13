import { memo } from "react";
import type { LayoutPage } from "../model/layout";

/** One engraved page as SVG, in page pixels like a PDF page's image. */
export const MusicXmlPageSurface = memo(function MusicXmlPageSurface({ page }: { page: LayoutPage }) {
  return (
    <svg
      className="musicxml-page"
      viewBox={`0 0 ${page.width} ${page.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Sheet music page ${page.index + 1}`}
    >
      <rect width={page.width} height={page.height} fill="#fff" />
    </svg>
  );
});
