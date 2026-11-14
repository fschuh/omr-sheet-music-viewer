import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentViewer, heldTempoStep, steppedTempoMultiplier, type NoteHighlight } from "./DocumentViewer";
import { printedValueSummary } from "./noteValues";
import {
  addPredictedFingeringsToMusicXml,
  cachedFingeringsFromMusicXml,
  type FingeringPredictor,
} from "./fingering";
import { PianoKeyboard } from "./PianoKeyboard";
import { SettingsPage } from "./SettingsPage";
import {
  buildPlaybackTimeline,
  currentPlaybackMoment,
  effectivePlaybackNoteSounds,
  initialPlaybackState,
  isFingerEditCommand,
  isLoopBoundaryCommand,
  noteInPracticeHand,
  playbackCommandNames,
  runPlaybackCommand as applyPlaybackCommand,
  seekPracticePlaybackToGroup,
  snapMomentToTimeline,
  timelineForPracticeHand,
  visualGroupIdsByPage,
  type PlaybackCommand,
  type PlaybackMoment,
  type PlaybackState,
  type PracticeHand,
} from "./playback";
import { pianoSampler, pitchToMidi } from "./piano";
import { HeldChordMatcher } from "./heldChordMatcher";
import { LISTEN_ENGINE } from "./listenEngine";
import { createBrowserOnlineAmtRecognizer } from "./listenRecognizer";
import {
  isMidiNoteMessage,
  isMidiNoteOnMessage,
  MidiNoteRecognizer,
} from "./midiNoteRecognizer";
import {
  ExactChordMatcher,
  listenMatcherOverrideAfterDebugPanelChange,
  matcherOptionsForListenMatcherProfile,
  resolveEffectiveListenMatcherProfile,
} from "@fschuh/piano-transcription-engine";
import type {
  ListenInputSource,
  ListenMatcherProfileId,
  NoteRecognizer,
  RecognizerResult,
} from "@fschuh/piano-transcription-engine";
import {
  stoppedRecognizerLifecycle,
  withoutPitches,
  type ListenModeFeedback,
} from "./noteRecognizer";
import { KEYBOARD_STALE_SUSTAIN_MS, KeyboardRecognitionTracker } from "./keyboardRecognition";
import {
  buildRealtimeVisualMap,
  expandPerformanceRoute,
  parseRealtimeMusicXml,
  REALTIME_COUNT_IN_SECONDS,
  realtimeLeadIn,
  realtimePlayheadAt,
  RealtimeController,
  REALTIME_WAIT_LEAD_QUARTERS,
  realtimeWaitPointIndex,
  realtimeWaitPoints,
  seekStructuralPosition,
  structuralPositionForGroup,
  type PerformanceNote,
  type PerformanceRoute,
  type PlaybackMode,
  type PlaybackStatus,
  type StructuralPosition,
} from "./realtime";
import {
  DEFAULT_KEYBOARD_VIEW_SETTINGS,
  handColorProperties,
  handColors,
  keyboardRangeForSetting,
  steppedTimeZoom,
  type KeyboardViewSettings,
} from "./keyboardView";
import {
  loadDebugPanelEnabled,
  loadKeyboardViewSettings,
  loadLastScorePath,
  loadListenInputSource,
  loadLoopDimOutside,
  loadLoopRestart,
  loadNoteHighwayEnabled,
  loadPlaybackPiano,
  loadRealtimeCountIn,
  loadSharedNoteheadTimingRepair,
  loadTimeSignatureRepair,
  loadTupletRepair,
  repairSettings,
  saveDebugPanelEnabled,
  saveKeyboardViewSettings,
  saveLastScorePath,
  saveListenInputSource,
  saveLoopDimOutside,
  saveLoopRestart,
  saveNoteHighwayEnabled,
  savePlaybackPiano,
  saveRealtimeCountIn,
  saveSharedNoteheadTimingRepair,
  saveTimeSignatureRepair,
  saveTupletRepair,
} from "./preferences";
import { NoteHighway } from "./noteHighway/NoteHighway";
import {
  clampLoopRegion,
  effectiveLoopRestart,
  loopAroundMeasure,
  loopMeasureCount,
  loopNoteByNoteState,
  loopRegionAfterCommand,
  loopRouteOffset,
  loopRouteStep,
  loopSystems,
  measureInLoop,
  noteByNoteInLoop,
  routeEndBarline,
  routeStartBarline,
  routeStepPosition,
  routeStructuralPosition,
  type LoopRegion,
  type LoopRestart,
} from "./loop";
import {
  diagnosticsAvailable,
  documentFolder,
  documentNoteGeometry,
  documentNoteScoreFacts,
} from "./documentSource";
import {
  isMusicXmlPath,
  musicXmlFingerings,
  openMusicXmlScore,
  preparePageImages,
  relayoutMusicXmlScore,
  showScoreDataFolder,
  showScoreSource,
  viewerIdsByKey,
} from "./musicxml";
import {
  isEditNavigation,
  rekeyFingeringLayers,
  useFingeringEditor,
  withFingeringLayers,
  type EditTarget,
} from "./fingeringEditor";
import { FingeringPageLayer, FingeringStatusStrip, FingeringToolbar } from "./FingeringEditorView";
import {
  useNoteByNoteHighwaySource,
  useRealtimeHighwaySource,
} from "./noteHighway/highwaySources";
import { pianoLayerForDynamic, type PianoId } from "./pianoRegistry";
import {
  cancelJob,
  chooseScore,
  getKeyboardRepeatTiming,
  getWorkerLogPath,
  loadPageArtifacts,
  nativeViewerAvailable,
  openCacheDirectory,
  openMusicXml,
  openPdf,
  pageImageUrl,
  readMusicXml,
  refreshMidiInputs,
  retryPage,
  subscribeToMidiInputChanges,
  subscribeToMidiMessages,
  subscribeToWorkerEvents,
  type WorkerEvent,
  writeMusicXml,
} from "./native";
import {
  commandForKeyboardEvent,
  commandForMidiShortcut,
  loadPlaybackShortcuts,
  midiShortcutFromBytes,
  midiShortcutIsRelease,
  midiShortcutSupportsHold,
  midiShortcutsEqual,
  savePlaybackShortcuts,
  type MidiShortcut,
  type PlaybackShortcuts,
} from "./shortcuts";
import type {
  DocumentPage,
  LoadedDocument,
  ViewportTransform,
  VisualGroupRef,
  VisualSidecarNote,
} from "./types";
import { isLinkedVisualGroup, isSelectableVisualGroup } from "./types";

/** A realtime route and where in it playback begins; a looping route starts over at its end. */
interface RealtimeStart {
  route: PerformanceRoute;
  offset: number;
  /** Quarters counted in before `offset`, when playback begins at the top of the score or loop. */
  leadIn: number;
  loops: boolean;
}

interface WorkerLogEntry {
  id: number;
  time: string;
  line: string;
}

const MAX_VISIBLE_WORKER_LOGS = 500;
const MIDI_REPEAT_DELAY_MS = 400;
const MIDI_REPEAT_INTERVAL_MS = 75;

interface ActiveMidiRepeat {
  command: PlaybackCommand;
  shortcut: MidiShortcut;
  delayId: number | null;
  intervalId: number | null;
}

function pendingPages(pageCount: number): DocumentPage[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    index,
    status: "pending",
    width: 850,
    height: 1100,
  }));
}

function noteSummary(notes: VisualSidecarNote[]): string {
  if (notes.length === 0) return "No linked MusicXML notes";
  return notes
    .map((note) => `${note.pitch ?? "rest"}, ${note.duration}, measure ${note.measure}`)
    .join(" / ");
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function replacePage(
  document: LoadedDocument,
  pageIndex: number,
  update: (page: DocumentPage) => DocumentPage,
): LoadedDocument {
  return {
    ...document,
    pages: document.pages.map((page) => (page.index === pageIndex ? update(page) : page)),
  };
}

function statusLabel(document: LoadedDocument): string {
  const { source } = document;
  if (source.kind === "musicxml") {
    if (document.status === "opening") return "Opening MusicXML…";
    if (document.fingeringStatus === "pending") return "Loading piano fingerings…";
    if (document.fingeringStatus === "predicting") return "Predicting piano fingerings…";
    if (document.fingeringStatus === "failed") return "MusicXML score · fingerings unavailable";
    return "MusicXML score";
  }
  if (document.status === "opening") return "Opening PDF…";
  if (document.status === "processing") {
    return source.cacheStatus === "complete" ? "Loading cached recognition…" : "Recognizing score…";
  }
  if (document.status === "partial") return "Finished with page errors";
  if (document.status === "cancelled") return "Cancelled — completed pages were cached";
  if (document.status === "failed") return "Document processing failed";
  if (document.fingeringStatus === "pending") return "Loading piano fingerings…";
  if (document.fingeringStatus === "predicting") return "Predicting piano fingerings…";
  if (document.fingeringStatus === "failed") return "Recognition complete · fingerings unavailable";
  return source.cacheStatus === "complete" ? "Loaded from cache" : "Recognition complete";
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isPlaybackToggleCommand(command: PlaybackCommand): boolean {
  return command === "togglePlayback" ||
    command === "stopPlayback" ||
    command === "togglePlaybackMode" ||
    command === "toggleNoteSounds" ||
    command === "toggleListenMode" ||
    command === "toggleRealtimeWait" ||
    command === "playCurrentNotes" ||
    command === "rewind" ||
    command === "toggleLoopMode" ||
    command === "toggleNoteHighway" ||
    command === "practiceLeftHand" ||
    command === "practiceRightHand" ||
    command === "resetTempo" ||
    command === "resetNoteStretch" ||
    // Held, a digit types on like any key, and undo keeps undoing; the editor's switches do not repeat.
    command === "toggleFingerEditing" ||
    command === "swapFingerHand";
}

/** Commands the fingering editor answers while playback is stopped for it. */
function worksWhileEditing(command: PlaybackCommand, editing: boolean): boolean {
  return editing && (isFingerEditCommand(command) || isEditNavigation(command) || command === "playCurrentNotes");
}

/** Commands that do something before playback starts. */
function commandWorksWhileStopped(command: PlaybackCommand): boolean {
  return command === "togglePlayback" ||
    command === "stopPlayback" ||
    command === "togglePlaybackMode" ||
    command === "practiceLeftHand" ||
    command === "practiceRightHand" ||
    command === "tempoUp" ||
    command === "tempoDown" ||
    command === "resetTempo" ||
    command === "stretchNotes" ||
    command === "compressNotes" ||
    command === "resetNoteStretch" ||
    // Editing fingers starts note-by-note playback.
    command === "toggleFingerEditing";
}

function RefreshRateDiagnostic() {
  const [refreshRate, setRefreshRate] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    let previous: number | null = null;
    const intervals: number[] = [];

    function sample(timestamp: number) {
      if (previous !== null) {
        const interval = timestamp - previous;
        if (interval > 4 && interval < 40) intervals.push(interval);
      }
      previous = timestamp;
      if (intervals.length >= 90) {
        intervals.sort((first, second) => first - second);
        setRefreshRate(Math.round(1000 / intervals[Math.floor(intervals.length / 2)]));
        intervals.length = 0;
      }
      frame = requestAnimationFrame(sample);
    }

    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <dt>Refresh rate</dt>
      <dd title="Measured requestAnimationFrame cadence">
        {refreshRate ? `~${refreshRate} Hz` : "Measuring…"}
      </dd>
    </>
  );
}

function midiPitches(pitches: readonly string[]): number[] {
  return Array.from(new Set(pitches.flatMap((pitch) => {
    const midi = pitchToMidi(pitch);
    return midi === null ? [] : [midi];
  }))).sort((left, right) => left - right);
}

function listenTargetKey(momentId: string | null | undefined, targetPitches: readonly number[]): string {
  return `${momentId ?? ""}:${targetPitches.join(",")}`;
}

/** Where realtime is in waiting for the player along one route, for one practice hand. */
interface RealtimeWait {
  route: PerformanceRoute;
  hand: PracticeHand;
  /** Tells this route's targets apart from another's that share an index. */
  serial: number;
  /** `ignored` are the pitches the player may add without spoiling `pitches`. */
  points: { onset: number; notes: PerformanceNote[]; pitches: number[]; ignored: ReadonlySet<number> }[];
  /** The point waited for next; past the last once every one has been played. */
  index: number;
}

function realtimeWaitListenTarget(wait: RealtimeWait | null): { key: string; target: number[] } {
  const point = wait?.points[wait.index];
  const target = point?.pitches ?? [];
  return {
    key: listenTargetKey(point ? `realtime-wait-${wait!.serial}-${wait!.index}` : null, target),
    target,
  };
}

/**
 * Realtime keeps sounding while listening to a MIDI keyboard, but a microphone would
 * hear the playback as notes the player pressed.
 */
function realtimeMuted(state: PlaybackState, inputSource: ListenInputSource): boolean {
  return !state.noteSoundsEnabled || (state.listenModeEnabled && inputSource === "microphone");
}

export function App() {
  const nativeAvailable = nativeViewerAvailable();
  const activeJobId = useRef<string | null>(null);
  const fingeringRequestRef = useRef<string | null>(null);
  const viewerViewportRef = useRef<{
    documentKey: string;
    transform: ViewportTransform;
  } | null>(null);
  const nextWorkerLogId = useRef(1);
  const workerLogOutput = useRef<HTMLDivElement | null>(null);
  const [activePage, setActivePage] = useState<"viewer" | "settings">("viewer");
  const [debugPanelEnabled, setDebugPanelEnabled] = useState(loadDebugPanelEnabled);
  const [sharedNoteheadTimingRepair, setSharedNoteheadTimingRepair] = useState(
    loadSharedNoteheadTimingRepair,
  );
  const [timeSignatureRepair, setTimeSignatureRepair] = useState(loadTimeSignatureRepair);
  const [tupletRepair, setTupletRepair] = useState(loadTupletRepair);
  const [playbackPiano, setPlaybackPiano] = useState(loadPlaybackPiano);
  const [listenInputSource, setListenInputSource] = useState(loadListenInputSource);
  const [loopDimOutside, setLoopDimOutside] = useState(loadLoopDimOutside);
  const [realtimeCountIn, setRealtimeCountIn] = useState(loadRealtimeCountIn);
  const [loopRestart, setLoopRestart] = useState(loadLoopRestart);
  const changeLoopRestart = useCallback((restart: LoopRestart) => {
    setLoopRestart(restart);
    saveLoopRestart(restart);
  }, []);
  const [keyboardView, setKeyboardView] = useState<KeyboardViewSettings>(loadKeyboardViewSettings);
  const changeKeyboardView = useCallback((next: KeyboardViewSettings) => {
    setKeyboardView(next);
    saveKeyboardViewSettings(next);
  }, []);
  const keyboardHandColors = useMemo(
    () => handColors(keyboardView),
    [keyboardView.leftHandColor, keyboardView.rightHandColor],
  );
  const listenInputSourceRef = useRef<ListenInputSource>(listenInputSource);
  listenInputSourceRef.current = listenInputSource;
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const [shortcuts, setShortcuts] = useState<PlaybackShortcuts>(loadPlaybackShortcuts);
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const [midiPorts, setMidiPorts] = useState<string[]>([]);
  const midiPortsRef = useRef(midiPorts);
  midiPortsRef.current = midiPorts;
  const [midiError, setMidiError] = useState<string | null>(null);
  const midiErrorRef = useRef(midiError);
  midiErrorRef.current = midiError;
  const [midiRefreshing, setMidiRefreshing] = useState(false);
  const midiRefreshInProgressRef = useRef(false);
  const [midiCaptureCommand, setMidiCaptureCommand] = useState<PlaybackCommand | null>(null);
  const midiCaptureCommandRef = useRef<PlaybackCommand | null>(null);
  const activeMidiRepeatRef = useRef<ActiveMidiRepeat | null>(null);
  const midiRepeatTimingRef = useRef({
    delayMs: MIDI_REPEAT_DELAY_MS,
    intervalMs: MIDI_REPEAT_INTERVAL_MS,
  });
  const [document, setDocument] = useState<LoadedDocument | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<VisualGroupRef | null>(null);
  const [highlightAllNotes, setHighlightAllNotes] = useState(false);
  const [showOriginalNoteheadContours, setShowOriginalNoteheadContours] = useState(false);
  const [showDetectedNoteheadContours, setShowDetectedNoteheadContours] = useState(false);
  const [showRefinedNoteheadContours, setShowRefinedNoteheadContours] = useState(false);
  const [showRawStemContours, setShowRawStemContours] = useState(false);
  const [showDiagnosticVisualGroups, setShowDiagnosticVisualGroups] = useState(false);
  const [showUnsupportedRests, setShowUnsupportedRests] = useState(false);
  const [showValueMismatches, setShowValueMismatches] = useState(false);
  const [workerInfo, setWorkerInfo] = useState<string | null>(null);
  const [workerLogs, setWorkerLogs] = useState<WorkerLogEntry[]>([]);
  const [workerLogPath, setWorkerLogPath] = useState<string | null>(null);
  const [showWorkerLogs, setShowWorkerLogs] = useState(false);
  const [playbackAudioError, setPlaybackAudioError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    nativeAvailable ? null : "PDF processing is available in the Tauri desktop app. Run npm run tauri dev.",
  );
  const realtimeModel = useMemo(() => {
    if (!document?.documentMusicXml) return { score: null, error: null };
    try {
      return { score: parseRealtimeMusicXml(document.documentMusicXml), error: null };
    } catch (modelError) {
      return {
        score: null,
        error: modelError instanceof Error ? modelError.message : String(modelError),
      };
    }
  }, [document?.documentMusicXml]);
  const noteGeometry = useMemo(
    () => documentNoteGeometry(document?.source.kind, document?.pages ?? []),
    [document?.pages, document?.source.kind],
  );
  const noteFacts = useMemo(
    () => documentNoteScoreFacts(document?.source.kind, document?.pages ?? [], realtimeModel.score),
    [document?.pages, document?.source.kind, realtimeModel.score],
  );
  const fullPlaybackTimeline = useMemo(
    () => buildPlaybackTimeline(noteGeometry, noteFacts, document?.predictedFingerings),
    [document?.predictedFingerings, noteFacts, noteGeometry],
  );
  // Practice-hand settings are per session and start from ordinary playback.
  const [practiceHand, setPracticeHand] = useState<PracticeHand>("both");
  const practiceHandRef = useRef(practiceHand);
  practiceHandRef.current = practiceHand;
  const [practicedHandSoundEnabled, setPracticedHandSoundEnabled] = useState(true);
  const [otherHandSoundEnabled, setOtherHandSoundEnabled] = useState(false);
  // Note-by-note steps through, highlights, sounds and listens for this timeline;
  // it is the full one unless a single hand is being practised.
  const playbackTimeline = useMemo(
    () => timelineForPracticeHand(fullPlaybackTimeline, practiceHand),
    [fullPlaybackTimeline, practiceHand],
  );
  const realtimeVisualMap = useMemo(
    () => buildRealtimeVisualMap(noteGeometry),
    [noteGeometry],
  );
  // Loop mode belongs to one run of playback. Turning it on always loops the bar being
  // played; turning it off, or stopping playback, forgets the bars it looped.
  const [loopMode, setLoopMode] = useState(false);
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(null);
  const [loopPass, setLoopPass] = useState(1);
  const scoreSystems = useMemo(() => loopSystems(noteGeometry), [noteGeometry]);
  const documentMeasureCount = realtimeModel.score?.measures.length ?? loopMeasureCount(scoreSystems);
  const loop = loopMode && loopRegion ? clampLoopRegion(loopRegion, documentMeasureCount) : null;
  // Read by callbacks that must see a loop change in the same event that makes it.
  const loopRef = useRef<LoopRegion | null>(loop);
  loopRef.current = loop;
  const realtimeOpeningBpm = realtimeModel.score?.measures[0]?.tempos
    .filter((tempo) => tempo.onset <= 0)
    .at(-1)?.bpm ?? 120;
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("note-by-note");
  const playbackModeRef = useRef(playbackMode);
  playbackModeRef.current = playbackMode;
  const [realtimeStatus, setRealtimeStatus] = useState<"inactive" | "playing" | "paused">("inactive");
  const [realtimeFrame, setRealtimeFrame] = useState<{
    status: "playing" | "paused";
    offset: number;
    bpm: number;
    activeNotes: PerformanceNote[];
    waiting?: boolean;
  } | null>(null);
  const realtimeLatestFrameRef = useRef<{
    status: "playing" | "paused";
    offset: number;
    bpm: number;
    activeNotes: PerformanceNote[];
    waiting?: boolean;
  } | null>(null);
  const realtimeRenderSignatureRef = useRef("");
  const [tempoMultiplier, setTempoMultiplier] = useState(1);
  const tempoMultiplierRef = useRef(tempoMultiplier);
  tempoMultiplierRef.current = tempoMultiplier;
  const changeTempoMultiplier = useCallback((multiplier: number) => {
    tempoMultiplierRef.current = multiplier;
    setTempoMultiplier(multiplier);
    realtimeControllerRef.current?.setTempoMultiplier(multiplier);
  }, []);
  const [noteHighwayEnabled, setNoteHighwayEnabled] = useState(loadNoteHighwayEnabled);
  const [loopDragging, setLoopDragging] = useState(false);
  const realtimeRouteRef = useRef<PerformanceRoute | null>(null);
  /** The realtime route is a loop's, which starts over at its end. */
  const realtimeRouteLoopsRef = useRef(false);
  /** Quarters counted in before the realtime route's first pass; see RealtimeStart. */
  const realtimeLeadInRef = useRef(0);
  const realtimeStartGenerationRef = useRef(0);
  // While listening, realtime can wait at each note until the player plays it.
  const [realtimeWaitEnabled, setRealtimeWaitEnabled] = useState(false);
  const realtimeWaitEnabledRef = useRef(realtimeWaitEnabled);
  realtimeWaitEnabledRef.current = realtimeWaitEnabled;
  const realtimeWaitRef = useRef<RealtimeWait | null>(null);
  /** The notes realtime waits for next, shown in place of those sounding while it waits. */
  const [realtimeWaitNotes, setRealtimeWaitNotes] = useState<PerformanceNote[] | null>(null);
  const realtimeWaitSerialRef = useRef(0);
  /** Set once syncRealtimeWait exists, for the realtime controller's callbacks. */
  const syncRealtimeWaitRef = useRef<(advance?: boolean) => void>(() => undefined);
  const documentPagesRef = useRef(document?.pages ?? []);
  documentPagesRef.current = document?.pages ?? [];
  const [playbackState, setPlaybackState] = useState(initialPlaybackState);
  const playbackStateRef = useRef(playbackState);
  playbackStateRef.current = playbackState;
  const playbackStatus: PlaybackStatus = playbackMode === "realtime"
    ? realtimeStatus
    : playbackState.active ? "note-by-note" : "inactive";
  const playbackActive = playbackStatus !== "inactive";
  const playbackActiveRef = useRef(playbackActive);
  playbackActiveRef.current = playbackActive;
  useEffect(() => {
    if (playbackActive) return;
    setLoopMode(false);
    setLoopRegion(null);
    setLoopPass(1);
  }, [playbackActive]);
  const notePlaybackMoment = currentPlaybackMoment(playbackTimeline, playbackState);
  // Kept from one frame to the next, so renders the frame did not cause, such as
  // listen feedback, leave the moment, and the view following it, alone.
  const documentPages = document?.pages;
  const realtimePlayhead = useMemo(
    () => realtimeFrame && realtimeRouteRef.current && documentPages
      ? realtimePlayheadAt(
          realtimeRouteRef.current,
          realtimeFrame.offset,
          documentPages,
          routeEndBarline(scoreSystems, realtimeRouteRef.current),
          routeStartBarline(scoreSystems, realtimeRouteRef.current),
          -realtimeLeadInRef.current,
        )
      : null,
    [documentPages, realtimeFrame, scoreSystems],
  );
  const scoreSystemsRef = useRef(scoreSystems);
  scoreSystemsRef.current = scoreSystems;
  const getRealtimePlayhead = useCallback(() => {
    const frame = realtimeLatestFrameRef.current;
    const route = realtimeRouteRef.current;
    const systems = scoreSystemsRef.current;
    return frame && route
      ? realtimePlayheadAt(
          route,
          frame.offset,
          documentPagesRef.current,
          routeEndBarline(systems, route),
          routeStartBarline(systems, route),
          -realtimeLeadInRef.current,
        )
      : null;
  }, []);
  // Realtime is held now until the player plays the notes it waits for.
  const realtimeWaiting = playbackMode === "realtime" && realtimeFrame?.status === "playing" && realtimeFrame.waiting === true;
  // Held for the player, realtime shows the notes to play rather than those still sounding.
  const realtimeShownNotes = useMemo(
    () => realtimeFrame?.waiting && realtimeWaitNotes ? realtimeWaitNotes : realtimeFrame?.activeNotes ?? [],
    [realtimeFrame, realtimeWaitNotes],
  );
  const realtimeDisplayNotes = useMemo(() => {
    if (!realtimeFrame) return [];
    return realtimeShownNotes
      .map((note) => {
        const fingeringId = note.fingeringMusicXmlId === undefined
          ? note.musicXmlId
          : note.fingeringMusicXmlId;
        const predicted = fingeringId ? document?.predictedFingerings?.[fingeringId] : undefined;
        return { pitch: note.pitch, ...(note.left === undefined ? {} : { left: note.left }), ...predicted };
      })
      // A note's fingering names its hand, which the player may have moved from the staff's.
      .filter((note) => noteInPracticeHand(note.left, practiceHand));
  }, [document?.predictedFingerings, practiceHand, realtimeFrame, realtimeShownNotes]);
  const realtimeGroupIdsByPage = useMemo(() => {
    const sounding = realtimeShownNotes.flatMap((note) =>
      note.visual && noteInPracticeHand(note.left, practiceHand)
        ? [{
            pageIndex: note.visual.pageIndex,
            visualGroupId: note.visual.visualGroupId,
          }]
        : [],
    );
    return visualGroupIdsByPage(sounding);
  }, [practiceHand, realtimeShownNotes]);
  const realtimeMoment = useMemo(() => {
    if (!realtimeFrame || !realtimeRouteRef.current) return null;
    const route = realtimeRouteRef.current;
    const visible = realtimeShownNotes.filter((note) => note.visual !== null);
    const placed = (route.playheadNotes ?? route.notes).filter((note) => note.visual !== null);
    const nearest = placed.filter((note) => note.onset <= realtimeFrame.offset + 1e-6).at(-1);
    // Before the first note, in a count-in, the view waits on the bar it begins.
    const anchor = visible[0] ?? nearest ?? placed[0];
    if (!anchor?.visual) return null;
    const sameSystem = visible.filter((note) =>
      note.visual?.pageIndex === anchor.visual?.pageIndex &&
      note.visual?.staffGroupIndex === anchor.visual?.staffGroupIndex,
    );
    const groupIds = Array.from(new Set(
      (sameSystem.length > 0 ? sameSystem : [anchor]).flatMap((note) =>
        note.visual ? [note.visual.visualGroupId] : [],
      ),
    ));
    return {
      id: `realtime-${anchor.id}`,
      pageIndex: anchor.visual.pageIndex,
      staffGroupIndex: anchor.visual.staffGroupIndex,
      measure: null,
      measureIndex: null,
      barKey: `realtime-${anchor.visual.pageIndex}`,
      visualGroupIds: groupIds,
      pitches: realtimeShownNotes.map((note) => note.pitch),
      keyboardNotes: realtimeDisplayNotes,
      dynamic: realtimeFrame.activeNotes.find((note) => note.onset <= realtimeFrame.offset + 1e-6)?.dynamic ?? "mp",
      center: [realtimePlayhead?.x ?? anchor.visual.x, anchor.visual.y] as [number, number],
    };
  }, [realtimeDisplayNotes, realtimeFrame, realtimePlayhead, realtimeShownNotes]);
  const playbackMoment = playbackMode === "realtime" ? realtimeMoment : notePlaybackMoment;
  const playbackPitchKey = notePlaybackMoment?.pitches.join("|") ?? "";
  const realtimeControllerRef = useRef<RealtimeController | null>(null);
  if (!realtimeControllerRef.current) {
    realtimeControllerRef.current = new RealtimeController(
      {
        attack: (pitches, dynamic) => pianoSampler.attack(pitches, dynamic),
        release: (pitches) => pianoSampler.release(pitches),
        stop: () => pianoSampler.stop(),
      },
      {
        onFrame: (frame) => {
          realtimeLatestFrameRef.current = frame;
          const signature = `${frame.status}:${frame.waiting ? "waiting" : ""}:${frame.bpm}:${frame.activeNotes
            .map((note) => `${note.musicXmlId}:${note.pitch}`)
            .join(",")}`;
          if (signature !== realtimeRenderSignatureRef.current) {
            realtimeRenderSignatureRef.current = signature;
            setRealtimeStatus(frame.status);
            setRealtimeFrame(frame);
          }
        },
        onLoop: (leadIn) => {
          realtimeLeadInRef.current = leadIn;
          setLoopPass((pass) => pass + 1);
          // Each pass waits for every note again.
          syncRealtimeWaitRef.current();
        },
        onComplete: () => {
          realtimeRouteRef.current = null;
          realtimeWaitRef.current = null;
          realtimeRouteLoopsRef.current = false;
          realtimeLeadInRef.current = 0;
          realtimeLatestFrameRef.current = null;
          realtimeRenderSignatureRef.current = "";
          setRealtimeStatus("inactive");
          setRealtimeFrame(null);
        },
      },
      {
        now: () => pianoSampler.now(),
        setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
        clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
      },
    );
  }
  const noteHighwayShown = noteHighwayEnabled && playbackActive;
  // A dragged loop handle needs the score the highway covers, so the highway steps
  // aside until it is dropped; it stays mounted to keep its WebGL context.
  const noteHighwayVisible = noteHighwayShown && !loopDragging;
  const getRealtimeRoute = useCallback(() => realtimeRouteRef.current, []);
  const getRealtimeOffset = useCallback(
    () => realtimeControllerRef.current?.getOffset() ?? 0,
    [],
  );
  const getRealtimeRouteLoops = useCallback(() => realtimeRouteLoopsRef.current, []);
  const getRealtimeLoopLeadIn = useCallback(() => realtimeControllerRef.current?.loopLeadIn() ?? 0, []);
  // A loop that counts in to each pass takes the count-in's length; with it off, it
  // loops immediately.
  useEffect(() => {
    realtimeControllerRef.current?.setLoopCountIn(
      loopRestart === "count-in" ? REALTIME_COUNT_IN_SECONDS[realtimeCountIn] : 0,
    );
  }, [loopRestart, realtimeCountIn]);
  const realtimeHighwayFrame = useRealtimeHighwaySource(
    getRealtimeRoute,
    getRealtimeOffset,
    tempoMultiplier,
    practiceHand,
    getRealtimeRouteLoops,
    document?.predictedFingerings,
    keyboardView.timeScale === "fixed-tempo" ? realtimeOpeningBpm : null,
    keyboardView.timeZoom,
    getRealtimeLoopLeadIn,
  );
  // The keys the keyboard and highway show, from every note of the score, so the
  // range holds still for the whole piece.
  const keyboardRange = useMemo(
    () => keyboardRangeForSetting(
      keyboardView.range,
      keyboardView.minimumWhiteKeys,
      fullPlaybackTimeline.flatMap((moment) => moment.keyboardNotes),
      practiceHand,
    ),
    [fullPlaybackTimeline, keyboardView.minimumWhiteKeys, keyboardView.range, practiceHand],
  );
  const keyboardSolid = noteHighwayShown && keyboardView.keyboard3d;
  const highwayView = useMemo(() => ({
    range: keyboardRange,
    tilt: keyboardView.tilt,
    keyboard3d: keyboardSolid,
    colors: keyboardHandColors,
    noteStyle: keyboardView.noteStyle,
    whiteNoteWidth: keyboardView.whiteNoteWidth,
    noteLabels: keyboardView.highwayNoteLabels,
    blackKeyWidth: keyboardView.blackKeyWidth,
  }), [
    keyboardHandColors,
    keyboardRange,
    keyboardSolid,
    keyboardView.blackKeyWidth,
    keyboardView.highwayNoteLabels,
    keyboardView.noteStyle,
    keyboardView.tilt,
    keyboardView.whiteNoteWidth,
  ]);
  const keyboardDisplay = useMemo(() => ({
    octaveLabels: keyboardView.octaveLabels,
    fingerNumbers: keyboardView.fingerNumbers,
    noteNames: keyboardView.noteNames,
    upcomingEffect: keyboardView.upcomingEffect,
  }), [keyboardView.fingerNumbers, keyboardView.noteNames, keyboardView.octaveLabels, keyboardView.upcomingEffect]);
  // The loop in the highway's note-by-note steps: from its first practised moment up to
  // the step after its last.
  const noteByNoteLoopSteps = useMemo(() => {
    if (!loop) return null;
    const first = playbackTimeline.findIndex((moment) => measureInLoop(moment.measureIndex, loop));
    if (first < 0) return null;
    let last = playbackTimeline.length - 1;
    while (!measureInLoop(playbackTimeline[last].measureIndex, loop)) last -= 1;
    return { start: first, end: last + 1 };
  }, [loop?.startMeasure, loop?.endMeasure, playbackTimeline]);
  const noteByNoteHighwayFrame = useNoteByNoteHighwaySource(
    fullPlaybackTimeline,
    notePlaybackMoment ? Math.max(0, playbackTimeline.indexOf(notePlaybackMoment)) : 0,
    practiceHand,
    noteByNoteLoopSteps,
    keyboardView.timeZoom,
  );
  // Both hands sound in ordinary playback. Practising one hand, each hand follows
  // its own switch; accompaniment by the other hand exists in realtime only,
  // since note-by-note skips most of that hand's moments.
  const practicedHandAudible = practiceHand === "both" || practicedHandSoundEnabled;
  const otherHandAudible = practiceHand === "both" ||
    (playbackMode === "realtime" && otherHandSoundEnabled);
  useEffect(() => {
    realtimeControllerRef.current?.setAudibleHands(practiceHand === "both"
      ? { left: true, right: true }
      : practiceHand === "left"
        ? { left: practicedHandAudible, right: otherHandAudible }
        : { left: otherHandAudible, right: practicedHandAudible });
  }, [otherHandAudible, practiceHand, practicedHandAudible]);
  const practicedHandAudibleRef = useRef(practicedHandAudible);
  practicedHandAudibleRef.current = practicedHandAudible;
  const changeNoteHighwayEnabled = useCallback((enabled: boolean) => {
    saveNoteHighwayEnabled(enabled);
    setNoteHighwayEnabled(enabled);
  }, []);
  const toggleNoteHighway = useCallback(() => {
    changeNoteHighwayEnabled(!noteHighwayEnabled);
  }, [changeNoteHighwayEnabled, noteHighwayEnabled]);
  const handlePracticeHandChange = useCallback((hand: PracticeHand) => {
    if (hand === practiceHand) return;
    setPracticeHand(hand);
    // Keep note-by-note on a moment the new hand plays, rather than letting the
    // playhead fall back to the start. The hand and the moment land in the same
    // render, and listen mode retargets from it like any other move.
    const state = playbackStateRef.current;
    if (!state.active || !state.currentMomentId) return;
    const handTimeline = timelineForPracticeHand(fullPlaybackTimeline, hand);
    const currentMomentId = snapMomentToTimeline(
      fullPlaybackTimeline,
      handTimeline,
      state.currentMomentId,
    );
    const next = loopNoteByNoteState(
      handTimeline,
      state,
      { ...state, currentMomentId },
      null,
      loopRef.current,
    ).state;
    if (next.currentMomentId === state.currentMomentId) return;
    playbackStateRef.current = next;
    setPlaybackState(next);
  }, [fullPlaybackTimeline, practiceHand]);
  const recognizerRef = useRef<NoteRecognizer | null>(null);
  // Debug-surface only, and deliberately not persisted: a reload, and switching
  // the debug panel off, both return listen mode to the production default.
  const [listenMatcherProfileOverride, setListenMatcherProfileOverride] =
    useState<ListenMatcherProfileId | null>(null);
  const listenMatcherProfile = resolveEffectiveListenMatcherProfile(listenMatcherProfileOverride);
  const chordMatcherRef = useRef(new ExactChordMatcher(
    matcherOptionsForListenMatcherProfile(listenMatcherProfile),
  ));
  // MIDI reports exactly which keys are down, so a chord held down also counts there,
  // however its notes arrived; see HeldChordMatcher.
  const heldChordMatcherRef = useRef(new HeldChordMatcher(
    matcherOptionsForListenMatcherProfile(listenMatcherProfile).settleMs,
  ));
  /** The listen generation whose target was last matched, so each matches once. */
  const matchedListenGenerationRef = useRef<number | null>(null);
  const keyboardRecognitionRef = useRef(new KeyboardRecognitionTracker());
  const playheadGenerationRef = useRef(0);
  const listenTargetKeyRef = useRef<string | null>(null);
  const listenOperationRef = useRef(0);
  const auditionOperationRef = useRef(0);
  const [listenFeedback, setListenFeedback] = useState<ListenModeFeedback>({
    lifecycle: stoppedRecognizerLifecycle,
    targetPitches: [],
    detectedTargetPitches: [],
    extraPitches: [],
    targetPitchConfidences: [],
    recognizedActivePitches: [],
    attackPitches: [],
    successPitches: [],
    processingTimeMs: null,
  });
  /** Listens for `target`, keyed by `targetKey`, unless it already does. */
  const applyListenTarget = useCallback((targetKey: string, target: number[]) => {
    const recognizer = recognizerRef.current;
    if (!recognizer || listenTargetKeyRef.current === targetKey) return;
    const generation = ++playheadGenerationRef.current;
    listenTargetKeyRef.current = targetKey;
    recognizer.setTarget(target);
    recognizer.setGeneration(generation);
    chordMatcherRef.current.setTarget(target, generation, performance.now());
    heldChordMatcherRef.current.setTarget(target);
    keyboardRecognitionRef.current.suppressVisibleUntilRelease();
    setListenFeedback((feedback) => ({
      ...feedback,
      targetPitches: target,
      detectedTargetPitches: [],
      extraPitches: [],
      targetPitchConfidences: target.map((midi) => ({ midi, confidence: 0 })),
      recognizedActivePitches: [],
      attackPitches: [],
      processingTimeMs: null,
    }));
  }, []);
  const retargetListenMode = useCallback((state: PlaybackState) => {
    if (!state.listenModeEnabled || !recognizerRef.current) return;
    // Note-by-note waits for its chord; realtime waits only while asked to.
    if (playbackMode === "realtime") {
      const { key, target } = realtimeWaitListenTarget(realtimeWaitRef.current);
      applyListenTarget(key, target);
      return;
    }
    const moment = currentPlaybackMoment(playbackTimeline, state);
    const target = midiPitches(moment?.pitches ?? []);
    applyListenTarget(listenTargetKey(moment?.id, target), target);
  }, [applyListenTarget, playbackMode, playbackTimeline]);
  /**
   * Holds realtime before the next notes of the practised hand the player has yet to
   * play, and listens for them, while listening with waiting switched on; otherwise
   * lets it play freely. `advance` moves on from notes just played; without it, the
   * next notes are the first not yet behind the playhead, as after a seek.
   */
  const syncRealtimeWait = useCallback((advance = false) => {
    const controller = realtimeControllerRef.current;
    const route = realtimeRouteRef.current;
    const realtime = playbackModeRef.current === "realtime";
    const listening = playbackStateRef.current.listenModeEnabled;
    if (!realtime || !listening || !realtimeWaitEnabledRef.current || !route) {
      realtimeWaitRef.current = null;
      controller?.setHold(null);
    } else {
      const hand = practiceHandRef.current;
      let wait = realtimeWaitRef.current;
      if (!wait || wait.route !== route || wait.hand !== hand) {
        const points = realtimeWaitPoints(route, (note) => noteInPracticeHand(note.left, hand))
          .map((point) => {
            const pitches = midiPitches(point.notes.map((note) => note.pitch));
            return {
              onset: point.onset,
              notes: point.notes,
              pitches,
              ignored: new Set(midiPitches(point.ignoredPitches).filter((midi) => !pitches.includes(midi))),
            };
          })
          .filter((point) => point.pitches.length > 0);
        wait = { route, hand, serial: ++realtimeWaitSerialRef.current, points, index: 0 };
        realtimeWaitRef.current = wait;
        advance = false;
      }
      wait.index = advance
        ? Math.min(wait.points.length, wait.index + 1)
        : realtimeWaitPointIndex(wait.points, controller?.getOffset() ?? 0);
      const point = wait.points[wait.index];
      controller?.setHold(point ? point.onset - REALTIME_WAIT_LEAD_QUARTERS : null);
    }
    setRealtimeWaitNotes(realtimeWaitRef.current?.points[realtimeWaitRef.current.index]?.notes ?? null);
    if (realtime && listening) {
      const { key, target } = realtimeWaitListenTarget(realtimeWaitRef.current);
      applyListenTarget(key, target);
    }
  }, [applyListenTarget]);
  syncRealtimeWaitRef.current = syncRealtimeWait;
  // Another hand waits for other notes, and only realtime waits this way.
  useEffect(() => {
    syncRealtimeWait();
  }, [playbackMode, practiceHand, syncRealtimeWait]);
  /** Waiting needs listening to hear the notes, but it can always be switched off. */
  const toggleRealtimeWait = useCallback(() => {
    const enabled = !realtimeWaitEnabledRef.current;
    if (
      enabled &&
      (playbackModeRef.current !== "realtime" || !playbackStateRef.current.listenModeEnabled)
    ) return;
    realtimeWaitEnabledRef.current = enabled;
    setRealtimeWaitEnabled(enabled);
    syncRealtimeWait();
  }, [syncRealtimeWait]);
  /**
   * `command` is what moved playback, when a command did: leaving the loop forwards
   * from inside it starts the loop's next pass.
   */
  const commitPlaybackState = useCallback(
    (proposed: PlaybackState, playNormalSound = true, command: PlaybackCommand | null = null) => {
      const previous = playbackStateRef.current;
      const looped = loopNoteByNoteState(playbackTimeline, previous, proposed, command, loopRef.current);
      const next = looped.state;
      if (looped.nextPass) setLoopPass((pass) => pass + 1);
      else if (next.active && !previous.active) setLoopPass(1);
      const previousMomentId = previous.currentMomentId;
      playbackStateRef.current = next;
      setPlaybackState(next);
      if (next.currentMomentId !== previousMomentId) retargetListenMode(next);
      // A practised-hand moment holds only that hand's notes, so its own switch decides.
      if (!playNormalSound || !effectivePlaybackNoteSounds(next) || !practicedHandAudibleRef.current) {
        pianoSampler.stop();
        setPlaybackAudioError(null);
        return;
      }
      const moment = currentPlaybackMoment(playbackTimeline, next);
      if (moment) {
        void pianoSampler.play(moment.pitches, moment.dynamic)
          .then(() => setPlaybackAudioError(null))
          .catch((audioError: unknown) => {
            const message = audioError instanceof Error ? audioError.message : String(audioError);
            setPlaybackAudioError(`Piano audio could not start: ${message}`);
          });
      }
    },
    [playbackTimeline, retargetListenMode],
  );
  const stopRealtime = useCallback(() => {
    realtimeStartGenerationRef.current += 1;
    realtimeControllerRef.current?.stop();
    realtimeRouteRef.current = null;
    realtimeWaitRef.current = null;
    realtimeRouteLoopsRef.current = false;
    realtimeLeadInRef.current = 0;
    realtimeLatestFrameRef.current = null;
    realtimeRenderSignatureRef.current = "";
    setRealtimeStatus("inactive");
    setRealtimeFrame(null);
    setPlaybackAudioError(null);
  }, []);
  /**
   * Applies the debug-surface profile override.
   *
   * The matcher carries per-target state, so switching thresholds underneath a
   * passage in progress would let one advancement decision be made from two
   * profiles. Listen mode is therefore stopped and the matcher rebuilt, the same
   * way changing the playback piano tears down the audio path it reconfigures.
   */
  const applyListenMatcherProfileOverride = useCallback((
    profileId: ListenMatcherProfileId | null,
  ) => {
    if (profileId === listenMatcherProfileOverride) return;
    recognizerRef.current?.stop();
    stopRealtime();
    pianoSampler.stop();
    playbackStateRef.current = initialPlaybackState;
    setPlaybackState(initialPlaybackState);
    const matcherOptions = matcherOptionsForListenMatcherProfile(resolveEffectiveListenMatcherProfile(profileId));
    chordMatcherRef.current = new ExactChordMatcher(matcherOptions);
    heldChordMatcherRef.current = new HeldChordMatcher(matcherOptions.settleMs);
    setListenMatcherProfileOverride(profileId);
  }, [listenMatcherProfileOverride, stopRealtime]);
  /** The count-in before `offset`, in quarters, at the tempo playing as it starts. */
  const leadInFor = useCallback(
    (route: PerformanceRoute, offset: number) =>
      realtimeLeadIn(route, offset, REALTIME_COUNT_IN_SECONDS[realtimeCountIn], tempoMultiplierRef.current),
    [realtimeCountIn],
  );
  /**
   * The route realtime plays from a position, and where in it to begin. While looping it
   * is the loop's own route, which starts over at its end; a position outside the loop
   * begins at the loop's start. No position, from the play button with nothing selected
   * or a rewind, begins at the top with a count-in, and so does a loop begun from outside
   * it; a chosen note plays at once, unless `countIn` asks for one, and a loop starting
   * over plays straight on.
   */
  const routeForPosition = useCallback((
    position: StructuralPosition | null,
    countIn = false,
  ): RealtimeStart | null => {
    if (!realtimeModel.score) return null;
    const loopRegion = loopRef.current;
    if (loopRegion) {
      const route = expandPerformanceRoute(realtimeModel.score, {
        startMeasureIndex: loopRegion.startMeasure,
        endMeasureIndex: loopRegion.endMeasure,
        visualMap: realtimeVisualMap,
      });
      if (route.totalQuarters > 0) {
        const inLoop = position ? loopRouteOffset(route, position) : null;
        return inLoop === null
          ? { route, offset: 0, leadIn: leadInFor(route, 0), loops: true }
          : { route, offset: inLoop, leadIn: countIn ? leadInFor(route, inLoop) : 0, loops: true };
      }
    }
    const route = expandPerformanceRoute(realtimeModel.score, {
      startMeasureIndex: position?.measureIndex ?? 0,
      startOffset: position?.onset ?? 0,
      visualMap: realtimeVisualMap,
    });
    return { route, offset: 0, leadIn: position && !countIn ? 0 : leadInFor(route, 0), loops: false };
  }, [leadInFor, realtimeModel.score, realtimeVisualMap]);
  const routeForGroup = useCallback((group: VisualGroupRef | null): RealtimeStart | null => {
    const position = realtimeModel.score
      ? structuralPositionForGroup(realtimeModel.score, realtimeVisualMap, group)
      : null;
    return routeForPosition(position);
  }, [realtimeModel.score, realtimeVisualMap, routeForPosition]);
  const startRealtime = useCallback((group: VisualGroupRef | null, status: "playing" | "paused" = "playing") => {
    let start: RealtimeStart | null;
    try {
      start = routeForGroup(group);
    } catch (routeError) {
      setPlaybackAudioError(
        `Realtime playback could not build a safe route: ${routeError instanceof Error ? routeError.message : String(routeError)}`,
      );
      return;
    }
    if (!start) return;
    const { route } = start;
    const generation = ++realtimeStartGenerationRef.current;
    realtimeRouteRef.current = route;
    realtimeRouteLoopsRef.current = start.loops;
    realtimeLeadInRef.current = start.leadIn;
    realtimeLatestFrameRef.current = null;
    realtimeRenderSignatureRef.current = "";
    setRealtimeStatus(status);
    setLoopPass(1);
    const routeLayers = Array.from(new Set(
      route.notes.map((note) => pianoLayerForDynamic(playbackPiano, note.dynamic)),
    ));
    void Promise.all([pianoSampler.prepare(), pianoSampler.preload(routeLayers)])
      .then(() => {
        if (generation !== realtimeStartGenerationRef.current) return;
        const controller = realtimeControllerRef.current;
        if (!controller) return;
        controller.setTempoMultiplier(tempoMultiplier);
        controller.setMuted(realtimeMuted(playbackStateRef.current, listenInputSourceRef.current));
        controller.setLooping(start!.loops);
        controller.seek(route, status, start!.offset, start!.leadIn);
        syncRealtimeWait();
        setPlaybackAudioError(null);
      })
      .catch((audioError: unknown) => {
        if (generation !== realtimeStartGenerationRef.current) return;
        stopRealtime();
        setPlaybackAudioError(`Piano audio could not start: ${audioError instanceof Error ? audioError.message : String(audioError)}`);
      });
  }, [playbackPiano, routeForGroup, stopRealtime, syncRealtimeWait, tempoMultiplier]);
  /** Moves realtime playback onto `start`, keeping it playing or paused. */
  const seekRealtimeStart = useCallback((start: RealtimeStart, status: "playing" | "paused") => {
    realtimeRouteRef.current = start.route;
    realtimeRouteLoopsRef.current = start.loops;
    realtimeLeadInRef.current = start.leadIn;
    realtimeLatestFrameRef.current = null;
    realtimeRenderSignatureRef.current = "";
    realtimeControllerRef.current?.setLooping(start.loops);
    realtimeControllerRef.current?.seek(start.route, status, start.offset, start.leadIn);
    syncRealtimeWait();
    setPlaybackAudioError(null);
  }, [syncRealtimeWait]);
  const seekRealtime = useCallback((group: VisualGroupRef, status: "playing" | "paused") => {
    try {
      const start = routeForGroup(group);
      if (!start) return;
      seekRealtimeStart(start, status);
    } catch (routeError) {
      stopRealtime();
      setPlaybackAudioError(
        `Realtime playback could not build a safe route: ${routeError instanceof Error ? routeError.message : String(routeError)}`,
      );
    }
  }, [routeForGroup, seekRealtimeStart, stopRealtime]);
  const seekRealtimePosition = useCallback((
    position: StructuralPosition | null,
    status: "playing" | "paused",
    countIn = false,
  ) => {
    try {
      const start = routeForPosition(position, countIn);
      if (!start) return;
      seekRealtimeStart(start, status);
    } catch (routeError) {
      stopRealtime();
      setPlaybackAudioError(
        `Realtime playback could not build a safe route: ${routeError instanceof Error ? routeError.message : String(routeError)}`,
      );
    }
  }, [routeForPosition, seekRealtimeStart, stopRealtime]);
  const applyPlaybackStateCommand = useCallback(
    (command: PlaybackCommand) => {
      if (playbackMode === "realtime") {
        if (command === "stopPlayback") {
          stopRealtime();
          return;
        }
        if (command === "togglePlayback") {
          if (realtimeStatus === "playing") realtimeControllerRef.current?.pause();
          else if (realtimeStatus === "paused") realtimeControllerRef.current?.resume();
          // Entering realtime waits, paused, for the play button, as from note-by-note.
          else startRealtime(selectedGroup, "paused");
          return;
        }
        if (command === "toggleNoteSounds") {
          const next = {
            ...playbackStateRef.current,
            noteSoundsEnabled: !playbackStateRef.current.noteSoundsEnabled,
          };
          playbackStateRef.current = next;
          setPlaybackState(next);
          realtimeControllerRef.current?.setMuted(realtimeMuted(next, listenInputSourceRef.current));
          return;
        }
        if (
          command === "toggleListenMode" ||
          command === "toggleRealtimeWait" ||
          command === "playCurrentNotes" ||
          command === "togglePlaybackMode" ||
          command === "toggleLoopMode" ||
          command === "toggleNoteHighway" ||
          command === "practiceLeftHand" ||
          command === "practiceRightHand" ||
          command === "tempoUp" ||
          command === "tempoDown" ||
          command === "resetTempo" ||
          command === "stretchNotes" ||
          command === "compressNotes" ||
          command === "resetNoteStretch" ||
          isLoopBoundaryCommand(command) ||
          isFingerEditCommand(command)
        ) return;
        if (realtimeStatus === "inactive" || !realtimeModel.score) return;
        if (command === "rewind") {
          // No position starts the score, or the loop's own route while looping.
          seekRealtimePosition(null, realtimeStatus);
          return;
        }
        const route = realtimeRouteRef.current;
        const offset = realtimeControllerRef.current?.getOffset() ?? realtimeFrame?.offset ?? 0;
        const current = route ? routeStepPosition(route, offset) : null;
        if (!current) return;
        let destination = seekStructuralPosition(realtimeModel.score, current, command);
        if (route && realtimeRouteLoopsRef.current) {
          // A step out of the loop lands on its start: counting in to it when the loop
          // counts in to each pass, otherwise at once.
          const step = loopRouteStep(route, destination, command);
          if (effectiveLoopRestart(loopRestart, realtimeCountIn !== "none") === "immediately") {
            destination = step.position;
          }
          if (step.nextPass) setLoopPass((pass) => pass + 1);
        }
        seekRealtimePosition(destination, realtimeStatus);
        return;
      }
      commitPlaybackState(
        applyPlaybackCommand(
          playbackTimeline,
          playbackStateRef.current,
          command,
          selectedGroup,
          fullPlaybackTimeline,
        ),
        true,
        command,
      );
    },
    [
      commitPlaybackState,
      fullPlaybackTimeline,
      loopRestart,
      playbackMode,
      playbackTimeline,
      realtimeCountIn,
      realtimeFrame?.offset,
      realtimeModel.score,
      realtimeStatus,
      seekRealtime,
      seekRealtimePosition,
      selectedGroup,
      startRealtime,
      stopRealtime,
    ],
  );
  const handleSelectGroup = useCallback(
    (group: VisualGroupRef | null) => {
      setSelectedGroup(group);
      setHighlightAllNotes(false);
      if (group && playbackMode === "realtime" && realtimeStatus !== "inactive") {
        seekRealtime(group, realtimeStatus);
        return;
      }
      const next = seekPracticePlaybackToGroup(
        fullPlaybackTimeline,
        playbackTimeline,
        playbackStateRef.current,
        group,
      );
      if (next !== playbackStateRef.current) commitPlaybackState(next);
    },
    [
      commitPlaybackState,
      fullPlaybackTimeline,
      playbackMode,
      playbackTimeline,
      realtimeStatus,
      seekRealtime,
    ],
  );
  const handlePlaybackModeChange = useCallback((mode: PlaybackMode) => {
    if (mode === playbackMode || (mode === "realtime" && !realtimeModel.score)) return;
    // Listen mode carries over; it retargets once the new mode renders.
    const wasActive = playbackActive;
    const playheadVisual = playbackMode === "realtime"
      ? realtimeRouteRef.current?.notes
          .filter((note) =>
            note.visual !== null &&
            note.onset <= (realtimeControllerRef.current?.getOffset() ?? 0) + 1e-6,
          )
          .at(-1)?.visual ?? null
      : notePlaybackMoment
        ? {
            pageIndex: notePlaybackMoment.pageIndex,
            visualGroupId: notePlaybackMoment.visualGroupIds[0],
          }
        : null;
    if (playbackMode === "realtime") stopRealtime();
    else commitPlaybackState({
      ...playbackStateRef.current,
      active: false,
      currentMomentId: null,
    });
    setPlaybackMode(mode);
    // Starting realtime below reads the mode before the next render does.
    playbackModeRef.current = mode;
    if (!wasActive) return;
    const group = playheadVisual
      ? { pageIndex: playheadVisual.pageIndex, visualGroupId: playheadVisual.visualGroupId }
      : selectedGroup;
    // Realtime waits, paused on the note-by-note position, for the play button.
    if (mode === "realtime") startRealtime(group, "paused");
    else commitPlaybackState(
      applyPlaybackCommand(
        playbackTimeline,
        playbackStateRef.current,
        "togglePlayback",
        group,
        fullPlaybackTimeline,
      ),
    );
  }, [
    commitPlaybackState,
    fullPlaybackTimeline,
    notePlaybackMoment,
    playbackActive,
    playbackMode,
    playbackTimeline,
    realtimeModel.score,
    selectedGroup,
    startRealtime,
    stopRealtime,
  ]);
  const handlePlaybackCommandRef = useRef<(command: PlaybackCommand, heldSince?: number) => void>(() => undefined);

  // The fingering editor stops playback while it is on and keeps its own cursor.
  const stopAnyPlayback = useCallback(() => handlePlaybackCommandRef.current("stopPlayback"), []);
  const auditionEditedMoment = useCallback((moment: PlaybackMoment) => {
    if (moment.pitches.length === 0) return;
    void pianoSampler.audition(moment.pitches, {}, moment.dynamic)
      .then(() => setPlaybackAudioError(null))
      .catch((audioError: unknown) => {
        const message = audioError instanceof Error ? audioError.message : String(audioError);
        setPlaybackAudioError(`Piano audio could not start: ${message}`);
      });
  }, []);
  const predictFingeringsWithModel = useCallback<FingeringPredictor>(
    async (notes) => (await import("./fingeringModel")).predictPianoFingerings(notes),
    [],
  );
  // The notes realtime struck last, at or before where it is now.
  const realtimePlayheadNoteIds = useCallback((): string[] => {
    const route = realtimeRouteRef.current;
    if (playbackModeRef.current !== "realtime" || !route) return [];
    const offset = realtimeControllerRef.current?.getOffset() ?? 0;
    const struck = (route.playheadNotes ?? route.notes).filter((note) => note.onset <= offset + 1e-6);
    const last = Math.max(...struck.map((note) => note.onset));
    return struck.filter((note) => Math.abs(note.onset - last) < 1e-6).map((note) => note.musicXmlId);
  }, []);
  /**
   * Back from the fingering editor to the playback it began in, at the note it last ringed,
   * realtime paused there; with no playback to go back to, the note is selected.
   */
  // While editing fingers, a MusicXML score is laid out with room for a label by every note.
  // The layout changes which page a note is on, so the fingerings move to the new viewer IDs.
  const documentRef = useRef(document);
  documentRef.current = document;
  const relayoutForFingering = useCallback((room: boolean): LoadedDocument | null => {
    const current = documentRef.current;
    const next = current ? relayoutMusicXmlScore(current, room) : null;
    if (!next || !next.documentMusicXml) return null;
    const result = next.fingeringLayers
      ? withFingeringLayers(next, rekeyFingeringLayers(next.fingeringLayers, viewerIdsByKey(next.documentMusicXml)))
      : next;
    documentRef.current = result;
    setDocument(result);
    return result;
  }, []);
  // Leaving the editor lays the score out again, which moves every note; the view then follows
  // the note the editor last ringed, once, to where it now stands.
  const [returnFocus, setReturnFocus] = useState<VisualGroupRef | null>(null);
  const returnMoment = useMemo(
    () => returnFocus
      ? fullPlaybackTimeline.find((moment) =>
        moment.pageIndex === returnFocus.pageIndex && moment.visualGroupIds.includes(returnFocus.visualGroupId)) ?? null
      : null,
    [fullPlaybackTimeline, returnFocus],
  );
  useEffect(() => {
    if (!returnMoment) return;
    const done = window.setTimeout(() => setReturnFocus(null), 500);
    return () => window.clearTimeout(done);
  }, [returnMoment]);
  const enterFingerEditor = useCallback(() => {
    setReturnFocus(null);
    relayoutForFingering(true);
  }, [relayoutForFingering]);
  const leaveFingerEditor = useCallback((cursor: EditTarget | null, resume: boolean) => {
    const laidOut = relayoutForFingering(false);
    if (cursor) {
      // The note's page in the layout playback returns to.
      const pageIndex = laidOut?.pages.find((page) => page.surface?.chords.some((chord) => chord.notes.some((note) => note.key === cursor.key)))?.index
        ?? cursor.pageIndex;
      setSelectedGroup({ pageIndex, visualGroupId: cursor.key });
      setReturnFocus({ pageIndex, visualGroupId: cursor.key });
    }
    if (!resume) return;
    // Once the selection has rendered, playback starts at it.
    window.setTimeout(() => handlePlaybackCommandRef.current("togglePlayback"), 0);
  }, [relayoutForFingering]);
  const fingerEditor = useFingeringEditor({
    document,
    setDocument,
    timeline: playbackTimeline,
    playbackActive,
    startMomentId: playbackMode === "note-by-note" ? notePlaybackMoment?.id ?? null : null,
    playheadNoteIds: realtimePlayheadNoteIds,
    startNoteId: selectedGroup ? `page-${selectedGroup.pageIndex + 1}-${selectedGroup.visualGroupId}` : null,
    practiceHand,
    onPracticeHandChange: handlePracticeHandChange,
    stopPlayback: stopAnyPlayback,
    onEnter: enterFingerEditor,
    onLeave: leaveFingerEditor,
    audition: auditionEditedMoment,
    predict: predictFingeringsWithModel,
    onError: setError,
  });
  const fingerEditorRef = useRef(fingerEditor);
  fingerEditorRef.current = fingerEditor;
  // The roomy layout and its pages' images are prepared in idle time once a MusicXML score's
  // fingerings are ready, so that entering the editor is quick.
  const fingeringsReadyJob = document?.source.kind === "musicxml" && document.fingeringStatus === "ready"
    ? document.jobId
    : null;
  useEffect(() => {
    if (!fingeringsReadyJob || typeof requestIdleCallback === "undefined") return;
    let stopImages: (() => void) | null = null;
    const idle = requestIdleCallback(() => {
      const current = documentRef.current;
      if (!current || current.jobId !== fingeringsReadyJob) return;
      const roomy = relayoutMusicXmlScore(current, true);
      if (roomy) stopImages = preparePageImages(roomy.pages.flatMap((page) => (page.surface ? [page.surface] : [])));
    }, { timeout: 4000 });
    return () => {
      cancelIdleCallback(idle);
      stopImages?.();
    };
  }, [fingeringsReadyJob]);
  // The editor's cursor replaces the selection while it is on.
  const fingerEditing = fingerEditor.editing;
  useEffect(() => {
    if (fingerEditing) setSelectedGroup(null);
  }, [fingerEditing]);
  // In edit mode a click on a note rings it and opens its finger picker.
  const handleViewerSelectGroup = useCallback((group: VisualGroupRef | null) => {
    const id = group ? `page-${group.pageIndex + 1}-${group.visualGroupId}` : null;
    if (fingerEditor.editing) {
      if (id && fingerEditor.fingerings?.[id]) fingerEditor.select(id);
      else fingerEditor.closePicker();
      return;
    }
    handleSelectGroup(group);
  }, [fingerEditor, handleSelectGroup]);
  // The edited note is coloured in its hand's colour.
  const fingerCursor = fingerEditor.cursor;
  const fingerCursorLeft = fingerCursor ? fingerEditor.fingerings?.[fingerCursor.id]?.left : undefined;
  const fingerNoteHighlight = useMemo<NoteHighlight | null>(
    () => fingerCursor && fingerCursorLeft !== undefined
      ? { pageIndex: fingerCursor.pageIndex, keys: [fingerCursor.key], kind: fingerCursorLeft ? "left-hand" : "right-hand" }
      : null,
    [fingerCursor, fingerCursorLeft],
  );

  /**
   * Note-by-note commits the flag, silencing its playhead sounds; realtime keeps
   * playing and re-mutes only for the microphone.
   */
  const setListenModeEnabled = useCallback((enabled: boolean) => {
    const next = { ...playbackStateRef.current, listenModeEnabled: enabled };
    if (playbackModeRef.current === "note-by-note") {
      commitPlaybackState(next, false);
      return;
    }
    playbackStateRef.current = next;
    setPlaybackState(next);
    realtimeControllerRef.current?.setMuted(realtimeMuted(next, listenInputSourceRef.current));
    syncRealtimeWait();
  }, [commitPlaybackState, syncRealtimeWait]);

  const stopListenMode = useCallback((preserveError = false) => {
    listenOperationRef.current += 1;
    auditionOperationRef.current += 1;
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    listenTargetKeyRef.current = null;
    keyboardRecognitionRef.current.reset();
    const generation = ++playheadGenerationRef.current;
    chordMatcherRef.current.setTarget([], generation, performance.now());
    heldChordMatcherRef.current.setTarget([]);
    if (playbackStateRef.current.listenModeEnabled) setListenModeEnabled(false);
    setListenFeedback((feedback) => ({
      lifecycle: preserveError && feedback.lifecycle.state === "error"
        ? feedback.lifecycle
        : stoppedRecognizerLifecycle,
      targetPitches: [],
      detectedTargetPitches: [],
      extraPitches: [],
      targetPitchConfidences: [],
      recognizedActivePitches: [],
      attackPitches: [],
      successPitches: [],
      processingTimeMs: null,
    }));
  }, [setListenModeEnabled]);

  const handleRecognizerResult = useCallback((result: RecognizerResult) => {
    if (!playbackStateRef.current.listenModeEnabled) return;
    const realtime = playbackModeRef.current === "realtime";
    if (realtime && !realtimeWaitRef.current) {
      // Realtime only shows what is being played, unless it waits on the player.
      const keyboardRecognition = keyboardRecognitionRef.current.consume(result);
      setListenFeedback((feedback) => ({
        ...feedback,
        recognizedActivePitches: keyboardRecognition.activePitches,
        attackPitches: keyboardRecognition.attacks,
        processingTimeMs: result.processingTimeMs,
      }));
      return;
    }
    // Ornaments are optional in realtime: what they add is not a wrong note.
    const wait = realtime ? realtimeWaitRef.current : null;
    const ignored = wait?.points[wait.index]?.ignored;
    const heard = ignored ? withoutPitches(result, ignored) : result;
    const update = chordMatcherRef.current.consume(heard);
    if (update.stale) return;
    const held = recognizerRef.current instanceof MidiNoteRecognizer &&
      heldChordMatcherRef.current.consume(heard);
    // Either matcher may complete the target, but it is played only once.
    const matched = (update.matched || held) &&
      matchedListenGenerationRef.current !== result.generation;
    if (matched) matchedListenGenerationRef.current = result.generation;
    const activeConfidence = new Map(
      result.targetPitchEvidence.map(({ midi, confidence }) => [midi, confidence]),
    );
    const keyboardRecognition = keyboardRecognitionRef.current.consume(result);
    if (matched) keyboardRecognitionRef.current.suppressVisibleUntilRelease();
    setListenFeedback((feedback) => ({
      ...feedback,
      targetPitches: update.targetPitches,
      detectedTargetPitches: update.detectedTargetPitches,
      extraPitches: update.extraPitches,
      targetPitchConfidences: update.targetPitches.map((midi) => ({
        midi,
        confidence: activeConfidence.get(midi) ?? 0,
      })),
      recognizedActivePitches: matched ? [] : keyboardRecognition.activePitches,
      attackPitches: matched ? [] : keyboardRecognition.attacks,
      successPitches: matched
        ? update.targetPitches.map((midi) => ({
            midi,
            successTimeMs: result.capturedAtMs,
          }))
        : feedback.successPitches,
      processingTimeMs: result.processingTimeMs,
    }));
    if (!matched) return;
    if (realtime) syncRealtimeWait(true);
    else handlePlaybackCommandRef.current("forwardNote");
  }, [syncRealtimeWait]);

  const startListenMode = useCallback(async () => {
    if (!playbackActiveRef.current || recognizerRef.current) return;
    const inputSource = listenInputSourceRef.current;
    const operation = ++listenOperationRef.current;
    const generation = ++playheadGenerationRef.current;
    // Only the microphone's recognizer can latch a released note.
    keyboardRecognitionRef.current = new KeyboardRecognitionTracker(
      inputSource === "microphone" ? KEYBOARD_STALE_SUSTAIN_MS : null,
    );
    // Mute before microphone/model initialization so navigation during startup
    // cannot play samples into the recognizer when it becomes ready.
    setListenModeEnabled(true);
    const moment = playbackModeRef.current === "note-by-note"
      ? currentPlaybackMoment(playbackTimeline, playbackStateRef.current)
      : null;
    const { key: targetKey, target } = playbackModeRef.current === "realtime"
      ? realtimeWaitListenTarget(realtimeWaitRef.current)
      : {
          key: listenTargetKey(moment?.id, midiPitches(moment?.pitches ?? [])),
          target: midiPitches(moment?.pitches ?? []),
        };
    chordMatcherRef.current.setTarget(target, generation, performance.now());
    heldChordMatcherRef.current.setTarget(target);
    setListenFeedback({
      lifecycle: {
        state: "initializing",
        inputSource,
        input: "loading",
        analysis: "loading",
      },
      targetPitches: target,
      detectedTargetPitches: [],
      extraPitches: [],
      targetPitchConfidences: target.map((midi) => ({ midi, confidence: 0 })),
      recognizedActivePitches: [],
      attackPitches: [],
      successPitches: [],
      processingTimeMs: null,
    });
    if (
      inputSource === "midi" &&
      (!nativeAvailable || midiErrorRef.current !== null || midiPortsRef.current.length === 0)
    ) {
      const message = !nativeAvailable
        ? "MIDI input is available in the desktop app."
        : midiErrorRef.current ?? "No MIDI inputs are connected. Open Settings and scan again.";
      setListenModeEnabled(false);
      setListenFeedback((feedback) => ({
        ...feedback,
        lifecycle: {
          state: "error",
          inputSource: "midi",
          input: "error",
          analysis: "idle",
          error: message,
        },
      }));
      return;
    }
    const recognizer = inputSource === "midi"
      ? new MidiNoteRecognizer()
      : createBrowserOnlineAmtRecognizer();
    recognizer.setTarget(target);
    listenTargetKeyRef.current = targetKey;
    recognizerRef.current = recognizer;
    try {
      await recognizer.start(generation, {
        onLifecycle: (lifecycle) => {
          if (recognizerRef.current !== recognizer) return;
          setListenFeedback((feedback) => ({ ...feedback, lifecycle }));
          if (lifecycle.state === "error") {
            recognizerRef.current = null;
            if (playbackStateRef.current.listenModeEnabled) setListenModeEnabled(false);
          }
        },
        onResult: handleRecognizerResult,
      });
      if (
        operation !== listenOperationRef.current ||
        recognizerRef.current !== recognizer ||
        !playbackActiveRef.current ||
        activePageRef.current !== "viewer"
      ) {
        recognizer.stop();
        return;
      }
    } catch {
      if (recognizerRef.current === recognizer) {
        recognizerRef.current = null;
        if (playbackStateRef.current.listenModeEnabled) setListenModeEnabled(false);
      }
      // The lifecycle callback exposes the specific analyzer/device error.
    }
  }, [handleRecognizerResult, nativeAvailable, playbackTimeline, setListenModeEnabled]);

  const auditionCurrentNotes = useCallback(async () => {
    const moment = currentPlaybackMoment(playbackTimeline, playbackStateRef.current);
    if (!playbackStateRef.current.active || !moment || moment.pitches.length === 0) return;
    const operation = ++auditionOperationRef.current;
    const recognizer = recognizerRef.current;
    const listening = playbackStateRef.current.listenModeEnabled && recognizer !== null;
    if (listening) {
      const generation = ++playheadGenerationRef.current;
      recognizer.pause(generation);
      chordMatcherRef.current.reset(generation, performance.now());
      heldChordMatcherRef.current.setTarget([]);
      keyboardRecognitionRef.current.reset();
      setListenFeedback((feedback) => ({
        ...feedback,
        recognizedActivePitches: [],
        attackPitches: [],
        successPitches: [],
      }));
    }
    try {
      await pianoSampler.audition(moment.pitches, {}, moment.dynamic);
      setPlaybackAudioError(null);
    } catch (audioError) {
      const message = audioError instanceof Error ? audioError.message : String(audioError);
      setPlaybackAudioError(`Piano audio could not start: ${message}`);
    } finally {
      if (
        listening &&
        operation === auditionOperationRef.current &&
        recognizerRef.current === recognizer &&
        playbackStateRef.current.listenModeEnabled
      ) {
        // Listening may have carried over into realtime while the notes sounded.
        const generation = ++playheadGenerationRef.current;
        const target = playbackModeRef.current === "note-by-note"
          ? midiPitches(currentPlaybackMoment(playbackTimeline, playbackStateRef.current)?.pitches ?? [])
          : realtimeWaitListenTarget(realtimeWaitRef.current).target;
        recognizer.flush();
        recognizer.setTarget(target);
        chordMatcherRef.current.setTarget(
          target,
          generation,
          performance.now(),
        );
        heldChordMatcherRef.current.setTarget(target);
        recognizer.resume(generation);
        setListenFeedback((feedback) => ({
          ...feedback,
          targetPitches: target,
          detectedTargetPitches: [],
          extraPitches: [],
          targetPitchConfidences: target.map((midi) => ({ midi, confidence: 0 })),
          recognizedActivePitches: [],
          attackPitches: [],
          successPitches: [],
          processingTimeMs: null,
        }));
      }
    }
  }, [playbackTimeline]);

  /** The measure the playhead is in, by its document position. */
  const playheadMeasure = useCallback((): number | null => {
    if (playbackMode === "realtime") {
      const route = realtimeRouteRef.current;
      const offset = realtimeControllerRef.current?.getOffset() ?? 0;
      return route ? routeStructuralPosition(route, offset)?.measureIndex ?? null : null;
    }
    return currentPlaybackMoment(playbackTimeline, playbackStateRef.current)?.measureIndex ?? null;
  }, [playbackMode, playbackTimeline]);

  /**
   * Puts playback under `next`, or under no loop. Note-by-note moves into the loop when it
   * stands outside; realtime takes the loop's route from where it is, or from the loop's
   * start, and keeps playing or paused.
   */
  const applyLoop = useCallback((next: LoopRegion | null) => {
    loopRef.current = next;
    setLoopPass(1);
    if (playbackMode === "realtime") {
      if (realtimeStatus === "inactive") return;
      const route = realtimeRouteRef.current;
      const offset = realtimeControllerRef.current?.getOffset() ?? 0;
      // In a count-in the playhead is before the route's first note: the new route
      // counts in to the same place rather than starting on it.
      seekRealtimePosition(route ? routeStructuralPosition(route, offset) : null, realtimeStatus, offset < 0);
      return;
    }
    const current = playbackStateRef.current;
    const looped = loopNoteByNoteState(playbackTimeline, current, current, null, next).state;
    if (looped !== current) commitPlaybackState(looped);
  }, [commitPlaybackState, playbackMode, playbackTimeline, realtimeStatus, seekRealtimePosition]);

  /** Loop mode is a playback feature: it turns on only while playback runs. */
  const toggleLoopMode = useCallback(() => {
    if (loopMode) {
      setLoopMode(false);
      setLoopRegion(null);
      applyLoop(null);
      return;
    }
    if (!playbackActiveRef.current) return;
    const region = loopAroundMeasure(playheadMeasure() ?? 0, documentMeasureCount);
    if (!region) return;
    setLoopRegion(region);
    setLoopMode(true);
    applyLoop(region);
  }, [applyLoop, documentMeasureCount, loopMode, playheadMeasure]);

  const changeLoopRegion = useCallback((region: LoopRegion) => {
    const next = clampLoopRegion(region, documentMeasureCount);
    if (!next) return;
    setLoopRegion(next);
    if (loopMode) applyLoop(next);
  }, [applyLoop, documentMeasureCount, loopMode]);

  /** `heldSince` is when the key or MIDI control repeating `command` went down. */
  const handlePlaybackCommand = useCallback((command: PlaybackCommand, heldSince?: number) => {
    const editor = fingerEditorRef.current;
    // While editing fingers, moving goes to the editor's cursor and nothing plays unasked.
    if (editor.editing && !isFingerEditCommand(command)) {
      if (isEditNavigation(command)) editor.navigate(command);
      else if (command === "playCurrentNotes") editor.audition();
      else if (command === "practiceLeftHand" || command === "practiceRightHand") {
        const hand = command === "practiceLeftHand" ? "left" : "right";
        handlePracticeHandChange(practiceHand === hand ? "both" : hand);
      }
      return;
    }
    if (isFingerEditCommand(command)) {
      if (command === "toggleFingerEditing") editor.toggle();
      else if (!editor.editing) return;
      else if (command === "resetFinger") editor.reset();
      else if (command === "swapFingerHand") editor.swapHand();
      else if (command === "undoFingerEdit") editor.undo();
      else if (command === "fingerNoteHigher") editor.moveInMoment(-1);
      else if (command === "fingerNoteLower") editor.moveInMoment(1);
      else editor.setFinger(Number(command.slice("setFinger".length)));
      return;
    }
    if (isLoopBoundaryCommand(command)) {
      if (!loopMode || !loopRegion) return;
      const current = clampLoopRegion(loopRegion, documentMeasureCount);
      if (!current) return;
      const next = loopRegionAfterCommand(current, command, documentMeasureCount);
      if (next !== current) changeLoopRegion(next);
      return;
    }
    if (command === "tempoUp" || command === "tempoDown") {
      if (playbackMode !== "realtime") return;
      const step = heldSince === undefined ? 1 : heldTempoStep(performance.now() - heldSince);
      changeTempoMultiplier(steppedTempoMultiplier(tempoMultiplierRef.current, command === "tempoUp" ? step : -step));
      return;
    }
    if (command === "resetTempo") {
      if (playbackMode !== "realtime") return;
      changeTempoMultiplier(1);
      return;
    }
    if (command === "stretchNotes" || command === "compressNotes" || command === "resetNoteStretch") {
      const timeZoom = command === "resetNoteStretch"
        ? DEFAULT_KEYBOARD_VIEW_SETTINGS.timeZoom
        : steppedTimeZoom(keyboardView.timeZoom, command === "stretchNotes" ? 1 : -1);
      if (timeZoom !== keyboardView.timeZoom) changeKeyboardView({ ...keyboardView, timeZoom });
      return;
    }
    if (command === "toggleNoteHighway") {
      toggleNoteHighway();
      return;
    }
    if (command === "practiceLeftHand" || command === "practiceRightHand") {
      const hand = command === "practiceLeftHand" ? "left" : "right";
      // The hand already practised goes back to both.
      handlePracticeHandChange(practiceHand === hand ? "both" : hand);
      return;
    }
    if (command === "togglePlaybackMode") {
      handlePlaybackModeChange(playbackMode === "realtime" ? "note-by-note" : "realtime");
      return;
    }
    if (command === "toggleLoopMode") {
      toggleLoopMode();
      return;
    }
    if (command === "toggleListenMode") {
      if (recognizerRef.current) stopListenMode();
      else void startListenMode();
      return;
    }
    if (command === "toggleRealtimeWait") {
      toggleRealtimeWait();
      return;
    }
    if (command === "playCurrentNotes") {
      if (playbackMode !== "note-by-note") return;
      void auditionCurrentNotes();
      return;
    }
    // Rewinding starts the practice over, loop passes included.
    if (command === "rewind") setLoopPass(1);
    if (
      (command === "togglePlayback" || command === "stopPlayback") &&
      playbackStateRef.current.active &&
      recognizerRef.current
    ) {
      stopListenMode();
    }
    applyPlaybackStateCommand(command);
  }, [
    applyPlaybackStateCommand,
    auditionCurrentNotes,
    changeKeyboardView,
    changeLoopRegion,
    changeTempoMultiplier,
    documentMeasureCount,
    handlePlaybackModeChange,
    handlePracticeHandChange,
    keyboardView,
    loopMode,
    loopRegion,
    playbackMode,
    practiceHand,
    startListenMode,
    stopListenMode,
    toggleLoopMode,
    toggleNoteHighway,
    toggleRealtimeWait,
  ]);
  handlePlaybackCommandRef.current = handlePlaybackCommand;

  // Listening belongs to a run of playback, including realtime stopping or reaching
  // the end on its own.
  useEffect(() => {
    if (!playbackActive && recognizerRef.current) stopListenMode();
  }, [playbackActive, stopListenMode]);

  useEffect(() => {
    retargetListenMode(playbackState);
  }, [
    notePlaybackMoment?.id,
    playbackPitchKey,
    playbackState,
    retargetListenMode,
  ]);

  const stopMidiRepeat = useCallback(() => {
    const activeRepeat = activeMidiRepeatRef.current;
    if (!activeRepeat) return;
    if (activeRepeat.delayId !== null) window.clearTimeout(activeRepeat.delayId);
    if (activeRepeat.intervalId !== null) window.clearInterval(activeRepeat.intervalId);
    activeMidiRepeatRef.current = null;
  }, []);

  const startMidiRepeat = useCallback((command: PlaybackCommand, shortcut: MidiShortcut) => {
    if (!midiShortcutSupportsHold(shortcut)) return;
    stopMidiRepeat();
    const activeRepeat: ActiveMidiRepeat = {
      command,
      shortcut,
      delayId: null,
      intervalId: null,
    };
    const repeatTiming = midiRepeatTimingRef.current;
    const heldSince = performance.now();
    const repeatCommand = () => {
      if (
        activeMidiRepeatRef.current !== activeRepeat ||
        activePageRef.current !== "viewer" ||
        (!playbackActiveRef.current && !fingerEditorRef.current.editing)
      ) {
        if (activeMidiRepeatRef.current === activeRepeat) stopMidiRepeat();
        return;
      }
      handlePlaybackCommandRef.current(command, heldSince);
    };
    activeMidiRepeatRef.current = activeRepeat;
    activeRepeat.delayId = window.setTimeout(() => {
      activeRepeat.delayId = null;
      repeatCommand();
      if (activeMidiRepeatRef.current !== activeRepeat) return;
      activeRepeat.intervalId = window.setInterval(repeatCommand, repeatTiming.intervalMs);
    }, repeatTiming.delayMs);
  }, [stopMidiRepeat]);

  const applyMidiInputs = useCallback((ports: string[], error: string | null) => {
    setMidiPorts(error === null ? ports : []);
    setMidiError(error);
    if (error !== null) {
      midiCaptureCommandRef.current = null;
      setMidiCaptureCommand(null);
    }
  }, []);

  const handleRefreshMidiInputs = useCallback(() => {
    if (!nativeAvailable || midiRefreshInProgressRef.current) return;
    midiRefreshInProgressRef.current = true;
    setMidiRefreshing(true);
    setMidiError(null);
    void refreshMidiInputs()
      .then((ports) => applyMidiInputs(ports, null))
      .catch((refreshError: unknown) => {
        applyMidiInputs([], refreshError instanceof Error ? refreshError.message : String(refreshError));
      })
      .finally(() => {
        midiRefreshInProgressRef.current = false;
        setMidiRefreshing(false);
      });
  }, [applyMidiInputs, nativeAvailable]);

  useEffect(() => {
    if (!nativeAvailable) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    // A scan that outlives the refresh timeout still reports here, which clears the
    // "MIDI service has not responded yet" warning without restarting the app.
    void subscribeToMidiInputChanges(({ ports, error }) => applyMidiInputs(ports, error)).then(
      (unlisten) => {
        if (disposed) unlisten();
        else unsubscribe = unlisten;
      },
    );
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [applyMidiInputs, nativeAvailable]);

  const cancelMidiCapture = useCallback(() => {
    midiCaptureCommandRef.current = null;
    setMidiCaptureCommand(null);
  }, []);
  const closeSettings = useCallback(() => {
    setShowWorkerLogs(false);
    cancelMidiCapture();
    setActivePage("viewer");
  }, [cancelMidiCapture]);

  const beginMidiCapture = useCallback((command: PlaybackCommand) => {
    stopMidiRepeat();
    midiCaptureCommandRef.current = command;
    setMidiCaptureCommand(command);
    handleRefreshMidiInputs();
  }, [handleRefreshMidiInputs, stopMidiRepeat]);

  useEffect(() => {
    savePlaybackShortcuts(shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    handleRefreshMidiInputs();
  }, [handleRefreshMidiInputs]);

  useEffect(() => {
    if (!nativeAvailable) return;
    let disposed = false;
    void getKeyboardRepeatTiming()
      .then((timing) => {
        if (
          disposed ||
          !Number.isFinite(timing.delayMs) ||
          !Number.isFinite(timing.intervalMs) ||
          timing.delayMs < 0 ||
          timing.intervalMs <= 0
        ) return;
        midiRepeatTimingRef.current = timing;
      })
      .catch(() => {
        // Keep the hardcoded cross-platform defaults if native timing is unavailable.
      });
    return () => {
      disposed = true;
    };
  }, [nativeAvailable]);

  useEffect(() => {
    let disposed = false;
    void pianoSampler.setPiano(playbackPiano).then(() => {
      if (!disposed) setPlaybackAudioError(null);
    }).catch((audioError: unknown) => {
      if (disposed) return;
      const message = audioError instanceof Error ? audioError.message : String(audioError);
      setPlaybackAudioError(`Piano audio could not start: ${message}`);
    });
    return () => { disposed = true; };
  }, [playbackPiano]);

  useEffect(() => () => {
      recognizerRef.current?.stop();
      realtimeControllerRef.current?.stop();
      pianoSampler.dispose();
    }, []);

  useEffect(() => {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    listenOperationRef.current += 1;
    auditionOperationRef.current += 1;
    playbackStateRef.current = initialPlaybackState;
    setPlaybackState(initialPlaybackState);
    realtimeStartGenerationRef.current += 1;
    realtimeControllerRef.current?.stop();
    realtimeRouteRef.current = null;
    realtimeLatestFrameRef.current = null;
    realtimeRenderSignatureRef.current = "";
    setRealtimeStatus("inactive");
    setRealtimeFrame(null);
    setPlaybackMode("note-by-note");
    setTempoMultiplier(1);
    loopRef.current = null;
    setLoopMode(false);
    setLoopRegion(null);
    setLoopPass(1);
    setListenFeedback({
      lifecycle: stoppedRecognizerLifecycle,
      targetPitches: [],
      detectedTargetPitches: [],
      extraPitches: [],
      targetPitchConfidences: [],
      recognizedActivePitches: [],
      attackPitches: [],
      successPitches: [],
      processingTimeMs: null,
    });
    setPlaybackAudioError(null);
    keyboardRecognitionRef.current.reset();
    pianoSampler.stop();
  }, [document?.jobId]);

  // The key held down, and since when, so its repeats can speed up.
  const heldKeyRef = useRef<{ code: string; since: number } | null>(null);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (activePage !== "viewer") return;
      if (isEditableKeyboardTarget(event.target)) return;
      const editor = fingerEditorRef.current;
      // Esc leaves the fingering editor, closing its picker first, and leaves playback alone.
      if (editor.editing && event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (editor.pickerOpen) editor.closePicker();
        else editor.exit();
        return;
      }
      const command = commandForKeyboardEvent(shortcuts, event);
      if (!command) return;
      if (!commandWorksWhileStopped(command) && !playbackActive && !worksWhileEditing(command, editor.editing)) return;
      // Outside edit mode the editor's keys keep their ordinary meaning.
      if (isFingerEditCommand(command) && command !== "toggleFingerEditing" && !editor.editing) return;
      if (command === "toggleFingerEditing" && !editor.available) return;
      if (isPlaybackToggleCommand(command) && event.repeat) return;
      event.preventDefault();
      if (!event.repeat || heldKeyRef.current?.code !== event.code) {
        heldKeyRef.current = { code: event.code, since: performance.now() };
      }
      handlePlaybackCommand(command, heldKeyRef.current.since);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePage, handlePlaybackCommand, playbackActive, shortcuts]);

  // While editing fingers, pasting digits types them as a run: "54545243" fingers eight notes.
  useEffect(() => {
    if (!fingerEditing || activePage !== "viewer") return;
    function handlePaste(event: ClipboardEvent) {
      if (isEditableKeyboardTarget(event.target)) return;
      const text = event.clipboardData?.getData("text") ?? "";
      const run = text.replace(/[^0-5hH]/g, "");
      if (!run) return;
      event.preventDefault();
      fingerEditorRef.current.typeRun(run);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activePage, fingerEditing]);

  // A press anywhere but the finger picker or a fingering label closes the picker.
  const fingerPickerOpen = fingerEditor.pickerOpen;
  useEffect(() => {
    if (!fingerPickerOpen) return;
    function closeOnPressOutside(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".finger-picker, .fingering-label, .fingering-printed")) return;
      fingerEditorRef.current.closePicker();
    }
    window.addEventListener("pointerdown", closeOnPressOutside, true);
    return () => window.removeEventListener("pointerdown", closeOnPressOutside, true);
  }, [fingerPickerOpen]);

  useEffect(() => {
    if ((!playbackActive && !fingerEditing) || activePage !== "viewer") stopMidiRepeat();
  }, [activePage, fingerEditing, playbackActive, stopMidiRepeat]);

  useEffect(() => {
    if (!nativeAvailable) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    void subscribeToMidiMessages((event) => {
      const received = midiShortcutFromBytes(event.bytes);
      if (!received) return;

      const captureCommand = midiCaptureCommandRef.current;
      if (captureCommand) {
        midiCaptureCommandRef.current = null;
        setMidiCaptureCommand(null);
        setShortcuts((current) => {
          const next = { ...current } as PlaybackShortcuts;
          for (const command of playbackCommandNames) {
            const assigned = current[command].midi;
            if (assigned && midiShortcutsEqual(assigned, received)) {
              next[command] = { ...current[command], midi: null };
            }
          }
          next[captureCommand] = { ...next[captureCommand], midi: received };
          return next;
        });
        return;
      }

      const recognizer = recognizerRef.current;
      if (
        listenInputSourceRef.current === "midi" &&
        playbackStateRef.current.listenModeEnabled &&
        recognizer instanceof MidiNoteRecognizer &&
        isMidiNoteMessage(event.bytes)
      ) {
        if (isMidiNoteOnMessage(event.bytes)) stopMidiRepeat();
        recognizer.handleMidiMessage(event.bytes, event.port);
        const activeRepeat = activeMidiRepeatRef.current;
        if (activeRepeat && midiShortcutIsRelease(activeRepeat.shortcut, received)) {
          stopMidiRepeat();
        }
        return;
      }

      const activeRepeat = activeMidiRepeatRef.current;
      if (activeRepeat && midiShortcutIsRelease(activeRepeat.shortcut, received)) {
        stopMidiRepeat();
        return;
      }
      if (activeRepeat && midiShortcutsEqual(activeRepeat.shortcut, received)) return;

      if (activePageRef.current !== "viewer") return;
      const command = commandForMidiShortcut(shortcutsRef.current, received);
      if (!command) return;
      const editing = fingerEditorRef.current.editing;
      if (!commandWorksWhileStopped(command) && !playbackActiveRef.current && !worksWhileEditing(command, editing)) return;
      if (isFingerEditCommand(command) && command !== "toggleFingerEditing" && !editing) return;
      stopMidiRepeat();
      handlePlaybackCommandRef.current(command);
      if (!isPlaybackToggleCommand(command)) startMidiRepeat(command, received);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unsubscribe = unlisten;
    });

    return () => {
      disposed = true;
      unsubscribe?.();
      stopMidiRepeat();
    };
  }, [nativeAvailable, startMidiRepeat, stopMidiRepeat]);

  useEffect(() => {
    if (activePage === "settings") {
      stopMidiRepeat();
      handleRefreshMidiInputs();
    }
    else cancelMidiCapture();
  }, [activePage, cancelMidiCapture, handleRefreshMidiInputs, stopMidiRepeat]);

  // Nothing plays or listens behind the settings, where MIDI keys assign shortcuts and
  // the input itself may change: realtime pauses, and listening stops until the score
  // is back. Waiting resumes from the paused playhead, on the notes it waited for.
  const pageShownRef = useRef(activePage);
  const listenBeforeSettingsRef = useRef(false);
  useEffect(() => {
    if (pageShownRef.current === activePage) return;
    pageShownRef.current = activePage;
    if (activePage === "settings") {
      realtimeControllerRef.current?.pause();
      listenBeforeSettingsRef.current = recognizerRef.current !== null;
      if (recognizerRef.current) stopListenMode();
      return;
    }
    if (!listenBeforeSettingsRef.current) return;
    listenBeforeSettingsRef.current = false;
    void startListenMode();
  }, [activePage, startListenMode, stopListenMode]);

  useEffect(() => {
    if (!nativeAvailable) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    function handleWorkerEvent(event: WorkerEvent) {
      if (event.type === "worker_log") {
        const entry = {
          id: nextWorkerLogId.current++,
          time: new Date().toLocaleTimeString(),
          line: event.line.replace(/\u001b\[[0-9;]*m/g, ""),
        };
        setWorkerLogs((current) => [
          ...current.slice(-(MAX_VISIBLE_WORKER_LOGS - 1)),
          entry,
        ]);
        return;
      }
      if (event.type === "hello") {
        setWorkerInfo(`HOMR ${event.homrVersion} · worker ${event.workerVersion}`);
        return;
      }
      if (event.type === "protocol_error" || event.type === "worker_stopped") {
        setError(event.message);
        setShowWorkerLogs(true);
        setDocument((current) =>
          current && (current.status === "opening" || current.status === "processing")
            ? {
                ...current,
                status: "failed",
                pages: current.pages.map((page) =>
                  page.status === "complete" || page.status === "skipped"
                    ? page
                    : { ...page, status: "failed", error: event.message },
                ),
              }
            : current,
        );
        return;
      }
      if (event.type === "job_started") {
        activeJobId.current = event.jobId;
        fingeringRequestRef.current = null;
        setError(null);
        realtimeStartGenerationRef.current += 1;
        realtimeControllerRef.current?.stop();
        realtimeRouteRef.current = null;
        realtimeLatestFrameRef.current = null;
        realtimeRenderSignatureRef.current = "";
        setRealtimeStatus("inactive");
        setRealtimeFrame(null);
        setDocument((current) => {
          if (current?.jobId === event.jobId && current.pages.length === event.pageCount) {
            return {
              ...current,
              name: event.documentName,
              source: { kind: "pdf", cacheStatus: event.cacheStatus, cachePath: event.cachePath },
              documentMusicXmlPath: undefined,
              documentMusicXml: undefined,
              fingeringStatus: undefined,
              fingeringError: undefined,
              predictedFingerings: undefined,
              predictedFingeringCount: undefined,
              status: "processing",
            };
          }
          setSelectedGroup(null);
          setHighlightAllNotes(false);
          playbackStateRef.current = initialPlaybackState;
          realtimeStartGenerationRef.current += 1;
          realtimeControllerRef.current?.stop();
          realtimeRouteRef.current = null;
          realtimeLatestFrameRef.current = null;
          realtimeRenderSignatureRef.current = "";
          setRealtimeStatus("inactive");
          setRealtimeFrame(null);
          setPlaybackMode("note-by-note");
          setTempoMultiplier(1);
          pianoSampler.stop();
          setPlaybackState(initialPlaybackState);
          return {
            jobId: event.jobId,
            name: event.documentName,
            pageCount: event.pageCount,
            source: { kind: "pdf", cacheStatus: event.cacheStatus, cachePath: event.cachePath },
            status: "processing",
            pages: pendingPages(event.pageCount),
          };
        });
        return;
      }
      if (!("jobId" in event) || event.jobId !== activeJobId.current) return;

      if (event.type === "page_started") {
        setDocument((current) =>
          current && current.jobId === event.jobId
            ? replacePage(current, event.pageIndex, (page) => ({
                ...page,
                status: "processing",
                error: undefined,
                artifacts: undefined,
                musicXml: undefined,
                visualSidecar: undefined,
              }))
            : current,
        );
        return;
      }
      if (event.type === "page_completed") {
        setDocument((current) =>
          current && current.jobId === event.jobId
            ? replacePage(current, event.pageIndex, (page) => ({
                ...page,
                status: "loading",
                width: event.artifacts.width,
                height: event.artifacts.height,
                artifacts: event.artifacts,
                cached: event.cached,
                musicXml: undefined,
                visualSidecar: undefined,
              }))
            : current,
        );
        void loadPageArtifacts(event.artifacts)
          .then((loaded) => {
            if (disposed || activeJobId.current !== event.jobId) return;
            setDocument((current) =>
              current && current.jobId === event.jobId
                ? replacePage(current, event.pageIndex, (page) => ({
                    ...page,
                    status: "complete",
                    imageUrl: pageImageUrl(event.artifacts.imagePath),
                    musicXml: loaded.musicXml,
                    visualSidecar: loaded.visualSidecar,
                  }))
                : current,
            );
          })
          .catch((loadError: unknown) => {
            if (disposed) return;
            const message = loadError instanceof Error ? loadError.message : String(loadError);
            setDocument((current) =>
              current && current.jobId === event.jobId
                ? replacePage(current, event.pageIndex, (page) => ({
                    ...page,
                    status: "failed",
                    error: `Could not load recognized artifacts: ${message}`,
                  }))
                : current,
            );
          });
        return;
      }
      if (event.type === "page_skipped") {
        setDocument((current) =>
          current && current.jobId === event.jobId
            ? replacePage(current, event.pageIndex, (page) => ({
                ...page,
                status: "skipped",
                cached: event.cached,
                error: undefined,
                artifacts: undefined,
                musicXml: undefined,
                visualSidecar: undefined,
              }))
            : current,
        );
        return;
      }
      if (event.type === "page_failed") {
        setDocument((current) =>
          current && current.jobId === event.jobId
            ? replacePage(current, event.pageIndex, (page) => ({
                ...page,
                status: "failed",
                error: event.error.message,
                artifacts: undefined,
                musicXml: undefined,
                visualSidecar: undefined,
              }))
            : current,
        );
        return;
      }
      if (event.type === "job_completed") {
        setDocument((current) =>
          current?.jobId === event.jobId
            ? {
                ...current,
                status: event.status,
                documentMusicXmlPath: event.documentMusicXmlPath,
                documentMusicXml: undefined,
                fingeringStatus: event.documentMusicXmlPath ? "pending" : undefined,
                fingeringError: undefined,
                predictedFingerings: undefined,
                predictedFingeringCount: undefined,
              }
            : current,
        );
        return;
      }
      if (event.type === "job_failed") {
        setError(event.error.message);
        setDocument((current) =>
          current?.jobId === event.jobId ? { ...current, status: "failed" } : current,
        );
      }
    }

    void subscribeToWorkerEvents(handleWorkerEvent).then((unlisten) => {
      if (disposed) unlisten();
      else unsubscribe = unlisten;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [nativeAvailable]);

  // A MusicXML score keeps its fingerings in its data folder, never in the score file.
  useEffect(() => {
    if (!document || document.source.kind !== "musicxml" || document.fingeringStatus !== "pending") return;
    const jobId = document.jobId;
    const requestKey = `${jobId}:musicxml`;
    if (fingeringRequestRef.current === requestKey) return;
    fingeringRequestRef.current = requestKey;
    const current = () => activeJobId.current === jobId && fingeringRequestRef.current === requestKey;
    void musicXmlFingerings(
      document,
      async (notes) => (await import("./fingeringModel")).predictPianoFingerings(notes),
      () => setDocument((value) => (value?.jobId === jobId ? { ...value, fingeringStatus: "predicting" } : value)),
    )
      .then((result) => {
        if (!current()) return;
        setDocument((value) =>
          value?.jobId === jobId
            ? {
                ...withFingeringLayers(value, {
                  predicted: result.predicted,
                  printed: result.printed,
                  tiedTo: result.tiedTo,
                  overrides: result.overrides,
                  overridesError: result.overridesError,
                  fittedConstraints: result.fittedConstraints,
                }),
                fingeringStatus: "ready",
                fingeringError: undefined,
              }
            : value,
        );
        if (result.overridesError) {
          setError(`Your saved fingerings could not be read, so edits will not be saved over them: ${result.overridesError}`);
        }
      })
      .catch((fingeringError: unknown) => {
        if (!current()) return;
        const message = fingeringError instanceof Error ? fingeringError.message : String(fingeringError);
        setDocument((value) =>
          value?.jobId === jobId ? { ...value, fingeringStatus: "failed", fingeringError: message } : value,
        );
        setError(`Piano fingering prediction failed: ${message}`);
      });
    // The document object changes as fingerings arrive; the job and status decide what to do.
  }, [document?.jobId, document?.fingeringStatus, document?.source.kind]);

  useEffect(() => {
    const path = document?.documentMusicXmlPath;
    if (!document || !path || document.fingeringStatus !== "pending") return;
    const requestKey = `${document.jobId}:${path}`;
    if (fingeringRequestRef.current === requestKey) return;
    fingeringRequestRef.current = requestKey;
    const jobId = document.jobId;

    void readMusicXml(path)
      .then(async (musicXml) => {
        setDocument((current) =>
          current?.jobId === jobId ? { ...current, documentMusicXml: musicXml } : current,
        );
        const cached = cachedFingeringsFromMusicXml(musicXml);
        if (cached) return { result: cached, needsWrite: false };
        setDocument((current) =>
          current?.jobId === jobId ? { ...current, fingeringStatus: "predicting" } : current,
        );
        const { predictPianoFingerings } = await import("./fingeringModel");
        const result = await addPredictedFingeringsToMusicXml(
          musicXml,
          predictPianoFingerings,
        );
        return { result, needsWrite: true };
      })
      .then(async ({ result, needsWrite }) => {
        if (
          activeJobId.current !== jobId ||
          fingeringRequestRef.current !== requestKey
        ) return;
        if (needsWrite) await writeMusicXml(path, result.musicXml);
        if (
          activeJobId.current !== jobId ||
          fingeringRequestRef.current !== requestKey
        ) return;
        setDocument((current) =>
          current?.jobId === jobId
            ? {
                ...current,
                documentMusicXml: result.musicXml,
                fingeringStatus: "ready",
                fingeringError: undefined,
                predictedFingerings: result.fingeringsByMusicXmlId,
                predictedFingeringCount: result.noteCount,
              }
            : current,
        );
      })
      .catch((fingeringError: unknown) => {
        if (
          activeJobId.current !== jobId ||
          fingeringRequestRef.current !== requestKey
        ) return;
        const message = fingeringError instanceof Error
          ? fingeringError.message
          : String(fingeringError);
        setDocument((current) =>
          current?.jobId === jobId
            ? { ...current, fingeringStatus: "failed", fingeringError: message }
            : current,
        );
        setError(`Piano fingering prediction failed: ${message}`);
      });
  }, [document?.documentMusicXmlPath, document?.fingeringStatus, document?.jobId]);

  useEffect(() => {
    if (!nativeAvailable) return;
    void getWorkerLogPath()
      .then(setWorkerLogPath)
      .catch(() => setWorkerLogPath(null));
  }, [nativeAvailable]);

  useEffect(() => {
    if (showWorkerLogs && workerLogOutput.current) {
      workerLogOutput.current.scrollTop = workerLogOutput.current.scrollHeight;
    }
  }, [showWorkerLogs, workerLogs]);

  const diagnosticsShown = debugPanelEnabled && diagnosticsAvailable(document);
  const selectedPage = selectedGroup
    ? document?.pages.find((page) => page.index === selectedGroup.pageIndex)
    : undefined;
  const selectedVisualGroup = selectedGroup
    ? selectedPage?.visualSidecar?.visual_groups.find(
        (group) =>
          group.visual_group_id === selectedGroup.visualGroupId &&
          isSelectableVisualGroup(
            group,
            diagnosticsShown && showDiagnosticVisualGroups,
          ),
      )
    : undefined;
  const selectedNotes = selectedVisualGroup
    ? selectedPage?.visualSidecar?.notes.filter(
        (note) => note.visual_group_id === selectedVisualGroup.visual_group_id,
      ) ?? []
    : [];

  const totals = useMemo(() => {
    const completedPages = document?.pages.filter((page) => page.status === "complete").length ?? 0;
    const skippedPages = document?.pages.filter((page) => page.status === "skipped").length ?? 0;
    const failedPages = document?.pages.filter((page) => page.status === "failed").length ?? 0;
    const visualGroups =
      document?.pages.reduce(
        (total, page) =>
          total +
          (page.visualSidecar?.visual_groups.filter(isLinkedVisualGroup).length ?? 0),
        0,
      ) ?? 0;
    const linkedNotes =
      document?.pages.reduce((total, page) => {
        const sidecar = page.visualSidecar;
        if (!sidecar) return total;
        const eligibleIds = new Set(
          sidecar.visual_groups
            .filter(isLinkedVisualGroup)
            .map((group) => group.visual_group_id),
        );
        return (
          total +
          sidecar.notes.filter(
            (note) =>
              note.visual_group_id !== null &&
              eligibleIds.has(note.visual_group_id),
          ).length
        );
      }, 0) ?? 0;
    const unlinkedMusicXmlNotes =
      document?.pages.reduce(
        (total, page) =>
          total +
          (page.visualSidecar?.notes.filter((note) => note.visual_group_id === null).length ?? 0),
        0,
      ) ?? 0;
    const diagnosticVisualGroups =
      document?.pages.reduce(
        (total, page) =>
          total +
          (page.visualSidecar?.visual_groups.filter(
            (group) => group.visual_status === "diagnostic",
          ).length ?? 0),
        0,
      ) ?? 0;
    return {
      completedPages,
      skippedPages,
      failedPages,
      visualGroups,
      linkedNotes,
      unlinkedMusicXmlNotes,
      diagnosticVisualGroups,
    };
  }, [document]);

  /** Stops everything that belongs to the current document before another one opens. */
  function resetForNewDocument() {
    setSelectedGroup(null);
    setHighlightAllNotes(false);
    stopListenMode();
    playbackStateRef.current = initialPlaybackState;
    realtimeStartGenerationRef.current += 1;
    realtimeControllerRef.current?.stop();
    realtimeRouteRef.current = null;
    realtimeLatestFrameRef.current = null;
    realtimeRenderSignatureRef.current = "";
    setRealtimeStatus("inactive");
    setRealtimeFrame(null);
    setPlaybackMode("note-by-note");
    setTempoMultiplier(1);
    pianoSampler.stop();
    setPlaybackState(initialPlaybackState);
  }

  async function openPdfDocument(path: string) {
    const jobId = await openPdf(
      path,
      repairSettings(sharedNoteheadTimingRepair, timeSignatureRepair, tupletRepair),
    );
    activeJobId.current = jobId;
    setDocument((current) =>
      current?.jobId === jobId
        ? current
        : {
            jobId,
            name: fileName(path),
            pageCount: 0,
            source: { kind: "pdf", cacheStatus: "miss" },
            status: "opening",
            pages: [],
          },
    );
  }

  async function openMusicXmlDocument(path: string) {
    // MusicXML needs no worker job; the ID only keeps the stale-request guards working.
    const jobId = `musicxml-${crypto.randomUUID()}`;
    activeJobId.current = jobId;
    fingeringRequestRef.current = null;
    setDocument({
      jobId,
      name: fileName(path),
      pageCount: 0,
      source: { kind: "musicxml", sourcePath: path },
      status: "opening",
      pages: [],
    });
    try {
      const opened = await openMusicXmlScore(path, jobId);
      if (activeJobId.current === jobId) setDocument(opened);
    } catch (openError) {
      if (activeJobId.current === jobId) setDocument(null);
      throw openError;
    }
  }

  async function handleOpenScore() {
    if (!nativeAvailable) return;
    setError(null);
    try {
      const path = await chooseScore(loadLastScorePath());
      if (!path) return;
      saveLastScorePath(path);
      resetForNewDocument();
      if (isMusicXmlPath(path)) await openMusicXmlDocument(path);
      else await openPdfDocument(path);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function handleCancel() {
    if (!document) return;
    try {
      await cancelJob(document.jobId);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    }
  }

  async function handleOpenDocumentFolder() {
    if (!document) return;
    const folder = documentFolder(document);
    if (!folder.path) return;
    try {
      if (folder.kind === "score-data") await showScoreDataFolder(folder.path);
      else await openCacheDirectory(folder.path);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function handleOpenMusicXml() {
    if (!document) return;
    setError(null);
    try {
      if (document.source.kind === "musicxml") await showScoreSource(document.source.sourcePath);
      else if (document.documentMusicXmlPath) await openMusicXml(document.documentMusicXmlPath);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function handleRetryPage(pageIndex: number) {
    if (!document) return;
    fingeringRequestRef.current = null;
    setError(null);
    stopRealtime();
    commitPlaybackState({
      ...playbackStateRef.current,
      active: false,
      currentMomentId: null,
    });
    setDocument((current) =>
      current
        ? replacePage(
            {
              ...current,
              status: "processing",
              documentMusicXmlPath: undefined,
              documentMusicXml: undefined,
              fingeringStatus: undefined,
              fingeringError: undefined,
              predictedFingerings: undefined,
              predictedFingeringCount: undefined,
            },
            pageIndex,
            (page) => ({
              ...page,
              status: "processing",
              error: undefined,
              artifacts: undefined,
              musicXml: undefined,
              visualSidecar: undefined,
            }),
          )
        : current,
    );
    try {
      await retryPage(document.jobId, pageIndex);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : String(retryError));
    }
  }

  const busy = document?.status === "opening" || document?.status === "processing";
  const latestWorkerLog = workerLogs.at(-1)?.line;
  const progress = document?.pageCount
    ? ((totals.completedPages + totals.skippedPages + totals.failedPages) / document.pageCount) * 100
    : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="document-heading">
          <h1>OMR Sheet Music Viewer</h1>
          <p>{activePage === "settings" ? "Playback preferences" : document ? document.name : workerInfo ?? "Open a score to begin"}</p>
        </div>
        {activePage === "viewer" && document ? (
          <div className="job-summary" aria-live="polite">
            <span>{statusLabel(document)}</span>
            {document.pageCount > 0 ? (
              <span>{totals.completedPages + totals.skippedPages + totals.failedPages} / {document.pageCount} pages</span>
            ) : null}
            {busy && latestWorkerLog ? (
              <span className="worker-stage" title={latestWorkerLog}>{latestWorkerLog}</span>
            ) : null}
          </div>
        ) : null}
        <div className="actions">
          {activePage === "viewer" ? (
            <>
          {document?.source.kind === "musicxml" ? (
            <button
              type="button"
              title={`Open ${fileName(document.source.sourcePath)} with the system default application`}
              disabled={document.status === "opening"}
              onClick={handleOpenMusicXml}
            >
              Open MusicXML
            </button>
          ) : document ? (
            <button
              type="button"
              title={
                document.fingeringStatus === "pending"
                  ? "Piano fingerings are being loaded from the MusicXML"
                  : document.fingeringStatus === "predicting"
                  ? "The MusicXML is being annotated with predicted piano fingerings"
                  : document.documentMusicXmlPath
                  ? `Open ${fileName(document.documentMusicXmlPath)} with the system default application`
                  : "MusicXML is available after every page is recognized"
              }
              disabled={
                !document.documentMusicXmlPath ||
                document.fingeringStatus === "pending" ||
                document.fingeringStatus === "predicting"
              }
              onClick={handleOpenMusicXml}
            >
              Open MusicXML
            </button>
          ) : null}
          {document ? (
            <button
              type="button"
              title={documentFolder(document).title}
              disabled={!documentFolder(document).path}
              onClick={handleOpenDocumentFolder}
            >
              {documentFolder(document).label}
            </button>
          ) : null}
          {busy ? <button type="button" onClick={handleCancel}>Cancel</button> : null}
          <button type="button" className="primary-button" onClick={handleOpenScore} disabled={!nativeAvailable || busy}>
            Open score
          </button>
            </>
          ) : null}
          <button
            type="button"
            className={activePage === "settings" ? "settings-button active" : "settings-button"}
            onClick={() => {
              if (activePage === "settings") closeSettings();
              else {
                setShowWorkerLogs(false);
                cancelMidiCapture();
                setActivePage("settings");
              }
            }}
          >
            {activePage === "settings" ? "Back to score" : "Settings"}
          </button>
        </div>
      </header>

      {activePage === "settings" ? (
        <SettingsPage
          shortcuts={shortcuts}
          playbackPiano={playbackPiano}
          listenInputSource={listenInputSource}
          loopDimOutside={loopDimOutside}
          loopRestart={loopRestart}
          onChangeLoopRestart={changeLoopRestart}
          debugPanelEnabled={debugPanelEnabled}
          sharedNoteheadTimingRepair={sharedNoteheadTimingRepair}
          timeSignatureRepair={timeSignatureRepair}
          tupletRepair={tupletRepair}
          listenMatcherProfileOverride={listenMatcherProfileOverride}
          nativeAvailable={nativeAvailable}
          midiPorts={midiPorts}
          midiError={midiError}
          midiRefreshing={midiRefreshing}
          midiCaptureCommand={midiCaptureCommand}
          showStopPlayback
          onClose={closeSettings}
          onChangeShortcuts={setShortcuts}
          onChangePlaybackPiano={(pianoId: PianoId) => {
            recognizerRef.current?.stop();
            stopRealtime();
            pianoSampler.stop();
            playbackStateRef.current = initialPlaybackState;
            setPlaybackState(initialPlaybackState);
            setPlaybackPiano(pianoId);
            savePlaybackPiano(pianoId);
          }}
          onChangeLoopDimOutside={(enabled) => {
            setLoopDimOutside(enabled);
            saveLoopDimOutside(enabled);
          }}
          realtimeCountIn={realtimeCountIn}
          onChangeRealtimeCountIn={(countIn) => {
            setRealtimeCountIn(countIn);
            saveRealtimeCountIn(countIn);
          }}
          keyboardView={keyboardView}
          onChangeKeyboardView={changeKeyboardView}
          noteHighwayEnabled={noteHighwayEnabled}
          onChangeNoteHighwayEnabled={changeNoteHighwayEnabled}
          onChangeListenInputSource={(inputSource) => {
            stopListenMode();
            setListenInputSource(inputSource);
            saveListenInputSource(inputSource);
          }}
          onChangeSharedNoteheadTimingRepair={(enabled) => {
            setSharedNoteheadTimingRepair(enabled);
            saveSharedNoteheadTimingRepair(enabled);
          }}
          onChangeTimeSignatureRepair={(enabled) => {
            setTimeSignatureRepair(enabled);
            saveTimeSignatureRepair(enabled);
          }}
          onChangeTupletRepair={(enabled) => {
            setTupletRepair(enabled);
            saveTupletRepair(enabled);
          }}
          onChangeDebugPanelEnabled={(enabled) => {
            setDebugPanelEnabled(enabled);
            saveDebugPanelEnabled(enabled);
            if (!enabled) setShowWorkerLogs(false);
            applyListenMatcherProfileOverride(
              listenMatcherOverrideAfterDebugPanelChange(enabled, listenMatcherProfileOverride),
            );
          }}
          onChangeListenMatcherProfileOverride={applyListenMatcherProfileOverride}
          onBeginMidiCapture={beginMidiCapture}
          onCancelMidiCapture={cancelMidiCapture}
          onRefreshMidiInputs={handleRefreshMidiInputs}
        />
      ) : (
        <>
      {busy && document?.pageCount ? (
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
      {playbackAudioError ? <div className="error" role="alert">{playbackAudioError}</div> : null}
      {midiError ? (
        <div className="warning" role="alert">
          <strong>MIDI controls unavailable.</strong> {midiError}
        </div>
      ) : null}
      {playbackActive && document && (
        document.status === "processing" ||
        document.fingeringStatus === "pending" ||
        document.fingeringStatus === "predicting"
      ) ? (
        <div className="warning" role="status">
          <strong>Fingerings are not available yet.</strong>{" "}
          Playback can continue while recognition runs; fingering labels will appear after the
          entire score is processed and fingering prediction finishes.
        </div>
      ) : null}
      {realtimeModel.error ? (
        <div className="warning" role="alert">
          <strong>Realtime playback is unavailable.</strong> {realtimeModel.error}
        </div>
      ) : null}

      <section
        className={`workspace${diagnosticsShown ? "" : " debug-panel-hidden"}${
          noteHighwayShown ? " note-highway-active" : ""
        }`}
        style={handColorProperties(keyboardHandColors)}
      >
        {document && document.pages.length > 0 ? (
          <>
            <DocumentViewer
              documentKey={document.jobId}
              pages={document.pages}
              noteGeometry={noteGeometry}
              selectedGroup={selectedGroup}
              highlightAllNotes={highlightAllNotes}
              showOriginalNoteheadContours={showOriginalNoteheadContours}
              showDetectedNoteheadContours={showDetectedNoteheadContours}
              showRefinedNoteheadContours={showRefinedNoteheadContours}
              showRawStemContours={showRawStemContours}
              showDiagnosticVisualGroups={
                diagnosticsShown && showDiagnosticVisualGroups
              }
              showUnsupportedRests={diagnosticsShown && showUnsupportedRests}
              showValueMismatches={diagnosticsShown && showValueMismatches}
              playbackActive={playbackActive}
              playbackNoteSoundsEnabled={
                playbackMode === "note-by-note"
                  ? effectivePlaybackNoteSounds(playbackState)
                  : !realtimeMuted(playbackState, listenInputSource)
              }
              playbackAvailable={playbackTimeline.length > 0}
              playbackMoment={playbackMoment}
              playbackMode={playbackMode}
              playbackStatus={playbackStatus}
              realtimeAvailable={realtimeModel.score !== null}
              realtimePlayhead={null}
              getRealtimePlayhead={
                playbackMode === "realtime" && realtimeStatus !== "inactive"
                  ? getRealtimePlayhead
                  : undefined
              }
              realtimePlayheadAnimating={playbackMode === "realtime" && realtimeStatus === "playing"}
              realtimePlayheadRevision={realtimeStatus === "playing" ? null : realtimeFrame}
              realtimeGroupIdsByPage={playbackMode === "realtime" ? realtimeGroupIdsByPage : undefined}
              tempoBpm={realtimeFrame?.bpm ?? realtimeOpeningBpm * tempoMultiplier}
              tempoMultiplier={tempoMultiplier}
              practiceHand={practiceHand}
              practicedHandSoundEnabled={practicedHandSoundEnabled}
              otherHandSoundEnabled={otherHandSoundEnabled}
              onPracticeHandChange={handlePracticeHandChange}
              onPracticedHandSoundChange={setPracticedHandSoundEnabled}
              onOtherHandSoundChange={setOtherHandSoundEnabled}
              noteHighwayEnabled={noteHighwayEnabled}
              noteHighwayVisible={noteHighwayVisible}
              loopMode={loopMode}
              loop={playbackActive ? loop : null}
              loopPass={loopPass}
              loopPlaying={playbackMode === "realtime"
                ? realtimeStatus !== "inactive" && realtimeRouteLoopsRef.current
                : noteByNoteInLoop(notePlaybackMoment, loop)}
              loopDimOutside={loopDimOutside}
              loopRestart={loopRestart}
              onLoopRestartChange={changeLoopRestart}
              loopCountInAvailable={realtimeCountIn !== "none"}
              onLoopToggle={() => handlePlaybackCommand("toggleLoopMode")}
              onLoopChange={changeLoopRegion}
              onLoopDragChange={setLoopDragging}
              onNoteHighwayToggle={toggleNoteHighway}
              listenFeedback={listenFeedback}
              realtimeWaitEnabled={realtimeWaitEnabled}
              realtimeWaiting={realtimeWaiting}
              initialViewportTransform={
                viewerViewportRef.current?.documentKey === document.jobId
                  ? viewerViewportRef.current.transform
                  : undefined
              }
              onViewportTransformChange={(transform) => {
                viewerViewportRef.current = { documentKey: document.jobId, transform };
              }}
              onPlaybackCommand={handlePlaybackCommand}
              onPlaybackModeChange={handlePlaybackModeChange}
              onTempoMultiplierChange={changeTempoMultiplier}
              onSelectGroup={handleViewerSelectGroup}
              onRetryPage={handleRetryPage}
              toolbarExtra={
                <FingeringToolbar editor={fingerEditor} shortcuts={shortcuts} />
              }
              renderPageExtra={fingerEditor.editing
                ? (page, scale, width) => page.surface
                  ? <FingeringPageLayer page={page.surface} editor={fingerEditor} scale={scale} displayWidth={width} />
                  : null
                : undefined}
              footer={<FingeringStatusStrip editor={fingerEditor} shortcuts={shortcuts} />}
              noteHighlight={fingerNoteHighlight}
              followMoment={fingerEditor.cursorMoment ?? returnMoment}
              stillPages={fingerEditor.editing}
              playbackLocked={fingerEditor.editing}
            />
            {diagnosticsShown ? <aside className="inspector" aria-label="Debug panel">
              <h2>Diagnostics</h2>
              <button
                type="button"
                className={showWorkerLogs ? "log-button active" : "log-button"}
                title={latestWorkerLog ?? "Show Python worker logs"}
                onClick={() => setShowWorkerLogs((current) => !current)}
              >
                Worker logs{workerLogs.length ? ` (${workerLogs.length})` : ""}
              </button>
              <dl className="diagnostics-data">
                <RefreshRateDiagnostic />
                <dt>Listen matcher profile</dt>
                <dd>
                  {listenMatcherProfile.id}
                  {listenMatcherProfileOverride ? " (debug override)" : ""}
                </dd>
                <dt>Listen engine</dt>
                <dd title={LISTEN_ENGINE.detail}>{LISTEN_ENGINE.label}</dd>
              </dl>
              <h2>Highlighting</h2>
              <button
                type="button"
                disabled={totals.visualGroups === 0}
                onClick={() => {
                  setSelectedGroup(null);
                  setHighlightAllNotes(true);
                }}
              >Highlight all notes</button>
              <h2>Debug overlays</h2>
              <label className="checkbox-row">
                <input type="checkbox" checked={showOriginalNoteheadContours} onChange={(event) => setShowOriginalNoteheadContours(event.target.checked)} />
                Original notehead contours
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showDetectedNoteheadContours} onChange={(event) => setShowDetectedNoteheadContours(event.target.checked)} />
                Detected notehead contours
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showRefinedNoteheadContours} onChange={(event) => setShowRefinedNoteheadContours(event.target.checked)} />
                Refined notehead contours
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showRawStemContours} onChange={(event) => setShowRawStemContours(event.target.checked)} />
                Raw stem contours
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showDiagnosticVisualGroups}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setShowDiagnosticVisualGroups(enabled);
                    if (
                      !enabled &&
                      selectedVisualGroup?.visual_status === "diagnostic"
                    ) {
                      setSelectedGroup(null);
                    }
                  }}
                />
                Diagnostic visual groups
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showUnsupportedRests} onChange={(event) => setShowUnsupportedRests(event.target.checked)} />
                Unsupported rests
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showValueMismatches} onChange={(event) => setShowValueMismatches(event.target.checked)} />
                Note value mismatches
              </label>
              <h2>Selection</h2>
              {selectedVisualGroup && selectedGroup ? (
                <>
                  <dl>
                    <dt>Page</dt><dd>{selectedGroup.pageIndex + 1}</dd>
                    <dt>Visual group</dt><dd>{selectedVisualGroup.visual_group_id}</dd>
                    <dt>MusicXML ID</dt><dd>{selectedVisualGroup.musicxml_id ?? "None"}</dd>
                    <dt>Notes</dt><dd>{noteSummary(selectedNotes)}</dd>
                    <dt>Printed value</dt>
                    <dd>{selectedPage?.visualSidecar ? printedValueSummary(selectedPage.visualSidecar, selectedNotes) : "Not read"}</dd>
                    <dt>Staff position</dt><dd>{selectedVisualGroup.staff_position}</dd>
                    <dt>Visual status</dt><dd>{selectedVisualGroup.visual_status}</dd>
                    <dt>Provenance</dt><dd>{selectedVisualGroup.provenance}</dd>
                    <dt>Moment ID</dt><dd>{selectedVisualGroup.moment_id ?? "None"}</dd>
                    <dt>Chord ID</dt><dd>{selectedVisualGroup.chord_id ?? "None"}</dd>
                    <dt>Repair actions</dt>
                    <dd>{selectedVisualGroup.repair_actions.join(", ") || "None"}</dd>
                    <dt>Confidence</dt><dd>{selectedNotes.length ? Math.max(...selectedNotes.map((note) => note.match_confidence)).toFixed(3) : "—"}</dd>
                  </dl>
                  <button type="button" onClick={() => setSelectedGroup(null)}>Clear</button>
                </>
              ) : highlightAllNotes ? (
                <>
                  <p>{totals.visualGroups.toLocaleString()} visual groups highlighted.</p>
                  <button type="button" onClick={() => setHighlightAllNotes(false)}>Clear</button>
                </>
              ) : (
                <p>Click a notehead to inspect its recognized note or chord.</p>
              )}
              <h2>Document data</h2>
              <dl>
                <dt>Pages ready</dt><dd>{totals.completedPages} / {document.pageCount}</dd>
                <dt>Pages without music</dt><dd>{totals.skippedPages}</dd>
                <dt>Failed pages</dt><dd>{totals.failedPages}</dd>
                <dt>Visual groups</dt><dd>{totals.visualGroups.toLocaleString()}</dd>
                <dt>Linked notes</dt><dd>{totals.linkedNotes.toLocaleString()}</dd>
                <dt>Predicted fingerings</dt><dd>{(document.predictedFingeringCount ?? 0).toLocaleString()}</dd>
                <dt>Unlinked MusicXML notes</dt><dd>{totals.unlinkedMusicXmlNotes.toLocaleString()}</dd>
                <dt>Diagnostic visual groups</dt><dd>{totals.diagnosticVisualGroups.toLocaleString()}</dd>
              </dl>
              {workerInfo ? <p className="worker-info">{workerInfo}</p> : null}
            </aside> : null}
            {noteHighwayShown ? (
              <NoteHighway
                getFrame={playbackMode === "realtime" ? realtimeHighwayFrame : noteByNoteHighwayFrame}
                hidden={!noteHighwayVisible}
                view={highwayView}
                upcomingLead={keyboardView.upcomingLead}
              />
            ) : null}
            {playbackActive || fingerEditor.editing ? (
              <PianoKeyboard
                highwayAttached={noteHighwayShown}
                range={keyboardRange}
                display={keyboardDisplay}
                blackKeyWidth={keyboardView.blackKeyWidth}
                solidTilt={keyboardSolid ? keyboardView.tilt : null}
                notes={fingerEditor.editing
                  ? fingerEditor.cursorMoment?.keyboardNotes ?? []
                  : playbackMode === "realtime"
                    ? realtimeDisplayNotes
                    : playbackMoment?.keyboardNotes ?? []}
                recognizedPitches={playbackState.listenModeEnabled
                  ? listenFeedback.recognizedActivePitches.map(({ midi }) => midi)
                  : []}
                attackPitches={playbackState.listenModeEnabled
                  ? listenFeedback.attackPitches
                  : []}
                successPitches={playbackState.listenModeEnabled
                  ? listenFeedback.successPitches
                  : []}
                waiting={realtimeWaiting}
              />
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            {document?.status === "opening" ? (
              <>
                <span className="spinner large" />
                <h2>Opening {document.name}</h2>
                <p>
                  {document.source.kind === "musicxml"
                    ? "Reading the score."
                    : "Fingerprinting the PDF and checking its recognition cache."}
                </p>
              </>
            ) : (
              <>
                <div className="empty-score-icon" aria-hidden="true">♪</div>
                <h2>Open a score</h2>
                <p>
                  MusicXML scores open directly. PDF pages are recognized locally with HOMR and
                  become interactive as soon as they are ready.
                </p>
                <button type="button" className="primary-button" onClick={handleOpenScore} disabled={!nativeAvailable}>Choose score</button>
              </>
            )}
          </div>
        )}
      </section>
      {showWorkerLogs && diagnosticsShown ? (
        <section className="worker-console" aria-label="Python worker logs">
          <header>
            <div>
              <strong>Python worker logs</strong>
              <span>Live HOMR diagnostics from stderr</span>
            </div>
            <div className="worker-console-actions">
              <button type="button" onClick={() => setWorkerLogs([])}>Clear view</button>
              <button type="button" onClick={() => setShowWorkerLogs(false)}>Close</button>
            </div>
          </header>
          <div ref={workerLogOutput} className="worker-log-output" role="log" aria-live="polite">
            {workerLogs.length ? (
              workerLogs.map((entry) => (
                <div key={entry.id} className="worker-log-line">
                  <time>{entry.time}</time>
                  <span>{entry.line}</span>
                </div>
              ))
            ) : (
              <div className="worker-log-empty">The worker has not written any logs yet.</div>
            )}
          </div>
          {workerLogPath ? <footer title={workerLogPath}>Saved to {workerLogPath}</footer> : null}
        </section>
      ) : null}
        </>
      )}
    </main>
  );
}
