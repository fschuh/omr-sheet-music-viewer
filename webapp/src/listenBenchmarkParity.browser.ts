import {
  captureIsolatedOnlineAmtBenchmark,
  renderIsolatedListenBenchmarkAudio,
} from "./listenBenchmark";
import {
  LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  LISTEN_BENCHMARK_RELEASE_MS,
  renderBenchmarkAudio,
} from "./listenBenchmarkAudio";
import {
  benchmarkAudioAttacksForSequence,
  bundledListenSequences,
  captureListenSequenceTrace,
  courseClearArticulationDefinitions,
  materializeListenSequence,
  renderListenSequenceAudio,
  replayListenSequenceTrace,
  type ListenRecognitionFrame,
  type ListenSequenceDefinition,
} from "./listenSequenceBenchmark";
import { OnlineAmtSession } from "./onlineAmtSession";

export interface ListenBenchmarkParityCheck {
  name: string;
  maximumAbsolutePcmDifference?: number;
  passed: boolean;
}

export interface ListenBenchmarkParityResult {
  passed: boolean;
  checks: ListenBenchmarkParityCheck[];
}

function require(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function maximumAbsoluteDifference(
  left: Float32Array,
  right: Float32Array,
  length = Math.max(left.length, right.length),
): number {
  require(left.length >= length && right.length >= length, "PCM comparison exceeded a buffer.");
  let maximum = 0;
  for (let index = 0; index < length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

function pcmRms(pcm: Float32Array, startFrame: number, endFrame: number): number {
  let sumSquares = 0;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    sumSquares += pcm[frame] * pcm[frame];
  }
  return endFrame <= startFrame ? 0 : Math.sqrt(sumSquares / (endFrame - startFrame));
}

function oneEventDefinition(notes: readonly number[], id: string): ListenSequenceDefinition {
  return {
    id,
    family: "parity",
    label: id,
    targets: [notes],
    attacks: [{ at: 0, targetIndex: 0, notes, expectedAdvance: true }],
  };
}

function frameSignature(frame: ListenRecognitionFrame): unknown {
  return {
    capturedAtMs: frame.capturedAtMs,
    modelScores: frame.modelScores,
    modelStates: frame.modelStates,
    signalActive: frame.signalActive,
    onsets: frame.onsets,
    noteEvents: frame.noteEvents,
    activePitches: frame.activePitches,
    confidenceEvidence: frame.confidenceEvidence,
  };
}

/** Runs browser-only PCM and online-AMT parity assertions against bundled samples. */
export async function runListenBenchmarkParityTests(
  onProgress: (stage: string) => void = () => undefined,
): Promise<ListenBenchmarkParityResult> {
  const checks: ListenBenchmarkParityCheck[] = [];
  const recordPcm = (
    name: string,
    left: Float32Array,
    right: Float32Array,
    length?: number,
    tolerance = 0,
  ) => {
    const difference = maximumAbsoluteDifference(left, right, length);
    require(
      difference <= tolerance,
      `${name}: maximum absolute PCM difference ${difference} exceeded ${tolerance}.`,
    );
    checks.push({ name, maximumAbsolutePcmDifference: difference, passed: true });
  };

  onProgress("Rendering isolated and one-event C4…");
  const isolatedC4 = await renderIsolatedListenBenchmarkAudio([60]);
  const oneC4 = materializeListenSequence(oneEventDefinition([60], "one-c4"), 1_000);
  const continuousC4 = await renderListenSequenceAudio(oneC4);
  recordPcm("isolated C4 equals one-event continuous C4", isolatedC4.pcm, continuousC4.pcm);

  onProgress("Checking equivalent chord prefixes…");
  const isolatedChord = await renderIsolatedListenBenchmarkAudio([48, 60, 64]);
  const chordPassage = materializeListenSequence({
    id: "chord-prefix",
    family: "parity",
    label: "Chord prefix",
    targets: [[48, 60, 64], [55]],
    attacks: [
      { at: 0, targetIndex: 0, notes: [48, 60, 64], expectedAdvance: true },
      { at: 1, targetIndex: 1, notes: [55], expectedAdvance: true },
    ],
  }, 500);
  const continuousChord = await renderListenSequenceAudio(chordPassage);
  const nextAttackFrame = Math.round(chordPassage.attacks[1].scheduledAtMs * 16);
  recordPcm(
    "isolated chord equals the equivalent passage before its next attack",
    isolatedChord.pcm,
    continuousChord.pcm,
    nextAttackFrame,
    1e-6,
  );

  onProgress("Checking later-event level independence…");
  const prefixDurationMs = 2_000;
  const quiet = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 220, notes: [60] }],
    durationMs: prefixDurationMs,
  });
  const laterLoud = await renderBenchmarkAudio({
    attacks: [
      { onsetMs: 220, notes: [60] },
      { onsetMs: 1_200, notes: [48, 55, 60, 64, 67, 72] },
    ],
    durationMs: prefixDurationMs,
  });
  recordPcm(
    "a later loud event cannot modify earlier samples",
    quiet.pcm,
    laterLoud.pcm,
    Math.round(1_200 * 16),
    1e-6,
  );

  onProgress("Checking rolled, repeated, and sustained schedules…");
  const rolledOffset = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 220, notes: [{ midi: 60, offsetMs: 18 }] }],
    durationMs: 1_200,
  });
  const explicitlyShifted = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 238, notes: [60] }],
    durationMs: 1_200,
  });
  recordPcm("an 18 ms rolled offset lands at sample 288", rolledOffset.pcm, explicitlyShifted.pcm);

  const repeated = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 220, notes: [60] }, { onsetMs: 553.3333333333333, notes: [60] }],
    durationMs: 1_600,
  });
  const firstOnly = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 220, notes: [60] }],
    durationMs: 1_600,
  });
  const secondOnly = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 553.3333333333333, notes: [60] }],
    durationMs: 1_600,
  });
  let repeatedEnvelopeDifference = 0;
  for (let index = 0; index < repeated.pcm.length; index += 1) {
    repeatedEnvelopeDifference = Math.max(
      repeatedEnvelopeDifference,
      Math.abs(repeated.pcm[index] - firstOnly.pcm[index] - secondOnly.pcm[index]),
    );
  }
  require(
    repeatedEnvelopeDifference <= 1e-6,
    `Repeated attack envelopes did not mix independently (${repeatedEnvelopeDifference}).`,
  );
  checks.push({
    name: "fractional repeated attacks preserve separate envelopes",
    maximumAbsolutePcmDifference: repeatedEnvelopeDifference,
    passed: true,
  });

  const defaultChord = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 220, notes: [60, 64] }],
    durationMs: 1_600,
  });
  const sustainedC = await renderBenchmarkAudio({
    attacks: [{ onsetMs: 220, notes: [{ midi: 60, holdMs: 900 }, 64] }],
    durationMs: 1_600,
  });
  const defaultReleaseFrame = Math.round(
    (220 + LISTEN_BENCHMARK_DEFAULT_HOLD_MS) * 16,
  );
  recordPcm(
    "a note-specific sustain leaves the shared attack unchanged before release",
    defaultChord.pcm,
    sustainedC.pcm,
    defaultReleaseFrame,
    1e-6,
  );
  require(
    maximumAbsoluteDifference(
      defaultChord.pcm.subarray(defaultReleaseFrame),
      sustainedC.pcm.subarray(defaultReleaseFrame),
      defaultChord.pcm.length - defaultReleaseFrame,
    ) > 0,
    "The requested sustained-note override did not affect its release tail.",
  );
  checks.push({ name: "sustained-note overrides affect only the requested schedule", passed: true });

  onProgress("Checking Course Clear articulation rendering…");
  const articulationDefinitions = courseClearArticulationDefinitions();
  const existingCourseClear = materializeListenSequence(
    bundledListenSequences().find(({ id }) => id === "course-clear-27")!,
    1_000,
  );
  const normalCourseClear = materializeListenSequence(
    articulationDefinitions.find(({ articulation }) => articulation === "normal")!,
    1_000,
  );
  const existingCourseClearAudio = await renderListenSequenceAudio(existingCourseClear);
  const normalCourseClearAudio = await renderListenSequenceAudio(normalCourseClear);
  recordPcm(
    "normal articulation preserves the current Course Clear PCM",
    existingCourseClearAudio.pcm,
    normalCourseClearAudio.pcm,
    undefined,
    1e-6,
  );

  const detachedCourseClear = materializeListenSequence(
    articulationDefinitions.find(({ articulation }) => articulation === "detached")!,
    1_000,
  );
  const detachedCourseClearAudio = await renderListenSequenceAudio(detachedCourseClear);
  let maximumDetachedGapRms = 0;
  for (let index = 1; index < detachedCourseClear.attacks.length; index += 1) {
    const previousEnvelopeEndMs = Math.max(...detachedCourseClear.attacks[index - 1].notes.map(
      ({ releaseTimeMs }) => releaseTimeMs + LISTEN_BENCHMARK_RELEASE_MS,
    ));
    maximumDetachedGapRms = Math.max(
      maximumDetachedGapRms,
      pcmRms(
        detachedCourseClearAudio.pcm,
        Math.ceil(previousEnvelopeEndMs * 16),
        Math.floor(detachedCourseClear.attacks[index].scheduledAtMs * 16),
      ),
    );
  }
  require(maximumDetachedGapRms === 0, `Detached gap RMS was ${maximumDetachedGapRms}.`);
  checks.push({ name: "every detached Course Clear gap contains digital silence", passed: true });

  const legatoCourseClear = materializeListenSequence(
    articulationDefinitions.find(({ articulation }) => articulation === "legato")!,
    1_000,
  );
  const legatoCourseClearAudio = await renderListenSequenceAudio(legatoCourseClear);
  const secondAttackFrame = Math.round(legatoCourseClear.attacks[1].scheduledAtMs * 16);
  const legatoPreAttackRms = pcmRms(
    legatoCourseClearAudio.pcm,
    secondAttackFrame - 100 * 16,
    secondAttackFrame,
  );
  const normalPreAttackRms = pcmRms(
    normalCourseClearAudio.pcm,
    secondAttackFrame - 100 * 16,
    secondAttackFrame,
  );
  require(legatoPreAttackRms > 0, "Legato release tail was silent before the next attack.");
  require(normalPreAttackRms === 0, "Normal articulation unexpectedly sounded before attack two.");
  checks.push({ name: "legato release tails overlap the following attack", passed: true });

  const sustainedCourseClear = materializeListenSequence(
    articulationDefinitions.find(({ articulation }) => articulation === "sustained-shared")!,
    1_000,
  );
  const normalPartialAttack = benchmarkAudioAttacksForSequence(normalCourseClear)[23];
  const sustainedPartialAttack = benchmarkAudioAttacksForSequence(sustainedCourseClear)[23];
  const normalPartialChord = await renderBenchmarkAudio({
    attacks: [{ ...normalPartialAttack, onsetMs: 220 }],
    durationMs: 1_400,
  });
  const normalHeldTones = await renderBenchmarkAudio({
    attacks: [{
      onsetMs: 220,
      gainReferenceChordSize: normalPartialAttack.notes.length,
      notes: normalPartialAttack.notes.filter((note) => (
        typeof note === "number" ? note !== 62 : note.midi !== 62
      )),
    }],
    durationMs: 1_400,
  });
  const sustainedNewTone = await renderBenchmarkAudio({
    attacks: [{ ...sustainedPartialAttack, onsetMs: 220 }],
    durationMs: 1_400,
  });
  let maximumNewToneGainDifference = 0;
  for (let frame = 0; frame < normalPartialChord.pcm.length; frame += 1) {
    maximumNewToneGainDifference = Math.max(
      maximumNewToneGainDifference,
      Math.abs(
        normalPartialChord.pcm[frame] - normalHeldTones.pcm[frame] -
        sustainedNewTone.pcm[frame]
      ),
    );
  }
  require(
    maximumNewToneGainDifference <= 1e-6,
    `Sustained-shared new-note gain differed by ${maximumNewToneGainDifference}.`,
  );
  checks.push({
    name: "sustained-shared new notes retain normal whole-chord gain",
    maximumAbsolutePcmDifference: maximumNewToneGainDifference,
    passed: true,
  });

  for (const rendered of [
    isolatedC4,
    continuousC4,
    continuousChord,
    quiet,
    laterLoud,
    rolledOffset,
    repeated,
    sustainedC,
    existingCourseClearAudio,
    normalCourseClearAudio,
    detachedCourseClearAudio,
    legatoCourseClearAudio,
  ]) {
    require(rendered.pcm.length % 512 === 0, "A rendered output was not 512-sample aligned.");
  }
  checks.push({ name: "every output is 512-sample aligned", passed: true });

  onProgress("Loading online-AMT model…");
  const session = await OnlineAmtSession.create({
    modelUrl: new URL("models/online_amt_streaming.onnx", document.baseURI).href,
    numThreads: 1,
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  });
  try {
    onProgress("Capturing isolated online-AMT trace…");
    const isolatedRecognition = await captureIsolatedOnlineAmtBenchmark({
      generation: 1,
      targetPitches: [60],
      playedPitches: [60],
      session,
    });
    onProgress("Capturing one-event continuous online-AMT trace…");
    const sequenceAudio = await renderListenSequenceAudio(oneC4);
    const sequenceTrace = await captureListenSequenceTrace({
      sequenceId: oneC4.definition.id,
      intervalMs: oneC4.intervalMs,
      audio: sequenceAudio.pcm,
      relevantPitches: oneC4.relevantPitches,
      session,
      renderer: sequenceAudio.renderer,
      audioDiagnostics: sequenceAudio.diagnostics,
    });
    recordPcm(
      "isolated and continuous recognition receive identical PCM",
      isolatedRecognition.trace!.pcm,
      sequenceTrace.pcm,
    );
    require(
      isolatedRecognition.trace!.frames.length === sequenceTrace.frames.length,
      "Recognition trace frame counts differ.",
    );
    for (let index = 0; index < sequenceTrace.frames.length; index += 1) {
      require(
        JSON.stringify(frameSignature(isolatedRecognition.trace!.frames[index])) ===
          JSON.stringify(frameSignature(sequenceTrace.frames[index])),
        `Recognition traces differ at frame ${index}.`,
      );
    }
    checks.push({ name: "model and decoder traces match frame-for-frame", passed: true });

    onProgress("Comparing decoder and matcher traces…");
    const sequenceResult = replayListenSequenceTrace(oneC4, sequenceTrace, "current-matcher");
    require(
      isolatedRecognition.advanced === sequenceResult.events[0].orderedAdvanced,
      "Matcher results differ between isolated and continuous entry points.",
    );
    require(
      isolatedRecognition.onsetToAdvanceMs === sequenceResult.events[0].orderedAdvanceLatencyMs,
      "Advancement latency differs between isolated and continuous entry points.",
    );
    checks.push({ name: "matcher result and advancement latency match", passed: true });
  } finally {
    await session.dispose();
  }

  // Keep these constants covered explicitly so a silent articulation change fails parity QA.
  require(LISTEN_BENCHMARK_RELEASE_MS === 350, "Canonical release changed unexpectedly.");
  return { passed: checks.every(({ passed }) => passed), checks };
}
