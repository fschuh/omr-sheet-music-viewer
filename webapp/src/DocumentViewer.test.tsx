import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  centeredPlaybackX,
  committedTempoPercentage,
  constrainViewportTransform,
  DocumentViewer,
  heldTempoStep,
  loopEdgeScrollStep,
  loopScrollStepWithinReach,
  nextLoopHeading,
  noteheadAt,
  pageDiagnosticNoteheads,
  playbackMomentExtents,
  revealOffset,
  shouldScrollPlaybackHorizontally,
  steppedTempoMultiplier,
  validTempoPercentage,
} from "./DocumentViewer";
import {
  stoppedRecognizerLifecycle,
  type ListenModeFeedback,
} from "./noteRecognizer";
import type { PlaybackMoment } from "./playback";
import { documentNoteGeometry } from "./documentSource";
import { pdfNoteGeometry, sidecarNoteGeometry } from "./sidecarNoteGeometry";
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

test("a loop handle dragged near an edge of the view scrolls the score while there is more of it", () => {
  // A 600-pixel view onto a document from -500 to 1500.
  assert.equal(loopEdgeScrollStep(300, 0, 600, -500, 1500, 1), 0);
  // Near the bottom the document moves up, faster the closer the pointer gets.
  const slow = loopEdgeScrollStep(560, 0, 600, -500, 1500, 1);
  const fast = loopEdgeScrollStep(590, 0, 600, -500, 1500, 1);
  assert.ok(slow < 0 && fast < slow);
  // At and past the edge it scrolls at full speed, no faster.
  assert.equal(loopEdgeScrollStep(600, 0, 600, -500, 1500, 1), -18);
  assert.equal(loopEdgeScrollStep(900, 0, 600, -500, 1500, 1), -18);
  // Near the top it moves down.
  assert.ok(loopEdgeScrollStep(10, 0, 600, -500, 1500, -1) > 0);
  // It stops where the document ends, and never scrolls past it.
  assert.equal(loopEdgeScrollStep(598, 0, 600, -500, 600, 1), 0);
  assert.equal(loopEdgeScrollStep(598, 0, 600, -500, 605, 1), -5);
  assert.equal(loopEdgeScrollStep(10, 0, 600, 0, 1500, -1), 0);
});

test("a loop handle scrolls no further than to show the barline a measure from the other handle", () => {
  // The start handle's furthest barline spans 500 to 640 in a 600-pixel view: the view
  // moves up only the 40 pixels that bring it in, and not at all once it is in.
  assert.equal(loopScrollStepWithinReach(-18, "start", 500, 640, 0, 600), -18);
  assert.equal(loopScrollStepWithinReach(-18, "start", 500, 610, 0, 600), -10);
  assert.equal(loopScrollStepWithinReach(-18, "start", 400, 560, 0, 600), 0);
  // Back toward the loop's start it is free to go.
  assert.equal(loopScrollStepWithinReach(18, "start", 400, 560, 0, 600), 18);
  // The end handle, the same toward the start.
  assert.equal(loopScrollStepWithinReach(18, "end", -10, 120, 0, 600), 10);
  assert.equal(loopScrollStepWithinReach(18, "end", 20, 160, 0, 600), 0);
  assert.equal(loopScrollStepWithinReach(-18, "end", 20, 160, 0, 600), -18);
});

test("a dragged handle's heading turns only when the pointer comes back a few pixels", () => {
  const start = { heading: 0, turn: 300 };
  // A press that wobbles has no heading yet; a real move sets one.
  assert.equal(nextLoopHeading(start, 297), start);
  const up = nextLoopHeading(start, 290);
  assert.deepEqual(up, { heading: -1, turn: 290 });
  // Further up, it remembers how far it got.
  const higher = nextLoopHeading(up, 40);
  assert.deepEqual(higher, { heading: -1, turn: 40 });
  // Settling back a few pixels, as against the screen's edge, keeps it heading up.
  assert.equal(nextLoopHeading(higher, 45), higher);
  // Coming back further turns it.
  assert.deepEqual(nextLoopHeading(higher, 48), { heading: 1, turn: 48 });
});

test("a loop handle dragged away from an edge never scrolls toward it", () => {
  // Moving up near the bottom, or down near the top, leaves the view still.
  assert.equal(loopEdgeScrollStep(590, 0, 600, -500, 1500, -1), 0);
  assert.equal(loopEdgeScrollStep(10, 0, 600, -500, 1500, 1), 0);
  // Nor does a pointer that has not moved yet.
  assert.equal(loopEdgeScrollStep(590, 0, 600, -500, 1500, 0), 0);
});

test("a boundary moved by the keyboard is brought into view, its start first", () => {
  assert.equal(revealOffset(100, 200, 0, 600), 0);
  assert.equal(revealOffset(700, 800, 0, 600), -200);
  assert.equal(revealOffset(-150, -50, 0, 600), 150);
  // Taller than the view: its top goes to the top of the view.
  assert.equal(revealOffset(700, 1500, 0, 600), -700);
});

test("tempo shortcuts step by one percentage point within the tempo range", () => {
  assert.equal(steppedTempoMultiplier(1, 1), 1.01);
  assert.equal(steppedTempoMultiplier(1, -1), 0.99);
  // Steps from the shown percentage, so a typed 45.6% that shows as 46% goes to 47%.
  assert.equal(steppedTempoMultiplier(0.456, 1), 0.47);
  assert.equal(steppedTempoMultiplier(3, 1), 3);
  assert.equal(steppedTempoMultiplier(0.1, -1), 0.1);
});

test("a held tempo shortcut steps one point for a second, then speeds up to three", () => {
  assert.equal(heldTempoStep(0), 1);
  assert.equal(heldTempoStep(999), 1);
  assert.equal(heldTempoStep(1000), 2);
  assert.equal(heldTempoStep(1499), 2);
  assert.equal(heldTempoStep(1500), 3);
  assert.equal(heldTempoStep(60_000), 3);
});

function group(id: string, physicalStaffIndex: number, x: number, y: number): VisualGroup {
  return {
    visual_group_id: id,
    staff_group_index: 0,
    staff_index: physicalStaffIndex,
    staff_position: 0,
    center: [x, y],
    bbox: [x - 10, y - 8, x + 10, y + 8],
    notehead_ellipses: [{ center: [x, y], rx: 10, ry: 8, angle: 0 }],
    notehead_contours: [],
    stem_contours: [],
    musicxml_id: `note-${id}`,
    visual_status: "canonical",
    provenance: "segmentation",
    moment_id: "moment-1",
    chord_id: null,
    repair_actions: [],
  };
}

const groups = [group("treble", 0, 300, 350), group("bass", 1, 302, 520)];
const sidecar: VisualSidecar = {
  version: 3,
  source_image_size: [1000, 1400],
  visual_groups: groups,
  notes: groups.map((value, index) => ({
    musicxml_id: `note-${value.visual_group_id}`,
    part: 1,
    measure: 1,
    musicxml_staff_number: index + 1,
    voice: 1,
    pitch: index === 0 ? "C4" : "E3",
    duration: "note_4",
    match_confidence: 1,
    visual_group_id: value.visual_group_id,
    alignment_method: "structural",
  })),
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
  staffGroupIndex: 0,
  measure: 1,
  measureIndex: 0,
  barKey: "page-0-measure-1",
  visualGroupIds: groups.map((value) => value.visual_group_id),
  pitches: ["C4", "E3"],
  dynamic: "mp",
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
      noteGeometry={pdfNoteGeometry([page])}
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
    musicxml_id: null,
    visual_status: "diagnostic" as const,
    moment_id: null,
  };
  const diagnosticPage: DocumentPage = {
    ...page,
    visualSidecar: {
      ...sidecar,
      visual_groups: [diagnosticGroup],
      notes: [],
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
      noteGeometry={pdfNoteGeometry([diagnosticPage])}
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
  const linkedOverlapGroup = group("linked-overlap", 1, 300, 520);
  const diagnosticGroup = {
    ...group("diagnostic", 1, 300, 520),
    musicxml_id: null,
    visual_status: "diagnostic" as const,
    moment_id: null,
    chord_id: null,
    repair_actions: ["unmatched_candidate"],
  };
  const diagnosticSidecar: VisualSidecar = {
    ...sidecar,
    visual_groups: [diagnosticGroup, linkedOverlapGroup],
    notes: [
      {
        ...sidecar.notes[0],
        musicxml_id: linkedOverlapGroup.musicxml_id!,
        visual_group_id: linkedOverlapGroup.visual_group_id,
      },
    ],
  };
  const overlapHitTestSidecar: VisualSidecar = {
    ...diagnosticSidecar,
    visual_groups: [linkedOverlapGroup, diagnosticGroup],
  };
  const diagnosticPage: DocumentPage = {
    ...page,
    visualSidecar: diagnosticSidecar,
  };

  const overlapPage: DocumentPage = { ...page, visualSidecar: overlapHitTestSidecar };
  const overlapGeometry = sidecarNoteGeometry(overlapHitTestSidecar, 0, "");
  assert.equal(
    noteheadAt(
      overlapGeometry,
      pageDiagnosticNoteheads(overlapPage, false),
      diagnosticGroup.center,
    )?.id,
    linkedOverlapGroup.visual_group_id,
  );
  assert.equal(
    noteheadAt(
      overlapGeometry,
      pageDiagnosticNoteheads(overlapPage, true),
      diagnosticGroup.center,
    )?.id,
    diagnosticGroup.visual_group_id,
  );

  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="diagnostic-debug-fixture"
      pages={[diagnosticPage]}
      noteGeometry={pdfNoteGeometry([diagnosticPage])}
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
  assert.match(markup, /data-diagnostic-highlight="halo"/);
  assert.match(markup, /class="visual-group selected"[^>]*data-visual-status="diagnostic"/);
  assert.ok(
    markup.indexOf('data-visual-group-id="linked-overlap"') <
      markup.indexOf('data-visual-group-id="diagnostic"'),
  );
  assert.doesNotMatch(markup, /data-playback-selected="true"/);
});

test("renders realtime selector, transport states, tempo, and vertical playhead", () => {
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
      noteGeometry={pdfNoteGeometry([page])}
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
      realtimePlayhead={{ pageIndex: 0, staffGroupIndex: 0, x: 360, y1: 300, y2: 570 }}
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

test("shows the 3D note highway toggle state in both playback modes", () => {
  const markupFor = (mode: "realtime" | "note-by-note", enabled: boolean) => renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
      noteGeometry={pdfNoteGeometry([page])}
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
      playbackMode={mode}
      realtimeAvailable
      noteHighwayEnabled={enabled}
      listenFeedback={listenFeedback}
      onPlaybackModeChange={() => undefined}
      onNoteHighwayToggle={() => undefined}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  assert.match(
    markupFor("realtime", true),
    /class="note-highway-toggle active" aria-label="Hide 3D note highway" aria-pressed="true"/,
  );
  assert.match(
    markupFor("realtime", false),
    /class="note-highway-toggle" aria-label="Show 3D note highway" aria-pressed="false"/,
  );
  assert.match(
    markupFor("note-by-note", true),
    /class="note-highway-toggle active" aria-label="Hide 3D note highway" aria-pressed="true"/,
  );
});

test("offers a practice-hand selector and a hand sound menu for one hand only", () => {
  const markupFor = (hand: "both" | "left" | "right") => renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
      noteGeometry={pdfNoteGeometry([page])}
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
      practiceHand={hand}
      listenFeedback={listenFeedback}
      onPlaybackModeChange={() => undefined}
      onPracticeHandChange={() => undefined}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  const both = markupFor("both");
  assert.match(both, /aria-label="Practice hand"/);
  assert.match(both, /aria-label="Practice the left hand" aria-pressed="false"[^>]*>LH</);
  assert.match(both, /aria-label="Play both hands" aria-pressed="true"[^>]*>Both</);
  assert.match(both, /aria-label="Hand sound options"[^>]*disabled=""/);

  const left = markupFor("left");
  assert.match(left, /aria-label="Practice the left hand" aria-pressed="true"/);
  assert.doesNotMatch(left, /aria-label="Hand sound options"[^>]*disabled=""/);
});

test("explains why realtime playback is disabled", () => {
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
      noteGeometry={pdfNoteGeometry([page])}
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
    lifecycle: {
      state: "listening",
      inputSource: "microphone",
      input: "ready",
      analysis: "ready",
    },
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
  assert.match(markup, /Microphone ready · Target C4 E4/);
  assert.match(markup, /Heard C4 · Extra G4/);
  assert.match(markup, /Signal C4 82% E4 34% · 123 ms analysis/);
  assert.match(markup, /aria-label="Disable listen mode"/);
});

test("labels MIDI listen feedback as MIDI input", () => {
  const markup = render(true, {
    lifecycle: {
      state: "listening",
      inputSource: "midi",
      input: "ready",
      analysis: "ready",
    },
    targetPitches: [60],
    detectedTargetPitches: [],
    extraPitches: [],
    targetPitchConfidences: [{ midi: 60, confidence: 0 }],
    recognizedActivePitches: [],
    attackPitches: [],
    successPitches: [],
    processingTimeMs: 0,
  });

  assert.match(markup, /MIDI input ready · Target C4/);
  assert.doesNotMatch(markup, /Microphone ready/);
});

function renderRealtimeListen(feedback: ListenModeFeedback): string {
  return renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[page]}
      noteGeometry={pdfNoteGeometry([page])}
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
      listenFeedback={feedback}
      onPlaybackModeChange={() => undefined}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );
}

test("listen mode can be turned on in realtime", () => {
  const markup = renderRealtimeListen(listenFeedback);
  const toggle = markup.match(/<button[^>]*aria-label="Enable listen mode"[^>]*>/)?.[0];

  assert.ok(toggle);
  assert.doesNotMatch(toggle, /disabled=""/);
  assert.match(toggle, /title="Listen and show the notes you play \(I\)"/);
});

test("realtime listen feedback shows the notes being played, not a target", () => {
  const listening = {
    ...listenFeedback,
    lifecycle: {
      state: "listening" as const,
      inputSource: "midi" as const,
      input: "ready" as const,
      analysis: "ready" as const,
    },
  };

  const playing = renderRealtimeListen({
    ...listening,
    recognizedActivePitches: [
      { midi: 60, confidence: 1 },
      { midi: 64, confidence: 1 },
    ],
  });
  assert.match(playing, /MIDI input ready · Playing C4 E4/);
  assert.doesNotMatch(playing, /Target/);

  const waiting = renderRealtimeListen(listening);
  assert.match(waiting, /MIDI input ready · Waiting for notes/);
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
      noteGeometry={pdfNoteGeometry([skippedPage, musicPage])}
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
      noteGeometry={pdfNoteGeometry([processingPage])}
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
      noteGeometry={pdfNoteGeometry([page, processingPage])}
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

test("measures the playing moment against every notehead of its system", () => {
  const [geometry] = pdfNoteGeometry([page]);
  const extents = playbackMomentExtents(geometry, page, { ...moment, visualGroupIds: ["treble"] });
  assert.ok(extents);
  assert.deepEqual(extents.system, [290, 342, 312, 528]);
  assert.equal(extents.momentLeft, 290);
  assert.equal(extents.momentRight, 310);
  // The pitch label sits beside the notehead, so the content reaches past it.
  assert.ok(extents.contentLeft <= extents.momentLeft);
  assert.ok(extents.contentRight >= extents.momentRight);
  assert.ok(extents.contentRight - extents.contentLeft > extents.momentRight - extents.momentLeft);
});

test("has no extents for a moment outside any recognized system", () => {
  const [geometry] = pdfNoteGeometry([page]);
  assert.equal(playbackMomentExtents(geometry, page, { ...moment, staffGroupIndex: 5 }), null);
  assert.equal(
    playbackMomentExtents(geometry, page, { ...moment, visualGroupIds: ["missing"] }),
    null,
  );
  assert.equal(playbackMomentExtents(undefined, page, moment), null);
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
      noteGeometry={pdfNoteGeometry([page])}
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

test("a MusicXML page draws its engraved surface in place of an image", () => {
  const renderPages = (pages: DocumentPage[]) => renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={pages}
      noteGeometry={[]}
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
  const engraved = renderPages([{
    index: 0,
    status: "complete",
    width: 2480,
    height: 3508,
    surface: { index: 0, firstMeasure: 0, width: 2480, height: 3508, staffSpace: 20, items: [], chords: [], systems: [] },
  }]);
  assert.match(engraved, /<svg class="musicxml-page" viewBox="0 0 2480 3508"/);
  assert.doesNotMatch(engraved, /<img/);

  const recognized = renderPages([{ ...page, imageUrl: "page-1.png" }]);
  assert.match(recognized, /<img src="page-1.png"/);
  assert.doesNotMatch(recognized, /musicxml-page/);
});

const engravedChordPage: DocumentPage = {
  index: 0,
  status: "complete",
  width: 1000,
  height: 1400,
  surface: {
    index: 0,
    firstMeasure: 0,
    width: 1000,
    height: 1400,
    staffSpace: 20,
    systems: [],
    items: [],
    chords: [{
      id: "P1-m1-s1-v1-t0",
      systemIndex: 0,
      momentId: "m1-t0",
      items: [],
      stemBounds: null,
      notes: ["C5", "E5"].map((pitch, index) => ({
        key: `P1-m1-s1-v1-t0-${pitch}`,
        pitch,
        grace: false,
        measure: 1,
        center: [213, 230 - index * 20] as [number, number],
        headBounds: [200, 220 - index * 20, 226, 240 - index * 20] as [number, number, number, number],
        items: [],
      })),
    }],
  },
};

test("a selected MusicXML note is coloured on its page and labelled by the overlay", () => {
  const engraved = engravedChordPage;
  const markup = renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[engraved]}
      noteGeometry={documentNoteGeometry("musicxml", [engraved])}
      selectedGroup={{ pageIndex: 0, visualGroupId: "P1-m1-s1-v1-t0-C5" }}
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
  // Selecting one note of a chord selects the chord.
  assert.match(markup, /class="mx-note mx-selected" data-notehead="P1-m1-s1-v1-t0-C5"/);
  assert.match(markup, /class="mx-note mx-selected" data-notehead="P1-m1-s1-v1-t0-E5"/);
  assert.match(markup, /class="note-label" data-musicxml-id="page-1-P1-m1-s1-v1-t0-C5"/);
});

test("realtime playback highlights notes without naming them; note-by-note names them", () => {
  const renderPlayback = (playbackMode: "note-by-note" | "realtime") => renderToStaticMarkup(
    <DocumentViewer
      documentKey="fixture"
      pages={[engravedChordPage]}
      noteGeometry={documentNoteGeometry("musicxml", [engravedChordPage])}
      selectedGroup={null}
      highlightAllNotes={false}
      showOriginalNoteheadContours={false}
      showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false}
      showRawStemContours={false}
      playbackActive
      playbackNoteSoundsEnabled
      playbackAvailable
      playbackMoment={{
        ...moment,
        visualGroupIds: ["P1-m1-s1-v1-t0-C5", "P1-m1-s1-v1-t0-E5"],
      }}
      playbackMode={playbackMode}
      playbackStatus={playbackMode === "realtime" ? "playing" : "note-by-note"}
      realtimeAvailable
      realtimeGroupIdsByPage={playbackMode === "realtime"
        ? { 0: ["P1-m1-s1-v1-t0-C5", "P1-m1-s1-v1-t0-E5"] }
        : undefined}
      listenFeedback={listenFeedback}
      onPlaybackModeChange={() => undefined}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );

  const realtime = renderPlayback("realtime");
  assert.match(realtime, /class="mx-note mx-playback" data-notehead="P1-m1-s1-v1-t0-C5"/);
  assert.doesNotMatch(realtime, /class="note-label"/);

  const noteByNote = renderPlayback("note-by-note");
  assert.match(noteByNote, /class="note-label" data-musicxml-id="page-1-P1-m1-s1-v1-t0-C5"/);
});

test("debug mode haloes the notes whose printed value disagrees", () => {
  const linked = sidecar.notes.filter((note) => note.visual_group_id !== null);
  assert.ok(linked.length >= 2);
  const [mismatch, agreed] = linked;
  const valuePage: DocumentPage = {
    ...page,
    visualSidecar: {
      ...sidecar,
      note_value_verification: {
        version: 1,
        notes: [
          { musicxml_id: mismatch.musicxml_id, printed: "eighth", dotted: false, status: "disagrees", reason: "1_bands" },
          { musicxml_id: agreed.musicxml_id, printed: "quarter", dotted: false, status: "agrees", reason: "0_bands" },
        ],
      },
    },
  };
  const renderValues = (showValueMismatches: boolean) =>
    renderToStaticMarkup(
      <DocumentViewer
        documentKey="value-fixture"
        pages={[valuePage]}
        noteGeometry={pdfNoteGeometry([valuePage])}
        selectedGroup={null}
        highlightAllNotes={false}
        showOriginalNoteheadContours={false}
        showDetectedNoteheadContours={false}
        showRefinedNoteheadContours={false}
        showRawStemContours={false}
        showValueMismatches={showValueMismatches}
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

  const shown = renderValues(true);
  const marked = [...shown.matchAll(/data-visual-group-id="([^"]+)"[^>]*data-value-mismatch="true"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(marked, [mismatch.visual_group_id]);
  assert.match(
    shown,
    new RegExp(`data-visual-group-id="${mismatch.visual_group_id}"[^>]*data-diagnostic-highlight="halo"`),
  );
  assert.doesNotMatch(renderValues(false), /data-value-mismatch/);
});

test("debug mode draws ghosts of unsupported rests only", () => {
  const rest = (restId: string, status: "supported" | "unsupported", reason: string) => ({
    rest_id: restId,
    part: 1,
    measure: 1,
    musicxml_staff_number: 1,
    voice: 1,
    duration: "rest_8",
    status,
    reason,
    staff_group_index: 0,
    staff_index: 0,
    center: [400, 340] as [number, number],
    staff_lines: [320, 330, 340, 350, 360],
    unit_size: 10,
  });
  const restPage: DocumentPage = {
    ...page,
    visualSidecar: {
      ...sidecar,
      rest_verification: {
        version: 1,
        rests: [
          rest("homr-rest-1", "supported", "rest_shaped_ink"),
          rest("homr-rest-2", "unsupported", "no_rest_shaped_ink"),
          { ...rest("homr-rest-3", "unsupported", "note_without_pitch"), position_estimated: true },
        ],
      },
    },
  };
  const renderRests = (showUnsupportedRests: boolean) =>
    renderToStaticMarkup(
      <DocumentViewer
        documentKey="rest-fixture"
        pages={[restPage]}
        noteGeometry={pdfNoteGeometry([restPage])}
        selectedGroup={null}
        highlightAllNotes={false}
        showOriginalNoteheadContours={false}
        showDetectedNoteheadContours={false}
        showRefinedNoteheadContours={false}
        showRawStemContours={false}
        showUnsupportedRests={showUnsupportedRests}
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

  const shown = renderRests(true);
  assert.doesNotMatch(shown, /data-rest-id="homr-rest-1"/);
  assert.match(shown, /class="ghost-rest" data-rest-id="homr-rest-2" data-rest-reason="no_rest_shaped_ink" data-rest-kind="eighth"/);
  assert.match(shown, /class="ghost-rest estimated" data-rest-id="homr-rest-3" data-rest-reason="note_without_pitch"/);
  assert.doesNotMatch(renderRests(false), /ghost-rest/);
});

/** The fixture page with two systems of three measures each. */
const loopGeometry = pdfNoteGeometry([page]).map((value) => ({
  ...value,
  systems: [
    { index: 0, top: 300, bottom: 540, firstMeasure: 0, barlines: [100, 400, 700, 950] },
    { index: 1, top: 800, bottom: 1040, firstMeasure: 3, barlines: [100, 400, 700, 950] },
  ],
}));

function renderLoop(options: {
  playbackActive?: boolean;
  loopMode?: boolean;
  loop?: { startMeasure: number; endMeasure: number } | null;
  loopPass?: number;
  loopPlaying?: boolean;
  loopDimOutside?: boolean;
  scale?: number;
}): string {
  const { playbackActive = true, loopMode = true, loop = null, loopPass = 1, loopPlaying = false, loopDimOutside = true, scale = 1 } = options;
  return renderToStaticMarkup(
    <DocumentViewer
      documentKey="loop-fixture"
      pages={[page]}
      noteGeometry={loopGeometry}
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
      listenFeedback={listenFeedback}
      loopMode={loopMode}
      loop={loop}
      loopPass={loopPass}
      loopPlaying={loopPlaying}
      loopDimOutside={loopDimOutside}
      initialViewportTransform={{ scale, x: 0, y: 0 }}
      onLoopToggle={() => undefined}
      onLoopChange={() => undefined}
      onPlaybackCommand={() => undefined}
      onSelectGroup={() => undefined}
      onRetryPage={() => undefined}
    />,
  );
}

function loopButton(markup: string): string {
  return /<button[^>]*class="loop-toggle[^"]*"[^>]*>.*?<\/button>/.exec(markup)?.[0] ?? "";
}

test("the Loop button is off, on, or showing the pass while playback is inside the loop", () => {
  const off = loopButton(renderLoop({ loopMode: false }));
  assert.match(off, /class="loop-toggle"/);
  assert.match(off, /aria-pressed="false"/);
  assert.match(off, />Loop<\/span>/);

  const on = loopButton(renderLoop({ loop: { startMeasure: 1, endMeasure: 2 } }));
  assert.match(on, /class="loop-toggle active"/);
  assert.match(on, /aria-pressed="true"/);
  assert.match(on, />Loop<\/span>/);

  const looping = loopButton(renderLoop({ loop: { startMeasure: 1, endMeasure: 2 }, loopPlaying: true, loopPass: 3 }));
  assert.match(looping, /class="loop-toggle active looping"/);
  assert.match(looping, />Pass 3<\/span>/);
});

test("loop mode turns on only during playback, and can be turned off at any time", () => {
  assert.match(loopButton(renderLoop({ playbackActive: false, loopMode: false })), /disabled=""/);
  assert.doesNotMatch(loopButton(renderLoop({ playbackActive: false, loopMode: true })), /disabled=""/);
  assert.doesNotMatch(loopButton(renderLoop({ loopMode: false })), /disabled=""/);
});

test("without a loop to show, the score has no loop overlay", () => {
  assert.doesNotMatch(renderLoop({ loop: null }), /data-testid="loop-layer"/);
  assert.doesNotMatch(renderLoop({ loopMode: false }), /loop-tint/);
});

test("a loop on one system draws its tint, label and two handles as sliders", () => {
  const markup = renderLoop({ loop: { startMeasure: 0, endMeasure: 2 } });
  assert.equal(markup.match(/data-testid="loop-tint"/g)?.length, 1);
  assert.match(markup, /data-testid="loop-label".*?>Bars 1–2<\/text>/);
  assert.match(markup, /role="slider"[^>]*aria-label="Loop start"[^>]*aria-valuemin="1"[^>]*aria-valuemax="2"[^>]*aria-valuenow="1"[^>]*aria-valuetext="Bar 1"/);
  assert.match(markup, /role="slider"[^>]*aria-label="Loop end"[^>]*aria-valuemin="1"[^>]*aria-valuemax="6"[^>]*aria-valuenow="2"[^>]*aria-valuetext="Bar 2"/);
  assert.doesNotMatch(markup, /data-testid="loop-chevron"/);
  // Bar 3 and the whole second system are dimmed.
  assert.equal(markup.match(/data-testid="loop-dim"/g)?.length, 2);
  assert.equal(renderLoop({ loop: { startMeasure: 0, endMeasure: 2 }, loopDimOutside: false }).match(/data-testid="loop-dim"/g), null);
});

test("a loop across systems has a segment on each and chevrons where it continues", () => {
  const markup = renderLoop({ loop: { startMeasure: 2, endMeasure: 4 } });
  assert.equal(markup.match(/data-testid="loop-tint"/g)?.length, 2);
  assert.equal(markup.match(/data-testid="loop-chevron"/g)?.length, 2);
  assert.equal(markup.match(/role="slider"/g)?.length, 2);
  // The label goes on the wider segment, the second system's.
  assert.match(markup, /data-testid="loop-label"><rect x="180"[^>]*><\/rect><text x="250"[^>]*>Bars 3–4<\/text>/);
  // A loop narrower than the label needs on screen goes without it.
  assert.match(renderLoop({ loop: { startMeasure: 2, endMeasure: 3 } }), /data-testid="loop-label"/);
  assert.doesNotMatch(renderLoop({ loop: { startMeasure: 2, endMeasure: 3 }, scale: 0.5 }), /data-testid="loop-label"/);
});

test("handles keep their screen size at any zoom", () => {
  const tab = (markup: string) => /class="loop-handle-bar" x="[^"]+" y="[^"]+" width="([^"]+)" height="([^"]+)" rx="([^"]+)"/g;
  // Widths and corner radii; a handle bar's height also spans the system, which zoom does not change.
  const tabs = (markup: string) => [...markup.matchAll(tab(markup))].map((match) => [match[1], match[3]].map(Number));
  const atFull = tabs(renderLoop({ loop: { startMeasure: 0, endMeasure: 2 } }));
  const atHalf = tabs(renderLoop({ loop: { startMeasure: 0, endMeasure: 2 }, scale: 0.5 }));
  // The handle bar and grip tab are twice as wide in page pixels at half the zoom.
  assert.deepEqual(atHalf, atFull.map((sizes) => sizes.map((size) => size * 2)));
});
