import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentViewer } from "./DocumentViewer";
import type { PlaybackMoment } from "./playback";
import type { DocumentPage, VisualGroup, VisualSidecar } from "./types";

function group(id: string, staveIndex: number, x: number, y: number): VisualGroup {
  return {
    visual_group_id: id,
    staff_index: 0,
    stave_index: staveIndex,
    staff_position: 0,
    center: [x, y],
    bbox: [x - 10, y - 8, x + 10, y + 8],
    notehead_ellipses: [{ center: [x, y], rx: 10, ry: 8, angle: 0 }],
    notehead_contours: [],
    stem_contours: [],
    musicxml_ids: [`note-${id}`],
  };
}

const groups = [group("treble", 0, 300, 350), group("bass", 1, 302, 520)];
const sidecar: VisualSidecar = {
  version: 1,
  source_image_size: [1000, 1400],
  visual_groups: groups,
  notes: groups.map((value, index) => ({
    musicxml_id: `note-${value.visual_group_id}`,
    part: 1,
    measure: 1,
    staff: index + 1,
    voice: 1,
    pitch: index === 0 ? "C4" : "E3",
    duration: "note_4",
    match_confidence: 1,
    visual_group_id: value.visual_group_id,
  })),
  unmatched_musicxml_notes: [],
  unmatched_visual_notes: [],
};
const page: DocumentPage = {
  index: 0,
  status: "complete",
  width: 1000,
  height: 1400,
  visualSidecar: sidecar,
};
const moment: PlaybackMoment = {
  id: "moment-1",
  pageIndex: 0,
  staffIndex: 0,
  measure: 1,
  barKey: "page-0-measure-1",
  visualGroupIds: groups.map((value) => value.visual_group_id),
  pitches: ["C4", "E3"],
  center: [301, 435],
};

function render(playbackActive: boolean): string {
  return renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
      selectedGroup={null}
      highlightAllNotes={false}
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours={false}
      playbackActive={playbackActive}
      playbackNoteSoundsEnabled
      playbackAvailable
      playbackMoment={playbackActive ? moment : null}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );
}

test("renders compact playback controls disabled outside playback mode", () => {
  const markup = render(false);
  assert.match(markup, /aria-label="Play"/);
  assert.match(markup, /aria-label="Mute note sounds"/);
  assert.equal(markup.match(/disabled=""/g)?.length, 7);
  assert.doesNotMatch(markup, /data-playback-selected="true"/);
});

test("renders all groups and note names in the active cross-clef moment", () => {
  const markup = render(true);
  assert.equal(markup.match(/data-playback-selected="true"/g)?.length, 2);
  assert.equal(markup.match(/disabled=""/g)?.length ?? 0, 0);
  assert.match(markup, />C4<\/text>/);
  assert.match(markup, />E3<\/text>/);
  assert.match(markup, /aria-pressed="true"/);
});

test("omits pages that were skipped because they contain no music", () => {
  const skippedPage: DocumentPage = {
    index: 0,
    status: "skipped",
    width: 1000,
    height: 1400,
  };
  const musicPage: DocumentPage = { ...page, index: 1 };
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[skippedPage, musicPage]}
      selectedGroup={null}
      highlightAllNotes={false}
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours={false}
      playbackActive={false}
      playbackNoteSoundsEnabled
      playbackAvailable
      playbackMoment={null}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.equal(markup.match(/class="document-page /g)?.length, 1);
  assert.match(markup, /class="page-number">2<\/span>/);
  assert.doesNotMatch(markup, /class="page-number">1<\/span>/);
});
