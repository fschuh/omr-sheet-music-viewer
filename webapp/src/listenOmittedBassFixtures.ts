/**
 * Committed omitted-bass regressions, generated from measured browser runs.
 *
 * Each fixture stores the decoded recognition frames of one isolated trial,
 * without PCM or model scores, so the case can be replayed against every pinned
 * matcher profile in a unit test. The frames are verbatim decoder output on the
 * original absolute schedule, so no timestamp in this file has been shifted or
 * rounded.
 *
 * Regenerate them with the `listen-bass-qualification` browser command, which
 * prints a ready-to-paste entry for every omitted-bass trial it captures;
 * LISTEN_BENCHMARK.md records the run each fixture came from.
 */

import type { ListenOmittedBassRegressionFixture } from "./listenOmittedBassRegression";

/**
 * Direct `bundled-piano-web-audio-v1`, isolated fixture 122.
 *
 * Course Clear measure 2 moment 4 is the triad `[48, 60, 68]`; this fixture plays
 * only `[60, 68]`. The decoder still reports an onset on the unplayed C3 at
 * 0.5267, which is inside the `[0.50, 0.60)` corridor: `baseline-v1` refuses it
 * at 0.60 and all four frozen `v2` candidates admit it, completing a triad whose
 * lowest note was never sounded. The same musical input under the Tone renderer
 * decodes no bass onset at all and is refused by the fresh-bass rule, so the
 * cross-rendered counterpart is recorded as a diagnostic rather than pinned.
 */
export const DIRECT_ISOLATED_122_OMITTED_BASS_ADVANCE: ListenOmittedBassRegressionFixture = {
  id: "isolated-direct-122",
  label: "direct · isolated 122 · [48,60,68] played [60,68]",
  origin: {
    renderer: "bundled-piano-web-audio-v1",
    rendererKey: "direct",
    traceId: "isolated/direct/122",
    caseIndex: 122,
    sourcePcmHash: "24abfce7",
    sourceRecognitionStructureHash: "56d57ace",
  },
  targetPitches: [48, 60, 68],
  playedPitches: [60, 68],
  bassMidi: 48,
  hallucinatedBassOnset: {
    confidence: 0.5267344421758645,
    noteConfidence: 0.5267359406661664,
    onsetTimeMs: 384,
  },
  conclusion:
    "Measure 2 moment 4, [48, 60, 68] played as [60, 68]. The Direct renderer decodes a " +
    "0.5267 onset on the C3 that was never sounded; baseline-v1 refuses it at 0.60 and every " +
    "v2 candidate admits it at 0.50 or lower, completing the triad from a phantom bass.",
  pinnedOutcomes: [
    {
      profileId: "baseline-v1",
      advanced: false,
      onsetToAdvanceMs: null,
      hallucinatedQualifiedPitches: [],
      primaryLimitingPath: "fresh-onset-rejected",
    },
    {
      profileId: "early-open-v2",
      advanced: true,
      onsetToAdvanceMs: 196,
      hallucinatedQualifiedPitches: [48],
      primaryLimitingPath: "advanced",
    },
    {
      profileId: "steady-open-v2",
      advanced: true,
      onsetToAdvanceMs: 196,
      hallucinatedQualifiedPitches: [48],
      primaryLimitingPath: "advanced",
    },
    {
      profileId: "early-held-v2",
      advanced: true,
      onsetToAdvanceMs: 196,
      hallucinatedQualifiedPitches: [48],
      primaryLimitingPath: "advanced",
    },
    {
      profileId: "steady-held-v2",
      advanced: true,
      onsetToAdvanceMs: 196,
      hallucinatedQualifiedPitches: [48],
      primaryLimitingPath: "advanced",
    },
  ],
  crossRendered: {
    traceId: "isolated/tone/122",
    renderer: "bundled-piano-tone-v2",
    recognitionStructureHash: "1946c88f",
    outcomes: [
      {
        profileId: "baseline-v1",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "early-open-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "steady-open-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "early-held-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "steady-held-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
    ],
  },
  sampleRate: 16000,
  chunkSize: 512,
  relevantPitches: [48, 60, 68],
  frames: [
    {
      capturedAtMs: 32,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.164333883607809 },
        { midi: 60, confidence: 0.15487269873597648 },
        { midi: 68, confidence: 0.14830120226608454 },
      ],
    },
    {
      capturedAtMs: 64,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.004570863804068924 },
        { midi: 60, confidence: 0.0035213929581352117 },
        { midi: 68, confidence: 0.0006127134419642511 },
      ],
    },
    {
      capturedAtMs: 96,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.000950945583328712 },
        { midi: 60, confidence: 0.0007517266607756819 },
        { midi: 68, confidence: 0.000012777941711557084 },
      ],
    },
    {
      capturedAtMs: 128,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.0009409857173177834 },
        { midi: 60, confidence: 0.0007003185616575516 },
        { midi: 68, confidence: 0.0000020413254843307354 },
      ],
    },
    {
      capturedAtMs: 160,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.0014050968171482835 },
        { midi: 60, confidence: 0.001067630880472097 },
        { midi: 68, confidence: 0.0000013657265931047137 },
      ],
    },
    {
      capturedAtMs: 192,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.0021214118586538443 },
        { midi: 60, confidence: 0.0014987560711634286 },
        { midi: 68, confidence: 0.000001543863341994516 },
      ],
    },
    {
      capturedAtMs: 224,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.0014431246487963268 },
        { midi: 60, confidence: 0.0036638379653023026 },
        { midi: 68, confidence: 0.0000037150452918051655 },
      ],
    },
    {
      capturedAtMs: 256,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.00020480902566010818 },
        { midi: 60, confidence: 0.0022535749314658592 },
        { midi: 68, confidence: 0.0000072243017256445275 },
      ],
    },
    {
      capturedAtMs: 288,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.00026244778222508176 },
        { midi: 60, confidence: 0.0033052766823663785 },
        { midi: 68, confidence: 0.000008318981198483563 },
      ],
    },
    {
      capturedAtMs: 320,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.002163695952807276 },
        { midi: 60, confidence: 0.0037507529477013688 },
        { midi: 68, confidence: 0.0001643819954114644 },
      ],
    },
    {
      capturedAtMs: 352,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 0.014365153506957115 },
        { midi: 60, confidence: 0.15882745143029714 },
        { midi: 68, confidence: 0.017605869126796226 },
      ],
    },
    {
      capturedAtMs: 384,
      signalActive: true,
      onsets: [
        {
          midi: 48,
          confidence: 0.5267344421758645,
          noteConfidence: 0.5267359406661664,
          onsetTimeMs: 384,
        },
        {
          midi: 60,
          confidence: 0.9999180799004731,
          noteConfidence: 0.9999250509038949,
          onsetTimeMs: 384,
        },
        {
          midi: 68,
          confidence: 0.9980699606426363,
          noteConfidence: 0.9980826454525484,
          onsetTimeMs: 384,
        },
      ],
      noteEvents: [
        {
          midi: 48,
          type: "onset",
          confidence: 0.5267309643740654,
          eventTimeMs: 384,
        },
        {
          midi: 60,
          type: "onset",
          confidence: 0.9991456844347887,
          eventTimeMs: 384,
        },
        {
          midi: 68,
          type: "onset",
          confidence: 0.9980169837556557,
          eventTimeMs: 384,
        },
      ],
      activePitches: [
        { midi: 48, confidence: 0.5267359406661664 },
        { midi: 60, confidence: 0.9999250509038949 },
        { midi: 68, confidence: 0.9980826454525484 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 0.5267359406661664 },
        { midi: 60, confidence: 0.9999250509038949 },
        { midi: 68, confidence: 0.9980826454525484 },
      ],
    },
    {
      capturedAtMs: 416,
      signalActive: true,
      onsets: [],
      noteEvents: [
        {
          midi: 48,
          type: "offset",
          confidence: 0.7851626655103603,
          eventTimeMs: 416,
        },
      ],
      activePitches: [
        { midi: 60, confidence: 0.9508983886375095 },
        { midi: 68, confidence: 0.9546015867043407 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 0.21483554589014292 },
        { midi: 60, confidence: 0.9508983886375095 },
        { midi: 68, confidence: 0.9546015867043407 },
      ],
    },
    {
      capturedAtMs: 448,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9669734015472683 },
        { midi: 68, confidence: 0.9824774196246567 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 0.000478473397260627 },
        { midi: 60, confidence: 0.9669734015472683 },
        { midi: 68, confidence: 0.9824774196246567 },
      ],
    },
    {
      capturedAtMs: 480,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.968975955402591 },
        { midi: 68, confidence: 0.9957060942134415 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 0.0009192824054177718 },
        { midi: 60, confidence: 0.968975955402591 },
        { midi: 68, confidence: 0.9957060942134415 },
      ],
    },
    {
      capturedAtMs: 512,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9968363117169288 },
        { midi: 68, confidence: 0.9997413507966493 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 0.00006544232395563451 },
        { midi: 60, confidence: 0.9968363117169288 },
        { midi: 68, confidence: 0.9997413507966493 },
      ],
    },
    {
      capturedAtMs: 544,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.999276586068145 },
        { midi: 68, confidence: 0.999902172186429 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 0.000004197751238941307 },
        { midi: 60, confidence: 0.999276586068145 },
        { midi: 68, confidence: 0.999902172186429 },
      ],
    },
    {
      capturedAtMs: 576,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9948429951154812 },
        { midi: 68, confidence: 0.9996865872825607 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 0.0000011709683892226001 },
        { midi: 60, confidence: 0.9948429951154812 },
        { midi: 68, confidence: 0.9996865872825607 },
      ],
    },
    {
      capturedAtMs: 608,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9960293481489801 },
        { midi: 68, confidence: 0.9995754812125931 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 4.134377466565705e-7 },
        { midi: 60, confidence: 0.9960293481489801 },
        { midi: 68, confidence: 0.9995754812125931 },
      ],
    },
    {
      capturedAtMs: 640,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9997372033026266 },
        { midi: 68, confidence: 0.9997291728829737 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 3.295004081553145e-7 },
        { midi: 60, confidence: 0.9997372033026266 },
        { midi: 68, confidence: 0.9997291728829737 },
      ],
    },
    {
      capturedAtMs: 672,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.999752041519464 },
        { midi: 68, confidence: 0.9987724246499696 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 1.9555440054720856e-7 },
        { midi: 60, confidence: 0.999752041519464 },
        { midi: 68, confidence: 0.9987724246499696 },
      ],
    },
    {
      capturedAtMs: 704,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9977584697971682 },
        { midi: 68, confidence: 0.9966024149773511 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 1.102144349069122e-7 },
        { midi: 60, confidence: 0.9977584697971682 },
        { midi: 68, confidence: 0.9966024149773511 },
      ],
    },
    {
      capturedAtMs: 736,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.99661688776477 },
        { midi: 68, confidence: 0.9959422594970281 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 7.705356260956092e-8 },
        { midi: 60, confidence: 0.99661688776477 },
        { midi: 68, confidence: 0.9959422594970281 },
      ],
    },
    {
      capturedAtMs: 768,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.993074779783144 },
        { midi: 68, confidence: 0.9914724129737825 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 5.332338834458109e-8 },
        { midi: 60, confidence: 0.993074779783144 },
        { midi: 68, confidence: 0.9914724129737825 },
      ],
    },
    {
      capturedAtMs: 800,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9667032994158989 },
        { midi: 68, confidence: 0.99172426670411 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 3.456371061985419e-8 },
        { midi: 60, confidence: 0.9667032994158989 },
        { midi: 68, confidence: 0.99172426670411 },
      ],
    },
    {
      capturedAtMs: 832,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9125883868564851 },
        { midi: 68, confidence: 0.9864508235738687 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 2.053196689823673e-8 },
        { midi: 60, confidence: 0.9125883868564851 },
        { midi: 68, confidence: 0.9864508235738687 },
      ],
    },
    {
      capturedAtMs: 864,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9273627720954503 },
        { midi: 68, confidence: 0.9975197593136451 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 6.149388116503612e-8 },
        { midi: 60, confidence: 0.9273627720954503 },
        { midi: 68, confidence: 0.9975197593136451 },
      ],
    },
    {
      capturedAtMs: 896,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9608572236020284 },
        { midi: 68, confidence: 0.9994043459830884 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 1.0711011575081844e-7 },
        { midi: 60, confidence: 0.9608572236020284 },
        { midi: 68, confidence: 0.9994043459830884 },
      ],
    },
    {
      capturedAtMs: 928,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.9190238284362975 },
        { midi: 68, confidence: 0.9990212047265324 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 6.962671662495763e-8 },
        { midi: 60, confidence: 0.9190238284362975 },
        { midi: 68, confidence: 0.9990212047265324 },
      ],
    },
    {
      capturedAtMs: 960,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.7744424470830342 },
        { midi: 68, confidence: 0.9947558957830102 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 3.9339080343911455e-8 },
        { midi: 60, confidence: 0.7744424470830342 },
        { midi: 68, confidence: 0.9947558957830102 },
      ],
    },
    {
      capturedAtMs: 992,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.8048731164571876 },
        { midi: 68, confidence: 0.9840747759537172 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 8.533984002240336e-8 },
        { midi: 60, confidence: 0.8048731164571876 },
        { midi: 68, confidence: 0.9840747759537172 },
      ],
    },
    {
      capturedAtMs: 1024,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 60, confidence: 0.6969679618552664 },
        { midi: 68, confidence: 0.9260121663200684 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 7.728236981834191e-8 },
        { midi: 60, confidence: 0.6969679618552664 },
        { midi: 68, confidence: 0.9260121663200684 },
      ],
    },
    {
      capturedAtMs: 1056,
      signalActive: true,
      onsets: [],
      noteEvents: [
        {
          midi: 60,
          type: "offset",
          confidence: 0.5701505097538496,
          eventTimeMs: 1056,
        },
      ],
      activePitches: [
        { midi: 68, confidence: 0.7046810073648802 },
      ],
      confidenceEvidence: [
        { midi: 48, confidence: 6.991679711558071e-8 },
        { midi: 60, confidence: 0.4291365176342608 },
        { midi: 68, confidence: 0.7046810073648802 },
      ],
    },
    {
      capturedAtMs: 1088,
      signalActive: true,
      onsets: [],
      noteEvents: [
        {
          midi: 68,
          type: "offset",
          confidence: 0.8904397058142788,
          eventTimeMs: 1088,
        },
      ],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 2.537720758217731e-7 },
        { midi: 60, confidence: 7.832950270085162e-8 },
        { midi: 68, confidence: 0.107956263494187 },
      ],
    },
    {
      capturedAtMs: 1120,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 48, confidence: 3.26724587642894e-8 },
        { midi: 60, confidence: 5.246262796354565e-8 },
        { midi: 68, confidence: 2.1396978466866897e-9 },
      ],
    },
  ],
};

/**
 * Tone `bundled-piano-tone-v2`, isolated fixture 124.
 *
 * Course Clear measure 2 moment 6 is the triad `[56, 68, 75]`; this fixture plays
 * only `[68, 75]`. The decoder reports an onset on the unplayed G#3 at 0.5094,
 * again inside the corridor, and again `baseline-v1` refuses it while every `v2`
 * candidate advances. The Direct rendering of the same input decodes no bass
 * onset, so its counterpart is a diagnostic rather than a second pinned case.
 */
export const TONE_ISOLATED_124_OMITTED_BASS_ADVANCE: ListenOmittedBassRegressionFixture = {
  id: "isolated-tone-124",
  label: "tone · isolated 124 · [56,68,75] played [68,75]",
  origin: {
    renderer: "bundled-piano-tone-v2",
    rendererKey: "tone",
    traceId: "isolated/tone/124",
    caseIndex: 124,
    sourcePcmHash: "4e910448",
    sourceRecognitionStructureHash: "c80411e6",
  },
  targetPitches: [56, 68, 75],
  playedPitches: [68, 75],
  bassMidi: 56,
  hallucinatedBassOnset: {
    confidence: 0.509369488024272,
    noteConfidence: 0.509406402014739,
    onsetTimeMs: 416,
  },
  conclusion:
    "Measure 2 moment 6, [56, 68, 75] played as [68, 75]. The Tone renderer decodes a 0.5094 " +
    "onset on the G#3 that was never sounded; baseline-v1 refuses it at 0.60 and every v2 " +
    "candidate admits it at 0.50 or lower, completing the triad from a phantom bass.",
  pinnedOutcomes: [
    {
      profileId: "baseline-v1",
      advanced: false,
      onsetToAdvanceMs: null,
      hallucinatedQualifiedPitches: [],
      primaryLimitingPath: "fresh-onset-rejected",
    },
    {
      profileId: "early-open-v2",
      advanced: true,
      onsetToAdvanceMs: 228,
      hallucinatedQualifiedPitches: [56],
      primaryLimitingPath: "advanced",
    },
    {
      profileId: "steady-open-v2",
      advanced: true,
      onsetToAdvanceMs: 228,
      hallucinatedQualifiedPitches: [56],
      primaryLimitingPath: "advanced",
    },
    {
      profileId: "early-held-v2",
      advanced: true,
      onsetToAdvanceMs: 228,
      hallucinatedQualifiedPitches: [56],
      primaryLimitingPath: "advanced",
    },
    {
      profileId: "steady-held-v2",
      advanced: true,
      onsetToAdvanceMs: 228,
      hallucinatedQualifiedPitches: [56],
      primaryLimitingPath: "advanced",
    },
  ],
  crossRendered: {
    traceId: "isolated/direct/124",
    renderer: "bundled-piano-web-audio-v1",
    recognitionStructureHash: "10b385b9",
    outcomes: [
      {
        profileId: "baseline-v1",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "early-open-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "steady-open-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "early-held-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
      {
        profileId: "steady-held-v2",
        advanced: false,
        onsetToAdvanceMs: null,
        hallucinatedQualifiedPitches: [],
        primaryLimitingPath: "other-fixed-policy",
      },
    ],
  },
  sampleRate: 16000,
  chunkSize: 512,
  relevantPitches: [56, 68, 75],
  frames: [
    {
      capturedAtMs: 32,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.19168823599782145 },
        { midi: 68, confidence: 0.14830120226608454 },
        { midi: 75, confidence: 0.10379361270178553 },
      ],
    },
    {
      capturedAtMs: 64,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.001048563914475452 },
        { midi: 68, confidence: 0.0006127134419642511 },
        { midi: 75, confidence: 0.00042809000172270163 },
      ],
    },
    {
      capturedAtMs: 96,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.0000370514097502212 },
        { midi: 68, confidence: 0.000012777941711557084 },
        { midi: 75, confidence: 0.00001845109724131775 },
      ],
    },
    {
      capturedAtMs: 128,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.000020635228820332404 },
        { midi: 68, confidence: 0.0000020413254843307354 },
        { midi: 75, confidence: 0.000004207563642254917 },
      ],
    },
    {
      capturedAtMs: 160,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.00004549401460473015 },
        { midi: 68, confidence: 0.0000013657265931047137 },
        { midi: 75, confidence: 0.0000018840557110791703 },
      ],
    },
    {
      capturedAtMs: 192,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.00011164687330247795 },
        { midi: 68, confidence: 0.000001543863341994516 },
        { midi: 75, confidence: 0.0000010405081958173523 },
      ],
    },
    {
      capturedAtMs: 224,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.00018138709672865035 },
        { midi: 68, confidence: 0.0000016629815162941871 },
        { midi: 75, confidence: 5.995481136060372e-7 },
      ],
    },
    {
      capturedAtMs: 256,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.0015073451576781305 },
        { midi: 68, confidence: 0.000005537051725960949 },
        { midi: 75, confidence: 0.000002247948606578633 },
      ],
    },
    {
      capturedAtMs: 288,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.0029130659892812267 },
        { midi: 68, confidence: 0.000005109203865165524 },
        { midi: 75, confidence: 6.058732805854163e-7 },
      ],
    },
    {
      capturedAtMs: 320,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.01152377271304817 },
        { midi: 68, confidence: 0.000042627152295227993 },
        { midi: 75, confidence: 0.0000026758696681138397 },
      ],
    },
    {
      capturedAtMs: 352,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.1427296445264968 },
        { midi: 68, confidence: 0.004428910134152858 },
        { midi: 75, confidence: 0.00012504911913783587 },
      ],
    },
    {
      capturedAtMs: 384,
      signalActive: true,
      onsets: [
        {
          midi: 50,
          confidence: 0.5515706410262076,
          noteConfidence: 0.5515717222690308,
          onsetTimeMs: 384,
        },
        {
          midi: 68,
          confidence: 0.9998479669475666,
          noteConfidence: 0.9998495821505475,
          onsetTimeMs: 384,
        },
        {
          midi: 75,
          confidence: 0.7905185001059589,
          noteConfidence: 0.7908395967966961,
          onsetTimeMs: 384,
        },
      ],
      noteEvents: [
        {
          midi: 50,
          type: "onset",
          confidence: 0.5515633014338825,
          eventTimeMs: 384,
        },
        {
          midi: 68,
          type: "onset",
          confidence: 0.999778373766742,
          eventTimeMs: 384,
        },
        {
          midi: 75,
          type: "onset",
          confidence: 0.7905041742291014,
          eventTimeMs: 384,
        },
      ],
      activePitches: [
        { midi: 50, confidence: 0.5515717222690308 },
        { midi: 68, confidence: 0.9998495821505475 },
        { midi: 75, confidence: 0.7908395967966961 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.349410188703019 },
        { midi: 68, confidence: 0.9998495821505475 },
        { midi: 75, confidence: 0.7908395967966961 },
      ],
    },
    {
      capturedAtMs: 416,
      signalActive: true,
      onsets: [
        {
          midi: 47,
          confidence: 0.5381387103190479,
          noteConfidence: 0.5381742616236111,
          onsetTimeMs: 416,
        },
        {
          midi: 48,
          confidence: 0.7018503466060795,
          noteConfidence: 0.7018557665777285,
          onsetTimeMs: 416,
        },
        {
          midi: 56,
          confidence: 0.509369488024272,
          noteConfidence: 0.509406402014739,
          onsetTimeMs: 416,
        },
      ],
      noteEvents: [
        {
          midi: 47,
          type: "onset",
          confidence: 0.5381004213115456,
          eventTimeMs: 416,
        },
        {
          midi: 48,
          type: "onset",
          confidence: 0.7018020316210315,
          eventTimeMs: 416,
        },
        {
          midi: 50,
          type: "offset",
          confidence: 0.5329143807067989,
          eventTimeMs: 416,
        },
        {
          midi: 56,
          type: "onset",
          confidence: 0.5093646067964841,
          eventTimeMs: 416,
        },
      ],
      activePitches: [
        { midi: 47, confidence: 0.5381742616236111 },
        { midi: 48, confidence: 0.7018557665777285 },
        { midi: 56, confidence: 0.509406402014739 },
        { midi: 68, confidence: 0.9981160631212885 },
        { midi: 75, confidence: 0.9995975299573172 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.509406402014739 },
        { midi: 68, confidence: 0.9981160631212885 },
        { midi: 75, confidence: 0.9995975299573172 },
      ],
    },
    {
      capturedAtMs: 448,
      signalActive: true,
      onsets: [],
      noteEvents: [
        {
          midi: 47,
          type: "offset",
          confidence: 0.6803863135623963,
          eventTimeMs: 448,
        },
        {
          midi: 48,
          type: "offset",
          confidence: 0.6552004993346106,
          eventTimeMs: 448,
        },
      ],
      activePitches: [
        { midi: 56, confidence: 0.8916764202379928 },
        { midi: 68, confidence: 0.9872679236430821 },
        { midi: 75, confidence: 0.9984427128443866 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.8916764202379928 },
        { midi: 68, confidence: 0.9872679236430821 },
        { midi: 75, confidence: 0.9984427128443866 },
      ],
    },
    {
      capturedAtMs: 480,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9495153056616541 },
        { midi: 68, confidence: 0.9970552138928633 },
        { midi: 75, confidence: 0.9991678749676627 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9495153056616541 },
        { midi: 68, confidence: 0.9970552138928633 },
        { midi: 75, confidence: 0.9991678749676627 },
      ],
    },
    {
      capturedAtMs: 512,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9962776885564353 },
        { midi: 68, confidence: 0.9997801825804268 },
        { midi: 75, confidence: 0.9998890117746638 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9962776885564353 },
        { midi: 68, confidence: 0.9997801825804268 },
        { midi: 75, confidence: 0.9998890117746638 },
      ],
    },
    {
      capturedAtMs: 544,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9989308316785239 },
        { midi: 68, confidence: 0.9999117342279091 },
        { midi: 75, confidence: 0.9999407048670118 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9989308316785239 },
        { midi: 68, confidence: 0.9999117342279091 },
        { midi: 75, confidence: 0.9999407048670118 },
      ],
    },
    {
      capturedAtMs: 576,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9985460940380326 },
        { midi: 68, confidence: 0.9998906255987844 },
        { midi: 75, confidence: 0.9999535872876406 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9985460940380326 },
        { midi: 68, confidence: 0.9998906255987844 },
        { midi: 75, confidence: 0.9999535872876406 },
      ],
    },
    {
      capturedAtMs: 608,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9887081793393812 },
        { midi: 68, confidence: 0.9995502079152092 },
        { midi: 75, confidence: 0.9997496337314059 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9887081793393812 },
        { midi: 68, confidence: 0.9995502079152092 },
        { midi: 75, confidence: 0.9997496337314059 },
      ],
    },
    {
      capturedAtMs: 640,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9893130998338818 },
        { midi: 68, confidence: 0.9988130983609996 },
        { midi: 75, confidence: 0.9991491569373954 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9893130998338818 },
        { midi: 68, confidence: 0.9988130983609996 },
        { midi: 75, confidence: 0.9991491569373954 },
      ],
    },
    {
      capturedAtMs: 672,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9947779385462117 },
        { midi: 68, confidence: 0.9995329185052301 },
        { midi: 75, confidence: 0.9993672657010177 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9947779385462117 },
        { midi: 68, confidence: 0.9995329185052301 },
        { midi: 75, confidence: 0.9993672657010177 },
      ],
    },
    {
      capturedAtMs: 704,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9969282197327067 },
        { midi: 68, confidence: 0.9997036840764171 },
        { midi: 75, confidence: 0.9993122955975727 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9969282197327067 },
        { midi: 68, confidence: 0.9997036840764171 },
        { midi: 75, confidence: 0.9993122955975727 },
      ],
    },
    {
      capturedAtMs: 736,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.997724708033925 },
        { midi: 68, confidence: 0.998807684346392 },
        { midi: 75, confidence: 0.9964719954189126 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.997724708033925 },
        { midi: 68, confidence: 0.998807684346392 },
        { midi: 75, confidence: 0.9964719954189126 },
      ],
    },
    {
      capturedAtMs: 768,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [
        { midi: 56, confidence: 0.9941672583456906 },
        { midi: 68, confidence: 0.9813400130412437 },
        { midi: 75, confidence: 0.9923315935667203 },
      ],
      confidenceEvidence: [
        { midi: 56, confidence: 0.9941672583456906 },
        { midi: 68, confidence: 0.9813400130412437 },
        { midi: 75, confidence: 0.9923315935667203 },
      ],
    },
    {
      capturedAtMs: 800,
      signalActive: true,
      onsets: [],
      noteEvents: [
        {
          midi: 56,
          type: "offset",
          confidence: 0.9128310723322579,
          eventTimeMs: 800,
        },
        {
          midi: 68,
          type: "offset",
          confidence: 0.9365824344077862,
          eventTimeMs: 800,
        },
        {
          midi: 75,
          type: "offset",
          confidence: 0.6270373175320056,
          eventTimeMs: 800,
        },
      ],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.08707072941249278 },
        { midi: 68, confidence: 0.06278009748695067 },
        { midi: 75, confidence: 0.3729604020892539 },
      ],
    },
    {
      capturedAtMs: 832,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.00004663740544097915 },
        { midi: 68, confidence: 0.0000017583320869062678 },
        { midi: 75, confidence: 0.0000013606722573228525 },
      ],
    },
    {
      capturedAtMs: 864,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.000009553422063389993 },
        { midi: 68, confidence: 2.5163151345048073e-7 },
        { midi: 75, confidence: 8.319457767370536e-7 },
      ],
    },
    {
      capturedAtMs: 896,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.000006197288222708773 },
        { midi: 68, confidence: 1.6006282625848192e-7 },
        { midi: 75, confidence: 6.130493444315243e-7 },
      ],
    },
    {
      capturedAtMs: 928,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.0000023421338590275426 },
        { midi: 68, confidence: 1.4268544522055566e-7 },
        { midi: 75, confidence: 3.1391524671194676e-7 },
      ],
    },
    {
      capturedAtMs: 960,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 7.979046148138216e-7 },
        { midi: 68, confidence: 2.1737929307232055e-7 },
        { midi: 75, confidence: 1.0641741662141182e-7 },
      ],
    },
    {
      capturedAtMs: 992,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.0000013493607668908016 },
        { midi: 68, confidence: 1.832850900179455e-7 },
        { midi: 75, confidence: 1.4516453101092263e-7 },
      ],
    },
    {
      capturedAtMs: 1024,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.0000017470399565311848 },
        { midi: 68, confidence: 4.482021237274797e-8 },
        { midi: 75, confidence: 1.284194975338558e-7 },
      ],
    },
    {
      capturedAtMs: 1056,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.0000011424613700471136 },
        { midi: 68, confidence: 8.937633639781173e-9 },
        { midi: 75, confidence: 1.1734619934230528e-7 },
      ],
    },
    {
      capturedAtMs: 1088,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 0.000001364741011764404 },
        { midi: 68, confidence: 3.0358529100787178e-9 },
        { midi: 75, confidence: 2.88376105234128e-7 },
      ],
    },
    {
      capturedAtMs: 1120,
      signalActive: true,
      onsets: [],
      noteEvents: [],
      activePitches: [],
      confidenceEvidence: [
        { midi: 56, confidence: 2.1609998226232504e-7 },
        { midi: 68, confidence: 5.54582369340094e-10 },
        { midi: 75, confidence: 8.929502876990102e-8 },
      ],
    },
  ],
};

export const LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST:
  readonly ListenOmittedBassRegressionFixture[] = [
    DIRECT_ISOLATED_122_OMITTED_BASS_ADVANCE,
    TONE_ISOLATED_124_OMITTED_BASS_ADVANCE,
  ];
