import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  centeredPlaybackX,
  committedTempoPercentage,
  constrainViewportTransform,
  DocumentViewer,
  hitTest,
  shouldScrollPlaybackHorizontally,
  validTempoPercentage,
} from "./DocumentViewer";
import { stoppedRecognizerLifecycle } from "./noteRecognizer";
import type { ListenModeFeedback } from "./noteRecognizer";
import type { PlaybackMoment } from "./playback";
import type { DocumentPage, VisualGroup, VisualSidecar } from "./types";

test("tempo input accepts partial edits and validates only complete percentages", () => {
  assert.equal(validTempoPercentage(""), null);
  assert.equal(validTempoPercentage("1"), null);
  assert.equal(validTempoPercentage("10"), 10);
  assert.equal(validTempoPercentage("250"), 250);
  assert.equal(validTempoPercentage("301"), null);
  assert.equal(validTempoPercentage("12.5"), null);

  assert.equal(committedTempoPercentage(""), null);
  assert.equal(committedTempoPercentage("1"), 10);
  assert.equal(committedTempoPercentage("301"), 300);
  assert.equal(committedTempoPercentage("45.6"), 46);
  assert.equal(committedTempoPercentage("invalid"), null);
});

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
    visual_status: "canonical",
    provenance: "segmentation",
    moment_id: "moment-1",
    chord_id: null,
    repair_actions: [],
  };
}

const groups = [group("treble", 0, 300, 350), group("bass", 1, 302, 520)];
const sidecar: VisualSidecar = {
  version: 2,
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
    alignment_method: "structural",
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
  keyboardNotes: [{ pitch: "C4" }, { pitch: "E3" }],
  center: [301, 435],
};
const listenFeedback = {
  lifecycle: stoppedRecognizerLifecycle,
  targetPitches: [],
  detectedTargetPitches: [],
  extraPitches: [],
  targetPitchConfidences: [],
  recognizedActivePitches: [],
  attackPitches: [],
  successPitches: [],
  processingTimeMs: null,
};

function render(playbackActive: boolean, feedback: ListenModeFeedback = listenFeedback): string {
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
      listenFeedback={feedback}
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
  assert.equal(markup.match(/disabled=""/g)?.length, 9);
  assert.doesNotMatch(markup, /data-playback-selected="true"/);
});

test("renders viewport actions as compact labelled icons", () => {
  const markup = render(false);
  assert.match(markup, /aria-label="Fit width"/);
  assert.match(markup, /aria-label="Fit page"/);
  assert.match(markup, /aria-label="Reset zoom to 100%"/);
  assert.equal(markup.match(/class="toolbar-icon"/g)?.length, 3);
  assert.doesNotMatch(markup, />Fit width<\/button>/);
  assert.doesNotMatch(markup, />Fit page<\/button>/);
  assert.doesNotMatch(markup, />Reset<\/button>/);
});

test("renders all groups and note names in the active cross-clef moment", () => {
  const markup = render(true);
  assert.equal(markup.match(/data-playback-selected="true"/g)?.length, 2);
  assert.equal(markup.match(/disabled=""/g)?.length ?? 0, 0);
  assert.match(markup, />C4<\/text>/);
  assert.match(markup, />E3<\/text>/);
  assert.match(markup, /aria-pressed="true"/);
});

test("hides diagnostic groups while retaining raw contour diagnostics", () => {
  const diagnosticGroup = {
    ...group("diagnostic", 0, 300, 350),
    visual_status: "diagnostic" as const,
  };
  const diagnosticPage: DocumentPage = {
    ...page,
    visualSidecar: {
      ...sidecar,
      visual_groups: [diagnosticGroup],
      notes: [{
        ...sidecar.notes[0],
        visual_group_id: diagnosticGroup.visual_group_id,
      }],
      raw_stem_contours: [{
        debug_id: 1,
        contour: [[290, 300], [290, 400]],
        bbox: [[289, 300], [291, 400]],
      }],
    },
  };
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="diagnostic-fixture"
      pages={[diagnosticPage]}
      selectedGroup={null}
      highlightAllNotes
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours
      playbackActive={false}
      playbackNoteSoundsEnabled
      playbackAvailable={false}
      playbackMoment={null}
      listenFeedback={listenFeedback}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(markup, /class="raw-stem-contour"/);
  assert.doesNotMatch(markup, /data-visual-group-id="diagnostic"/);
  assert.doesNotMatch(markup, />C4<\/text>/);
});

test("debug mode renders and selects diagnostic visual groups", () => {
  const diagnosticGroup = {
    ...group("diagnostic", 1, 300, 520),
    musicxml_ids: [],
    visual_status: "diagnostic" as const,
    moment_id: null,
    chord_id: null,
    repair_actions: ["unmatched_candidate"],
  };
  const diagnosticSidecar: VisualSidecar = {
    ...sidecar,
    visual_groups: [diagnosticGroup],
    notes: [],
    unmatched_visual_notes: [diagnosticGroup.visual_group_id],
  };
  const diagnosticPage: DocumentPage = {
    ...page,
    visualSidecar: diagnosticSidecar,
  };

  assert.equal(hitTest(diagnosticSidecar, diagnosticGroup.center), null);
  assert.equal(
    hitTest(diagnosticSidecar, diagnosticGroup.center, true)?.visual_group_id,
    diagnosticGroup.visual_group_id,
  );

  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="diagnostic-debug-fixture"
      pages={[diagnosticPage]}
      selectedGroup={{ pageIndex: 0, visualGroupId: diagnosticGroup.visual_group_id }}
      highlightAllNotes={false}
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours={false}
      showDiagnosticVisualGroups
      playbackActive={false}
      playbackNoteSoundsEnabled
      playbackAvailable={false}
      playbackMoment={null}
      listenFeedback={listenFeedback}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(markup, /data-visual-group-id="diagnostic"/);
  assert.match(markup, /class="visual-group selected"[^>]*data-visual-status="diagnostic"/);
  assert.doesNotMatch(markup, /data-playback-selected="true"/);
});

test("renders realtime selector, transport states, tempo, and vertical playhead", () => {
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
      selectedGroup={null}
      highlightAllNotes={false}
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours={false}
      playbackActive
      playbackNoteSoundsEnabled
      playbackAvailable
      playbackMoment={moment}
      playbackMode="realtime"
      playbackStatus="playing"
      realtimeAvailable
      realtimePlayhead={{ pageIndex: 0, staffIndex: 0, x: 360, y1: 300, y2: 570 }}
      tempoBpm={135.4}
      tempoMultiplier={1.25}
      listenFeedback={listenFeedback}
      onPlaybackModeChange={() => undefined}
      onTempoMultiplierChange={() => undefined}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(markup, /aria-label="Playback type"/);
  assert.match(markup, />Note-by-note<\/button>/);
  assert.match(markup, />Realtime<\/button>/);
  assert.match(markup, /aria-label="Pause"/);
  assert.match(markup, /aria-label="Stop playback"/);
  assert.match(markup, /aria-label="Tempo 135 BPM"/);
  assert.match(markup, />135 BPM<\/button>/);
  assert.match(markup, /data-testid="realtime-playhead"/);
  assert.match(markup, /x1="360"[^>]*x2="360"[^>]*y1="300"[^>]*y2="570"/);
  assert.doesNotMatch(markup, /Realtime is not available/);
});

test("explains why realtime playback is disabled", () => {
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
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
      playbackMode="note-by-note"
      realtimeAvailable={false}
      listenFeedback={listenFeedback}
      onPlaybackModeChange={() => undefined}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(markup, /aria-describedby="[^"]+"[^>]*disabled=""/);
  assert.match(markup, /role="tooltip"/);
  assert.match(markup, /Realtime is not available until all pages are ready\./);
});

test("shows listen lifecycle, target detections, extras, and analysis time", () => {
  const markup = render(true, {
    lifecycle: { state: "listening", microphone: "ready", analysis: "ready" },
    targetPitches: [60, 64],
    detectedTargetPitches: [60],
    extraPitches: [67],
    targetPitchConfidences: [
      { midi: 60, confidence: 0.82 },
      { midi: 64, confidence: 0.34 },
    ],
    recognizedActivePitches: [
      { midi: 60, confidence: 0.82 },
      { midi: 67, confidence: 0.77 },
    ],
    attackPitches: [{ midi: 67, attackTimeMs: 100 }],
    successPitches: [],
    processingTimeMs: 123.4,
  });
  assert.match(markup, /Microphone ready · Analyzer ready · Target C4 E4/);
  assert.match(markup, /Heard C4 · Extra G4/);
  assert.match(markup, /Signal C4 82% E4 34% · 123 ms analysis/);
  assert.match(markup, /aria-label="Disable listen mode"/);
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
      listenFeedback={listenFeedback}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.equal(markup.match(/class="document-page /g)?.length, 1);
  assert.match(markup, /class="page-number">2<\/span>/);
  assert.doesNotMatch(markup, /class="page-number">1<\/span>/);
});

test("renders an explicit recognition state inside a pending page", () => {
  const processingPage: DocumentPage = {
    index: 0,
    status: "processing",
    width: 850,
    height: 1100,
  };
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="processing-fixture"
      pages={[processingPage]}
      selectedGroup={null}
      highlightAllNotes={false}
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours={false}
      playbackActive={false}
      playbackNoteSoundsEnabled
      playbackAvailable={false}
      playbackMoment={null}
      listenFeedback={listenFeedback}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(markup, /class="document-page page-processing"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /Recognizing page 1/);
  assert.match(markup, /Reading notation and building MusicXML…/);
});

test("sizes unfinished pages like the first page with known PDF dimensions", () => {
  const processingPage: DocumentPage = {
    index: 1,
    status: "processing",
    width: 850,
    height: 1100,
  };
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="mixed-size-fixture"
      pages={[page, processingPage]}
      selectedGroup={null}
      highlightAllNotes={false}
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours={false}
      playbackActive={false}
      playbackNoteSoundsEnabled
      playbackAvailable={false}
      playbackMoment={null}
      listenFeedback={listenFeedback}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(markup, /page-processing" style="width:1000px;height:1400px/);
  assert.match(markup, /class="page-placeholder-content loading" role="status"/);
  assert.doesNotMatch(markup, /viewer-loading-status/);
});

test("keeps a grabbable edge of the document on screen while panning", () => {
  assert.deepEqual(
    constrainViewportTransform(
      { scale: 1, x: -5000, y: 5000 },
      1000,
      800,
      900,
      1400,
    ),
    { scale: 1, x: -804, y: 704 },
  );
  assert.deepEqual(
    constrainViewportTransform(
      { scale: 1, x: 5000, y: -5000 },
      1000,
      800,
      900,
      1400,
    ),
    { scale: 1, x: 904, y: -1304 },
  );
});

test("keeps a document smaller than the viewport fully on screen", () => {
  assert.deepEqual(
    constrainViewportTransform(
      { scale: 1, x: -100, y: 1000 },
      1000,
      800,
      60,
      50,
    ),
    { scale: 1, x: 0, y: 750 },
  );
});

test("does not scroll horizontally when the approached staff edge is already visible", () => {
  assert.equal(
    shouldScrollPlaybackHorizontally(850, 920, 40, 980, 120, 880, 1000),
    false,
  );
  assert.equal(
    shouldScrollPlaybackHorizontally(80, 150, 20, 960, 120, 880, 1000),
    false,
  );
});

test("scrolls before the playhead label reaches a visible staff edge", () => {
  assert.equal(
    shouldScrollPlaybackHorizontally(12, 82, 40, 960, 120, 880, 1000),
    true,
  );
  assert.equal(
    shouldScrollPlaybackHorizontally(918, 988, 40, 960, 120, 880, 1000),
    true,
  );
});

test("recenters the notes independently of asymmetric label placement", () => {
  const noteLeft = 100;
  const noteRight = 140;
  const scale = 2;
  const viewportWidth = 1000;

  const x = centeredPlaybackX(noteLeft, noteRight, scale, viewportWidth);

  assert.equal(x + ((noteLeft + noteRight) / 2) * scale, viewportWidth / 2);
});

test("scrolls horizontally when the playhead approaches music clipped on that side", () => {
  assert.equal(
    shouldScrollPlaybackHorizontally(850, 920, 40, 1120, 120, 880, 1000),
    true,
  );
  assert.equal(
    shouldScrollPlaybackHorizontally(80, 150, -120, 960, 120, 880, 1000),
    true,
  );
});

test("restores a supplied viewport transform after remounting", () => {
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
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
      listenFeedback={listenFeedback}
      initialViewportTransform={{ scale: 1.75, x: -320, y: -640 }}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(markup, />175%<\/span>/);
  assert.match(markup, /translate3d\(-320px, -640px, 0\) scale\(1.75\)/);
});
