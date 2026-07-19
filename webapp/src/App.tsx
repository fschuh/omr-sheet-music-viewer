import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentViewer } from "./DocumentViewer";
import { SettingsPage } from "./SettingsPage";
import {
  buildPlaybackTimeline,
  currentPlaybackMoment,
  initialPlaybackState,
  playbackCommandNames,
  runPlaybackCommand as applyPlaybackCommand,
  type PlaybackCommand,
} from "./playback";
import {
  cancelJob,
  choosePdf,
  getKeyboardRepeatTiming,
  getWorkerLogPath,
  loadPageArtifacts,
  nativeViewerAvailable,
  openCacheDirectory,
  openMusicXml,
  openPdf,
  pageImageUrl,
  refreshMidiInputs,
  retryPage,
  subscribeToMidiMessages,
  subscribeToWorkerEvents,
  type WorkerEvent,
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
  VisualGroupRef,
  VisualSidecarNote,
} from "./types";

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
  if (document.status === "opening") return "Opening PDF…";
  if (document.status === "processing") {
    return document.cacheStatus === "complete" ? "Loading cached recognition…" : "Recognizing score…";
  }
  if (document.status === "partial") return "Finished with page errors";
  if (document.status === "cancelled") return "Cancelled — completed pages were cached";
  if (document.status === "failed") return "Document processing failed";
  return document.cacheStatus === "complete" ? "Loaded from cache" : "Recognition complete";
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function App() {
  const nativeAvailable = nativeViewerAvailable();
  const activeJobId = useRef<string | null>(null);
  const nextWorkerLogId = useRef(1);
  const workerLogOutput = useRef<HTMLDivElement | null>(null);
  const [activePage, setActivePage] = useState<"viewer" | "settings">("viewer");
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const [shortcuts, setShortcuts] = useState<PlaybackShortcuts>(loadPlaybackShortcuts);
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const [midiPorts, setMidiPorts] = useState<string[]>([]);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiRefreshing, setMidiRefreshing] = useState(false);
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
  const [workerInfo, setWorkerInfo] = useState<string | null>(null);
  const [workerLogs, setWorkerLogs] = useState<WorkerLogEntry[]>([]);
  const [workerLogPath, setWorkerLogPath] = useState<string | null>(null);
  const [showWorkerLogs, setShowWorkerLogs] = useState(false);
  const [error, setError] = useState<string | null>(
    nativeAvailable ? null : "PDF processing is available in the Tauri desktop app. Run npm run tauri dev.",
  );
  const playbackTimeline = useMemo(
    () => buildPlaybackTimeline(document?.pages ?? []),
    [document?.pages],
  );
  const [playbackState, setPlaybackState] = useState(initialPlaybackState);
  const playbackActiveRef = useRef(playbackState.active);
  playbackActiveRef.current = playbackState.active;
  const playbackMoment = currentPlaybackMoment(playbackTimeline, playbackState);
  const handlePlaybackCommand = useCallback(
    (command: PlaybackCommand) => {
      setPlaybackState((current) => applyPlaybackCommand(playbackTimeline, current, command));
    },
    [playbackTimeline],
  );
  const handlePlaybackCommandRef = useRef(handlePlaybackCommand);
  handlePlaybackCommandRef.current = handlePlaybackCommand;

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
    const repeatCommand = () => {
      if (
        activeMidiRepeatRef.current !== activeRepeat ||
        activePageRef.current !== "viewer" ||
        !playbackActiveRef.current
      ) {
        if (activeMidiRepeatRef.current === activeRepeat) stopMidiRepeat();
        return;
      }
      handlePlaybackCommandRef.current(command);
    };
    activeMidiRepeatRef.current = activeRepeat;
    activeRepeat.delayId = window.setTimeout(() => {
      activeRepeat.delayId = null;
      repeatCommand();
      if (activeMidiRepeatRef.current !== activeRepeat) return;
      activeRepeat.intervalId = window.setInterval(repeatCommand, repeatTiming.intervalMs);
    }, repeatTiming.delayMs);
  }, [stopMidiRepeat]);

  const handleRefreshMidiInputs = useCallback(() => {
    if (!nativeAvailable) return;
    setMidiRefreshing(true);
    setMidiError(null);
    void refreshMidiInputs()
      .then((ports) => {
        setMidiPorts(ports);
        setMidiError(null);
      })
      .catch((refreshError: unknown) => {
        setMidiPorts([]);
        setMidiError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      })
      .finally(() => setMidiRefreshing(false));
  }, [nativeAvailable]);

  const cancelMidiCapture = useCallback(() => {
    midiCaptureCommandRef.current = null;
    setMidiCaptureCommand(null);
  }, []);

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
    setPlaybackState(initialPlaybackState);
  }, [document?.jobId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (activePage !== "viewer") return;
      if (isEditableKeyboardTarget(event.target)) return;
      const command = commandForKeyboardEvent(shortcuts, event);
      if (!command || (command !== "togglePlayback" && !playbackState.active)) return;
      if (command === "togglePlayback" && event.repeat) return;
      event.preventDefault();
      handlePlaybackCommand(command);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePage, handlePlaybackCommand, playbackState.active, shortcuts]);

  useEffect(() => {
    if (!playbackState.active || activePage !== "viewer") stopMidiRepeat();
  }, [activePage, playbackState.active, stopMidiRepeat]);

  useEffect(() => {
    if (!nativeAvailable) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    void subscribeToMidiMessages((event) => {
      const received = midiShortcutFromBytes(event.bytes);
      if (!received) return;

      const activeRepeat = activeMidiRepeatRef.current;
      if (activeRepeat && midiShortcutIsRelease(activeRepeat.shortcut, received)) {
        stopMidiRepeat();
        return;
      }
      if (activeRepeat && midiShortcutsEqual(activeRepeat.shortcut, received)) return;

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

      if (activePageRef.current !== "viewer") return;
      const command = commandForMidiShortcut(shortcutsRef.current, received);
      if (!command || (command !== "togglePlayback" && !playbackActiveRef.current)) return;
      stopMidiRepeat();
      handlePlaybackCommandRef.current(command);
      if (command !== "togglePlayback") startMidiRepeat(command, received);
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
                  page.status === "complete"
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
        setError(null);
        setDocument((current) => {
          if (current?.jobId === event.jobId && current.pages.length === event.pageCount) {
            return {
              ...current,
              name: event.documentName,
              cacheStatus: event.cacheStatus,
              cachePath: event.cachePath,
              documentMusicXmlPath: undefined,
              status: "processing",
            };
          }
          setSelectedGroup(null);
          setHighlightAllNotes(false);
          setPlaybackState(initialPlaybackState);
          return {
            jobId: event.jobId,
            name: event.documentName,
            pageCount: event.pageCount,
            cacheStatus: event.cacheStatus,
            cachePath: event.cachePath,
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
      if (event.type === "page_failed") {
        setDocument((current) =>
          current && current.jobId === event.jobId
            ? replacePage(current, event.pageIndex, (page) => ({
                ...page,
                status: "failed",
                error: event.error.message,
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

  const selectedPage = selectedGroup
    ? document?.pages.find((page) => page.index === selectedGroup.pageIndex)
    : undefined;
  const selectedVisualGroup = selectedGroup
    ? selectedPage?.visualSidecar?.visual_groups.find(
        (group) => group.visual_group_id === selectedGroup.visualGroupId,
      )
    : undefined;
  const selectedNotes = selectedVisualGroup
    ? selectedPage?.visualSidecar?.notes.filter(
        (note) => note.visual_group_id === selectedVisualGroup.visual_group_id,
      ) ?? []
    : [];

  const totals = useMemo(() => {
    const completedPages = document?.pages.filter((page) => page.status === "complete").length ?? 0;
    const failedPages = document?.pages.filter((page) => page.status === "failed").length ?? 0;
    const visualGroups =
      document?.pages.reduce(
        (total, page) => total + (page.visualSidecar?.visual_groups.length ?? 0),
        0,
      ) ?? 0;
    const linkedNotes =
      document?.pages.reduce((total, page) => total + (page.visualSidecar?.notes.length ?? 0), 0) ?? 0;
    const unmatchedMusicXml =
      document?.pages.reduce(
        (total, page) => total + (page.visualSidecar?.unmatched_musicxml_notes.length ?? 0),
        0,
      ) ?? 0;
    const unmatchedVisual =
      document?.pages.reduce(
        (total, page) => total + (page.visualSidecar?.unmatched_visual_notes.length ?? 0),
        0,
      ) ?? 0;
    return { completedPages, failedPages, visualGroups, linkedNotes, unmatchedMusicXml, unmatchedVisual };
  }, [document]);

  async function handleOpenPdf() {
    if (!nativeAvailable) return;
    setError(null);
    try {
      const path = await choosePdf();
      if (!path) return;
      setSelectedGroup(null);
      setHighlightAllNotes(false);
      setPlaybackState(initialPlaybackState);
      const jobId = await openPdf(path);
      activeJobId.current = jobId;
      setDocument((current) =>
        current?.jobId === jobId
          ? current
          : {
              jobId,
              name: fileName(path),
              pageCount: 0,
              cacheStatus: "miss",
              status: "opening",
              pages: [],
            },
      );
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

  async function handleOpenCacheDirectory() {
    if (!document?.cachePath) return;
    try {
      await openCacheDirectory(document.cachePath);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function handleOpenMusicXml() {
    if (!document?.documentMusicXmlPath) return;
    setError(null);
    try {
      await openMusicXml(document.documentMusicXmlPath);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function handleRetryPage(pageIndex: number) {
    if (!document) return;
    setError(null);
    setDocument((current) =>
      current
        ? replacePage(
            { ...current, status: "processing", documentMusicXmlPath: undefined },
            pageIndex,
            (page) => ({
              ...page,
              status: "processing",
              error: undefined,
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
    ? ((totals.completedPages + totals.failedPages) / document.pageCount) * 100
    : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="document-heading">
          <h1>HOMR Sheet Music Viewer</h1>
          <p>{activePage === "settings" ? "Playback preferences" : document ? document.name : workerInfo ?? "Open a PDF score to begin"}</p>
        </div>
        {activePage === "viewer" && document ? (
          <div className="job-summary" aria-live="polite">
            <span>{statusLabel(document)}</span>
            {document.pageCount > 0 ? (
              <span>{totals.completedPages + totals.failedPages} / {document.pageCount} pages</span>
            ) : null}
            {busy && latestWorkerLog ? (
              <span className="worker-stage" title={latestWorkerLog}>{latestWorkerLog}</span>
            ) : null}
          </div>
        ) : null}
        <div className="actions">
          {activePage === "viewer" ? (
            <>
          <button
            type="button"
            className={showWorkerLogs ? "log-button active" : "log-button"}
            title={latestWorkerLog ?? "Show Python worker logs"}
            onClick={() => setShowWorkerLogs((current) => !current)}
          >
            Worker logs{workerLogs.length ? ` (${workerLogs.length})` : ""}
          </button>
          {document ? (
            <button
              type="button"
              title={
                document.documentMusicXmlPath
                  ? `Open ${fileName(document.documentMusicXmlPath)} with the system default application`
                  : "MusicXML is available after every page is recognized"
              }
              disabled={!document.documentMusicXmlPath}
              onClick={handleOpenMusicXml}
            >
              Open MusicXML
            </button>
          ) : null}
          {document ? (
            <button
              type="button"
              title={document.cachePath ?? "The cache folder is available after the PDF is opened"}
              disabled={!document.cachePath}
              onClick={handleOpenCacheDirectory}
            >
              Open cache folder
            </button>
          ) : null}
          {busy ? <button type="button" onClick={handleCancel}>Cancel</button> : null}
          <button type="button" className="primary-button" onClick={handleOpenPdf} disabled={!nativeAvailable || busy}>
            Open PDF
          </button>
            </>
          ) : null}
          <button
            type="button"
            className={activePage === "settings" ? "settings-button active" : "settings-button"}
            onClick={() => {
              setShowWorkerLogs(false);
              cancelMidiCapture();
              setActivePage((current) => current === "viewer" ? "settings" : "viewer");
            }}
          >
            {activePage === "settings" ? "Back to score" : "Settings"}
          </button>
        </div>
      </header>

      {activePage === "settings" ? (
        <SettingsPage
          shortcuts={shortcuts}
          nativeAvailable={nativeAvailable}
          midiPorts={midiPorts}
          midiError={midiError}
          midiRefreshing={midiRefreshing}
          midiCaptureCommand={midiCaptureCommand}
          onChangeShortcuts={setShortcuts}
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

      <section className="workspace">
        {document && document.pages.length > 0 ? (
          <>
            <DocumentViewer
              documentKey={document.jobId}
              pages={document.pages}
              selectedGroup={selectedGroup}
              highlightAllNotes={highlightAllNotes}
              showOriginalNoteheadContours={showOriginalNoteheadContours}
              showDetectedNoteheadContours={showDetectedNoteheadContours}
              showRefinedNoteheadContours={showRefinedNoteheadContours}
              showRawStemContours={showRawStemContours}
              playbackActive={playbackState.active}
              playbackAvailable={playbackTimeline.length > 0}
              playbackMoment={playbackMoment}
              onPlaybackCommand={handlePlaybackCommand}
              onSelectGroup={(group) => {
                setSelectedGroup(group);
                setHighlightAllNotes(false);
              }}
              onRetryPage={handleRetryPage}
            />
            <aside className="inspector">
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
              <h2>Selection</h2>
              {selectedVisualGroup && selectedGroup ? (
                <>
                  <dl>
                    <dt>Page</dt><dd>{selectedGroup.pageIndex + 1}</dd>
                    <dt>Visual group</dt><dd>{selectedVisualGroup.visual_group_id}</dd>
                    <dt>MusicXML IDs</dt><dd>{selectedVisualGroup.musicxml_ids.join(", ") || "None"}</dd>
                    <dt>Notes</dt><dd>{noteSummary(selectedNotes)}</dd>
                    <dt>Staff position</dt><dd>{selectedVisualGroup.staff_position}</dd>
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
                <dt>Failed pages</dt><dd>{totals.failedPages}</dd>
                <dt>Visual groups</dt><dd>{totals.visualGroups.toLocaleString()}</dd>
                <dt>Linked notes</dt><dd>{totals.linkedNotes.toLocaleString()}</dd>
                <dt>Unmatched XML</dt><dd>{totals.unmatchedMusicXml.toLocaleString()}</dd>
                <dt>Unmatched visual</dt><dd>{totals.unmatchedVisual.toLocaleString()}</dd>
              </dl>
              {workerInfo ? <p className="worker-info">{workerInfo}</p> : null}
            </aside>
          </>
        ) : (
          <div className="empty-state">
            {document?.status === "opening" ? (
              <>
                <span className="spinner large" />
                <h2>Opening {document.name}</h2>
                <p>Fingerprinting the PDF and checking its recognition cache.</p>
              </>
            ) : (
              <>
                <div className="empty-score-icon" aria-hidden="true">♪</div>
                <h2>Open a PDF score</h2>
                <p>Pages are recognized locally with HOMR and become interactive as soon as they are ready.</p>
                <button type="button" className="primary-button" onClick={handleOpenPdf} disabled={!nativeAvailable}>Choose PDF</button>
              </>
            )}
          </div>
        )}
      </section>
      {showWorkerLogs ? (
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
