# online_amt listening benchmark

[Back to the benchmark index](BENCHMARK.md).

## Benchmark history

Entries are kept newest first so renderer and recognition changes remain
comparable over time.

### Matcher profile registry refactor parity — August 17, 2026

This entry records a refactor verification, not a new measured baseline. The
matcher profile registry (`listenMatcherProfiles.ts`), the extracted 1,000-profile
sweep (`listenMatcherSweepBenchmark.ts`), and the migration of production and
benchmark consumers onto one profile type and one option conversion were checked
against the measured sections below. No recognition, safety, latency, PCM, or
export value changed.

Measured on the development Windows machine at commit `1ec55a1` with the
`bundled-piano-web-audio-v1` and `bundled-piano-tone-v2` renderers and the
unchanged `online_amt_streaming.onnx` model (71,955,821 bytes,
SHA-256 `a77be8262d3742ce…`). Production still resolves `baseline-v1`, whose
converted options equal the former `onlineAmtChordMatcherOptions` field for
field: onset 0.60, target-note 0.50, active-target 0.35, extra-note 0.97, fresh
bass required, 32 ms settle, and `noteEvents` refractory counting.

Baseline parity is now asserted by the harness itself rather than by inspection.
Every captured continuous run, articulation run, dynamics run, and isolated trial
is replayed with the explicitly named `baseline-v1` profile and compared event for
event. Every capture path also signs the rendered waveform before inference runs
and requires the trace's audio signature to match that snapshot chunk hash for
chunk hash, and re-hashes the retained trace immediately after each individual
replay — current, baseline, and buffered alike — so a mutation is attributed to
the replay that caused it and cannot be masked by a later replay restoring the
value. A mismatch aborts the benchmark with the differing field path. The
canonical Splendid `mp` smoke is additionally compared against constants recorded
before the refactor, so shared-code drift cannot update both sides of a
self-comparison.

What can be frozen across runs is bounded by the platform. Rendering the same
isolated C-major chord three times in one browser process produced three
different waveform hashes (`4981972c`, `678237b9`, `1cdd544c`) with an identical
peak and RMS differing by 3e-10, and inference over those waveforms produced
first-onset confidences spanning 0.9997449028 to 0.9997449116. Chrome's
`OfflineAudioContext` and ONNX Runtime therefore do not reproduce their last bits,
so a fixed waveform or raw-score hash would fail roughly two runs in three. The
decoded structure does reproduce: a hash over per-frame argmax states, the silence
gate, and every decoded onset, note event, active pitch, and evidence pitch with
its timestamp was identical across five captures in each of three browser
processes.

The canonical comparison therefore requires exact equality for sample counts,
advancement, onset timing, recognized pitches, and the decoded structure hash
(`83fbd243` Direct, `5c164339` Tone), and allows continuous values — renderer
amplitudes and model confidences — to differ by at most one representable Float32
step. That step is 5.96e-8 near unit confidence and 7.45e-9 near the measured RMS,
between 20× and 25× the observed run-to-run spread. Within a single run no
tolerance applies: rendered-versus-recognized PCM, replayed runs, and full
recognition hashes are compared exactly.

| Regression | Result | Compared against |
| --- | --- | --- |
| Paired isolated smoke | `matched-recorded-baseline`, both renderers, three consecutive browser processes | Paired renderer baseline, August 15 |
| Sequence corpus, 13 families × 6 speeds | Identical per-speed completion, ordered advances, and P95 latency | Paired renderer baseline, August 15 |
| Course Clear articulation matrix | `no-detached-benefit`, identical four-profile table | Corrected articulation matrix, August 13 |
| Dynamics smoke, Splendid and Salamander | Unchanged advancement and PCM identities | Paired renderer baseline, August 15 |
| 1,000-profile threshold sweep | 680 rejected, 15-profile frontier, `o0p450-t0p500-a0p200-x0p990-b1` | Threshold replay sweep, August 13 |

The canonical isolated smoke reproduced its recorded identities exactly:

| Renderer | Advanced | Onset to advance | Peak | RMS | Trace frames |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct v1 | Yes | 196 ms | 0.603168 | 0.100907 | 35 |
| Tone v2 | Yes | 196 ms | 0.432499 | 0.078035 | 35 |

The continuous corpus reproduced both renderers row for row, with all
safety-family false, skipped, and duplicate advances at zero and the next-onset
buffer experiment still rejected (Direct −5 correct advances and −1 complete
passage; Tone unchanged):

| Interval | Complete passages, Direct / Tone | Ordered advances, Direct / Tone | P95 ordered latency, Direct / Tone |
| --- | ---: | ---: | ---: |
| 1000 ms | 8 / 13 · 9 / 13 | 66 / 85 · 63 / 85 | 220 ms · 228 ms |
| 500 ms | 9 / 13 · 9 / 13 | 73 / 85 · 70 / 85 | 208 ms · 224 ms |
| 333.33 ms | 7 / 13 · 9 / 13 | 43 / 85 · 56 / 85 | 228 ms · 228 ms |
| 250 ms | 9 / 13 · 10 / 13 | 53 / 85 · 63 / 85 | 214 ms · 234 ms |
| 167 ms | 7 / 13 · 8 / 13 | 45 / 85 · 52 / 85 | 221 ms · 228 ms |
| 125 ms | 9 / 13 · 8 / 13 | 51 / 85 · 51 / 85 | 231 ms · 234 ms |

The sweep reproduced its discovery result under both renderers. Direct kept the
production baseline at 291 independent matches, 283 ordered advances, 199 prefix
completions, 33 complete passages, and 214.67 ms P95, and recommended
`o0p450-t0p500-a0p200-x0p990-b1` at 308 / 365 / 268 / 43 and 209.33 ms with all
four dedicated safety counters at zero. Tone rejected 575 profiles and kept its
three-profile frontier led by `o0p500-t0p500-a0p200-x0p970-b1`. Both runs report
`replayParityVerified`, which now means the frozen `baseline-v1` entry rather than
a mutable production pointer.

Commands, run on a clean local Vite server:

```powershell
npm --prefix webapp test
npm --prefix webapp run build

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-smoke

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-smoke

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-articulation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-threshold-sweep
```

### Paired renderer baseline — August 15, 2026

Measured with Chrome 152.0.7977.42 on the 10-logical-processor development
Windows machine at commit `d95922c`. The matcher, model, fixtures, schedules,
sample rate, and chunk size were identical between renderers. The paired smoke
test passed before the complete isolated corpus (106 correct trials plus safety
cases) and complete 13-family × 6-speed continuous corpus were each run twice;
both repetitions produced the same recognition summaries and failure identities.

The preflight rendered and recognized one C-major triad through the complete
browser pipeline before the full runs began:

| Renderer | Advanced | Onset-to-advance | PCM peak | PCM RMS | Trace frames |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct v1 | Yes | 196 ms | 0.603168 | 0.100907 | 35 |
| Tone v2 | Yes | 196 ms | 0.432499 | 0.078035 | 35 |

Isolated accuracy:

| Metric | Direct v1 | Tone v2 | Tone delta |
| --- | ---: | ---: | ---: |
| Correct trials advanced | 104 / 106 (98.1%) | 100 / 106 (94.3%) | −4 (−3.8 pp) |
| Course Clear correct trials advanced | 52 / 54 (96.3%) | 48 / 54 (88.9%) | −4 (−7.4 pp) |
| Distinguishable wrong-note false advances | 0 | 0 | 0 |
| Mathematically ambiguous advances | 4 | 5 | +1 |
| P95 onset-to-advance latency | 196 ms | 228 ms | +32 ms |
| Fixed acceptance gate | Pass | Fail | — |

Every miss was deterministic and occurred twice because each Course Clear
fixture is repeated twice:

| Course Clear target | Missing onset | Direct misses | Tone misses |
| --- | ---: | ---: | ---: |
| Measure 2, moment 6: `[56, 68, 75]` | 75 | 0 | 2 |
| Measure 3, moment 4: `[50, 62, 70]` | 70 | 0 | 2 |
| Measure 3, moment 5: `[53, 65, 74]` | 65 | 2 | 2 |

The Tone path therefore exposes two additional weak upper-note cases and does
not pass the existing 95% overall or Course Clear acceptance thresholds. Its
lower C-major preflight peak/RMS is consistent with a materially different
processed signal level, but this one fixture does not by itself prove that level
is the cause of the additional misses.

Continuous production-policy results aggregate 78 passages and 510 expected
events:

| Metric | Direct v1 | Tone v2 | Tone delta |
| --- | ---: | ---: | ---: |
| Complete passages | 49 / 78 (62.8%) | 53 / 78 (67.9%) | +4 (+5.1 pp) |
| Raw complete evidence | 418 / 510 (82.0%) | 377 / 510 (73.9%) | −41 (−8.0 pp) |
| Independent matches | 330 / 510 (64.7%) | 329 / 510 (64.5%) | −1 (−0.2 pp) |
| Ordered advances | 331 / 510 (64.9%) | 355 / 510 (69.6%) | +24 (+4.7 pp) |
| All-sequence false advances | 8 | 1 | −7 |
| Safety-family false / skipped / duplicate | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

The per-speed comparison keeps passage completion, ordered advancement, and
latency adjacent:

| Interval | Complete passages, Direct / Tone | Ordered advances, Direct / Tone | P95 ordered latency, Direct / Tone |
| --- | ---: | ---: | ---: |
| 1000 ms | 8 / 13 · 9 / 13 | 66 / 85 · 63 / 85 | 220 ms · 228 ms |
| 500 ms | 9 / 13 · 9 / 13 | 73 / 85 · 70 / 85 | 208 ms · 224 ms |
| 333.33 ms | 7 / 13 · 9 / 13 | 43 / 85 · 56 / 85 | 228 ms · 228 ms |
| 250 ms | 9 / 13 · 10 / 13 | 53 / 85 · 63 / 85 | 214 ms · 234 ms |
| 167 ms | 7 / 13 · 8 / 13 | 45 / 85 · 52 / 85 | 221 ms · 228 ms |
| 125 ms | 9 / 13 · 8 / 13 | 51 / 85 · 51 / 85 | 231 ms · 234 ms |

Tone improves aggregate ordered progression and reduces cascading false
advances, particularly at 3–6 events/second, despite producing less raw complete
evidence and worse isolated chord accuracy. The next-onset-buffer experiment
remains rejected under both renderers: Direct lost five correct advances and one
complete passage while retaining eight false advances; Tone gained nothing and
retained one false advance.

These results must remain side by side rather than being combined into one score.
Direct v1 preserves the historical deterministic regression, while Tone v2 is a
separate app-graph robustness gate that the current preliminary matcher does not
yet pass. Neither result replaces acoustic-piano, microphone, room-noise, varied
velocity, or digital-piano trials.

### Paired legacy and app-playback renderers — August 15, 2026

The listening automation now runs each recognition benchmark twice and keeps the
results as adjacent configurations:

- `*-legacy` uses the unchanged `bundled-piano-web-audio-v1` renderer: direct
  sample mixing, its historical chord-gain curve, and a linear 350 ms release.
- `*-tone` uses `bundled-piano-tone-v2`. It shares the app's Tone.js sampler
  construction, velocity curve, exponential release, sampler volume, compressor,
  and limiter rather than duplicating those settings in benchmark code.

Both paths use the same bundled sample recordings, schedules, chunk alignment,
model, matcher, and acceptance criteria. Renderer identity is included in full and
summary JSON exports, so a result from one path cannot be mistaken for the other.
The historical renderer remains the default when the benchmark API is called
without an explicit renderer; `benchmark-renderer=tone` selects the app-playback
path on the benchmark page.

`listen-parity` intentionally remains legacy-only. Its sample-linearity and
additivity checks describe the direct mixer and are not valid after the app graph's
compressor and limiter. All recognition modes (`listen-accuracy`, sequence,
articulation, inference-reset, threshold, and retrigger) run the paired
configurations automatically. This entry records the harness change only; it does
not replace either renderer's measured baseline with unrecorded results.

### Score-rise retrigger replay — August 14, 2026

This benchmark-only experiment added an isolated score-rise detector beside the
trace-replay harness and replayed retained raw model scores/states. The production
`OnlineAmtOutputDecoder` contains no retrigger options or detector integration, and
`onlineAmtWorker.ts` remains unchanged. The experimental detector receives only
current/past model output, signal state, and decoder history; scheduled attacks and
score pitches are used only after decoding for evaluation.

The measured corpus contained 82 stateful traces: all 13 continuous sequence
families at six speeds (78 traces) plus detached, normal, legato, and
sustained-shared Course Clear articulation traces. Disabled replay reproduced every
captured onset, note event, active-confidence value, and timestamp exactly before
the sweep. The full automation export records `pcmHash`, byte length, frame count,
and reset mode for every trace. Articulation PCM identities from the full diagnostic
run were:

| Articulation | PCM hash | Bytes | Frames |
| --- | --- | ---: | ---: |
| Detached | `73a9e085` | 1,736,704 | 848 |
| Normal | `c7bc8914` | 1,736,704 | 848 |
| Legato | `c753ad3e` | 1,759,232 | 859 |
| Sustained shared | `2962fe17` | 1,736,704 | 848 |

The opportunity audit evaluated 1,318 scheduled pitch attacks. Expected transition
type came from acoustic-envelope overlap, while either observed `onset` or
`reOnset` counted as a physical attack.

| Audit classification | Pitch attacks |
| --- | ---: |
| Hidden rise under sustain | 2 |
| No event and no useful rise | 165 |
| Decoder event below matcher threshold | 40 |
| Decoder event blocked by matcher/carry-over/playhead state | 533 |
| Already recognized | 578 |

Both hidden opportunities were Course Clear attack 20, MIDI 65:

| Trace | Scheduled attack | Expected / observed | Peak attack probability | Local minimum | Maximum rise | Active confidence | Existing failure |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Continuous, 250 ms | 5,220 ms | `reOnset` / none | 0.35676 | 0.00000018 | 0.35676 | 0.99476 | `carry-over` |
| Legato articulation, 1000 ms | 20,220 ms | `onset` / none | 0.44633 | 0.00000008 | 0.44633 | 0.99979 | `carry-over` |

The fixed grid evaluated all 432 requested combinations. Exact synthetic-stream
memoization reduced downstream matcher replay to five unique event streams without
changing per-candidate decoding or physical/safety attribution. All 432 candidates
failed decoder safety; 351 also failed at least one matcher gate. No candidate was
eligible.

The highest-ranked diagnostic profile was
`p0p350-r0p300-a0p300-l3-f4` (peak 0.35, rise 0.30, re-arm 0.30,
3-frame lookback, 4-frame refractory). It recovered both hidden attacks at 156 ms
and 164 ms latency, respectively. Recoveries were confined to Course Clear (one at
250 ms and one in 1000 ms legato); repeated notes, repeated chords, shared bass,
and other shared-pitch families gained no missing physical attacks.

The same candidate emitted 24 synthetic events: 2 recoveries, 5 duplicates of
natural attacks, and 17 unassigned decoder false positives. The duplicate events
were:

| Trace | MIDI | Time | Attack probability | Assigned attack | Latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Carried-bass safety, 500 ms | 64 | 1,856 ms | 0.38536 | 3 | 136 ms |
| Carried-bass safety, 333⅓ ms | 60 | 1,024 ms | 0.39545 | 2 | 137.33 ms |
| Independent triads, 167 ms | 64 | 608 ms | 0.35265 | 2 | 54 ms |
| Course Clear, 167 ms | 60 | 2,048 ms | 0.49997 | 11 | -9 ms |
| Legato articulation | 76 | 7,360 ms | 0.49045 | 7 | 140 ms |

Every unassigned synthetic decoder event is listed below. Eight occurred during a
held-note window, eight during a release tail, and one was outside either envelope
category. These counts overlap neither the five duplicates nor the two recoveries.

| Trace | MIDI | Time | Attack probability | Safety classification |
| --- | ---: | ---: | ---: | --- |
| Weak chord, 333⅓ ms | 70 | 736 ms | 0.38858 | Release tail |
| Course Clear, 333⅓ ms | 75 | 5,056 ms | 0.45162 | Release tail |
| Course Clear, 333⅓ ms | 72 | 5,376 ms | 0.38991 | Release tail |
| Course Clear, 250 ms | 75 | 3,872 ms | 0.41414 | Held note |
| Rolled triads, 250 ms | 48 | 640 ms | 0.37886 | Held note |
| Course Clear, 167 ms | 52 | 704 ms | 0.47213 | Held note |
| Course Clear, 167 ms | 52 | 1,376 ms | 0.43618 | Release tail |
| Course Clear, 167 ms | 55 | 1,568 ms | 0.36049 | Release tail |
| Course Clear, 167 ms | 53 | 4,064 ms | 0.53490 | Release tail |
| Course Clear, 167 ms | 70 | 4,544 ms | 0.46838 | Unassigned, outside held/tail windows |
| Rolled triads, 167 ms | 62 | 736 ms | 0.44128 | Held note |
| Alternating C4/G4, 125 ms | 67 | 736 ms | 0.42250 | Held note |
| Course Clear, 125 ms | 63 | 1,856 ms | 0.37804 | Held note |
| Course Clear, 125 ms | 68 | 1,984 ms | 0.45648 | Held note |
| Rolled triads, 125 ms | 48 | 512 ms | 0.35446 | Held note |
| Legato articulation | 76 | 6,368 ms | 0.47694 | Release tail |
| Legato articulation | 68 | 14,368 ms | 0.38075 | Release tail |

No synthetic event occurred in the explicit legato-nonshared transition windows or
on the incomplete carried-bass pitch, and the incomplete carried-bass attack never
advanced. However, the held, release-tail, duplicate, and unassigned-event gates are
independently fatal.

Matcher replay for the diagnostic candidate nevertheless passed the matcher-only
gates under both requested profiles:

| Matcher profile | Independent | Ordered | Prefix | Complete | Retrigger failures | Bass-onset failures | Carry-over | Safety false / skip / duplicate / incomplete bass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Production baseline | 391 | 346 | 262 | 33 | 35 | 40 | 60 | 0 / 0 / 0 / 0 |
| Production + diagnostic decoder | 393 | 346 | 262 | 33 | 34 | 40 | 60 | 0 / 0 / 0 / 0 |
| Threshold recommendation baseline | 410 | 445 | 348 | 43 | 35 | 31 | 53 | 0 / 0 / 0 / 0 |
| Threshold recommendation + diagnostic decoder | 412 | 457 | 362 | 45 | 34 | 31 | 52 | 0 / 0 / 0 / 0 |

Production independent recognition at 1000 ms changed from 167 to 168; the
threshold recommendation changed from 171 to 172. Independent latency remained
188 ms p50 / 208 ms p95 under both profiles. Production ordered latency remained
189 ms p50 / 214.67 ms p95; recommended-profile ordered latency remained
190.67 ms p50 / 209.33 ms p95. Natural event streams and timestamps were unchanged.

Conclusion: `no-safe-separation`. Usable hidden score rises do exist, and one removes
a targeted `retrigger-not-detected` failure under both matcher profiles, but every
grid configuration that recovers a missing attack also manufactures decoder events.
The best diagnostic candidate creates 22 false/duplicate events to recover 2 attacks.
Production retrigger detection therefore remains disabled; matcher/carry-over work is
the safer next direction.

Verification on the clean local Vite server:

- Full unit suite passed: 227/227 tests.
- Production build passed.
- Full and concise `listen-retrigger-sweep` browser exports completed with identical
  audit counts, candidate ID, recovery count, safety counts, and conclusion.
- Existing sequence, 1,000-profile threshold, corrected articulation, and corrected
  reset browser regressions completed. Threshold replay reproduced
  `o0p450-t0p500-a0p200-x0p990-b1`; articulation reproduced `no-detached-benefit`;
  reset reproduced `matcher-playhead-cascade`; all established safety controls stayed
  at zero.

### Threshold replay sweep — August 13, 2026

The browser retained one stateful continuous trace for each of 13 sequence
families at all six configured speeds, including wrong-note, extra-note, and
carried-bass safety cases. The sweep varied five matcher properties:
`onsetThreshold`, `targetNoteThreshold`, `activeTargetThreshold`,
`extraNoteThreshold`, and `requireFreshBassOnset`; all timing and inference
settings remained fixed. Production-profile replay reproduced the captured
per-event and aggregate results exactly before the inference-free sweep ran.
The bounded grid evaluated all 1,000 profiles in about 150 seconds; 680 were
rejected by the safety gates.

| Profile | Independent | Ordered | Prefix total | Complete passages | Ordered p95 | Safety (false / skip / duplicate / carried bass) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Production `o0p600-t0p500-a0p350-x0p970-b1` | 291 | 283 | 199 | 33 | 214.67 ms | 0 / 0 / 0 / 0 |
| Recommended `o0p450-t0p500-a0p200-x0p990-b1` | 308 | 365 | 268 | 43 | 209.33 ms | 0 / 0 / 0 / 0 |

Explicit matcher settings:

| Setting | Production | Recommended |
| --- | ---: | ---: |
| `onsetThreshold` | 0.60 | 0.45 |
| `targetNoteThreshold` | 0.50 | 0.50 |
| `activeTargetThreshold` | 0.35 | 0.20 |
| `extraNoteThreshold` | 0.97 | 0.99 |
| `requireFreshBassOnset` | `true` | `true` |

Recommended-profile deltas from production by speed:

| Interval | Independent | Ordered | Prefix | Complete passages | Ordered p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1000 ms | +2 | +4 | +4 | 0 | -8 ms |
| 500 ms | +3 | +7 | +7 | +1 | 0 ms |
| 333⅓ ms | +7 | +39 | +39 | +5 | -13.33 ms |
| 250 ms | +4 | +19 | +19 | +1 | 0 ms |
| 167 ms | 0 | +8 | 0 | +2 | -7 ms |
| 125 ms | +1 | +5 | 0 | +1 | 0 ms |

The eligible Pareto frontier contains 15 profiles. All retain
`targetNoteThreshold=0.50` and `requireFreshBassOnset=true`; profile IDs encode
onset, target, active-target, extra-note, and fresh-bass values respectively.

| Frontier profile | Independent | Ordered | Prefix total | Complete | Ordered p95 | Distance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `o0p450-t0p500-a0p200-x0p990-b1` | 308 | 365 | 268 | 43 | 209.33 ms | 0.320 |
| `o0p450-t0p500-a0p275-x0p990-b1` | 307 | 362 | 265 | 42 | 209.33 ms | 0.245 |
| `o0p450-t0p500-a0p350-x0p990-b1` | 306 | 348 | 251 | 42 | 212 ms | 0.170 |
| `o0p500-t0p500-a0p275-x0p990-b1` | 305 | 354 | 257 | 40 | 212 ms | 0.195 |
| `o0p500-t0p500-a0p350-x0p990-b1` | 304 | 340 | 243 | 40 | 212 ms | 0.120 |
| `o0p550-t0p500-a0p275-x0p990-b1` | 302 | 345 | 252 | 36 | 212 ms | 0.145 |
| `o0p550-t0p500-a0p350-x0p990-b1` | 301 | 331 | 238 | 36 | 214 ms | 0.070 |
| `o0p450-t0p500-a0p200-x0p900-b1` | 300 | 333 | 250 | 38 | 209.33 ms | 0.370 |
| `o0p450-t0p500-a0p275-x0p900-b1` | 299 | 330 | 247 | 37 | 209.33 ms | 0.295 |
| `o0p600-t0p500-a0p350-x0p990-b1` | 299 | 308 | 215 | 35 | 214 ms | 0.020 |
| `o0p450-t0p500-a0p350-x0p900-b1` | 298 | 316 | 233 | 37 | 209.33 ms | 0.220 |
| `o0p500-t0p500-a0p275-x0p900-b1` | 297 | 322 | 239 | 35 | 209.33 ms | 0.245 |
| `o0p500-t0p500-a0p350-x0p900-b1` | 296 | 308 | 225 | 35 | 209.33 ms | 0.170 |
| `o0p550-t0p500-a0p275-x0p900-b1` | 294 | 316 | 236 | 33 | 209.33 ms | 0.195 |
| `o0p550-t0p500-a0p350-x0p900-b1` | 293 | 302 | 222 | 33 | 209.33 ms | 0.120 |

The recommendation is measurement-only. Production remains at onset 0.60,
target-note 0.50, active-target 0.35, extra-note 0.97, with fresh bass required.

### Stateful vs event-reset inference diagnostic — August 12, 2026

Implemented as a separate diagnostic benchmark in
`webapp/src/listenInferenceResetBenchmark.ts`. It renders the canonical normal-articulation
Course Clear passage exactly once (27 events, 1000 ms interval, 420 ms hold, 350 ms
release), then sends the same PCM object and 512-sample frame boundaries through:

- stateful continuous inference, with one initial session/decoder reset;
- event-reset continuous inference, with paired session/decoder resets before events 1–26;
- frame-phase-matched isolated one-event controls, reused only when both chord and
  position within the 512-sample frame match.

Reset points are aligned to the first frame beginning at or after scheduled attack minus
220 ms. The first normal-articulation reset begins at 1024 ms for the 1220 ms attack,
providing 196 ms of clean warm-up after the preceding 990 ms release-tail end. Every
trace records the reset plan, renderer diagnostics, PCM hash, and per-chunk hashes so
browser automation can verify that only the recurrent reset schedule differs.
Isolated controls use the reset point as local frame zero, so each attack has the same
4, 12, 20, or 28 ms offset within its attack frame as the corresponding continuous event.
Raw-model comparisons include scores, decoded states, and the model silence gate.

Verification results:

- `npm run build`: passed.
- `npm test`: 205 / 205 tests passed, including reset-plan, paired-input,
  reset-order, classification, and conclusion tests.
- Production listen mode and matcher behavior remain unchanged; this comparison is
  exposed only through the benchmark page button and the `listen-inference-reset` /
  `listen-inference-reset-summary` automation modes.

Measured browser run (August 13, 2026, `listen-inference-reset-summary`):

| Control | Independent match | Ordered advance | Safety (false / skip / duplicate) | Latency p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Isolated | 25 / 27 (92.6%) | 25 / 27 (92.6%) | 0 / 0 / 0 | — |
| Stateful continuous | 26 / 27 (96.3%) | 20 / 27 (74.1%) | 0 / 0 / 0 | 188 / 204 ms |
| Event-reset continuous | 25 / 27 (92.6%) | 20 / 27 (74.1%) | 0 / 0 / 0 | 188 / 204 ms |

The reset comparison recovered 0 events and lost 0 events; it recovered 2 raw
pitch qualifications and lost 0, while raw complete evidence stayed at 25 / 27
and fresh attacks stayed at 67 / 67. Independent matching changed by -1 event,
ordered advancement did not change, and no safety errors increased. The computed
conclusion is `matcher-playhead-cascade`: independent recognition was essentially
unchanged while ordered advancement remained behind it. Phase-matched isolated and
event-reset inference both produced 25 / 27 independent matches. The result’s run-local
PCM signature was `4747ade6` over 434,176 samples and 848 identical 512-sample chunks
between the two continuous passes.

The page exposes the complete captured conclusion as
`window.listenInferenceResetBenchmarkResult.conclusion` and retains the raw-model,
decoder-event, per-pitch, reset-plan, safety, latency, and isolated-control details
for subsequent runs.

### Course Clear articulation matrix — corrected August 13, 2026

Four independent continuous traces used the same 27 Course Clear targets and
1000 ms attack timestamps. The renderer, online-AMT session configuration, and
current matcher policy were fixed; only articulation scheduling changed. The onset
buffer experiment was not included.

| Articulation | Raw evidence | Fresh attacks | Independent match | Ordered advance | Complete | Stale sustain | Carry-over events | False / skip / duplicate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Detached, 250 ms hold | 23 / 27 (85.2%) | 65 / 69 (94.2%) | 25 / 27 (92.6%) | 20 / 27 (74.1%) | No | 0 | 1 | 0 / 0 / 0 |
| Normal, 420 ms hold | 25 / 27 (92.6%) | 67 / 69 (97.1%) | 26 / 27 (96.3%) | 20 / 27 (74.1%) | No | 0 | 1 | 0 / 0 / 0 |
| Legato, 900 ms hold | 26 / 27 (96.3%) | 68 / 69 (98.6%) | 24 / 27 (88.9%) | 3 / 27 (11.1%) | No | 8 | 24 | 0 / 0 / 0 |
| Sustained shared notes | 26 / 27 (96.3%) | 66 / 67 (98.5%) | 25 / 27 (92.6%) | 20 / 27 (74.1%) | No | 2 | 2 | 0 / 0 / 0 |

The a-priori substantial-improvement threshold was three additional
independent matches (3 / 27, 11.1 percentage points) without added safety
errors. Detached produced one fewer independent match than normal, two fewer
raw-evidence events, two fewer fresh attacks, no stale sustains in either profile,
and no change in ordered advancement. All 26 detached inter-attack gaps were
exactly 400 ms with measured RMS 0. Detached release isolation therefore did
not help, so stale sustain/release state is not the main Course Clear limitation
at 1000 ms. The articulation matrix does not by itself identify the remaining
cause; the later reset diagnostic attributes the independent-versus-ordered gap
to matcher/playhead cascade. Legato produced one more raw-evidence event than
normal but strongly increased carry-over and reduced ordered progress, while
sustained shared notes also added one raw-evidence event but lost one independent
match.

This corrected rerun determines the expected transition from acoustic envelope
overlap and accepts either an `onset` or `reOnset` decoder transition as evidence
of a physical attack, while retaining the expected and observed types separately.
Older raw-evidence baselines below retain the strict transition-matching semantics
used when they were recorded.

Browser renderer checks passed before the matrix: normal and the existing
Course Clear render differed by at most one Float32 ULP (`1.19e-7`), detached
gaps were silent, legato release tails overlapped the next attack, and the
sustained-shared new-note gain differed from the equivalent normal-chord
contribution by at most `5.96e-8`.

### Canonical renderer baseline — August 12, 2026

- Renderer: `bundled-piano-web-audio-v1`, 16 kHz mono, 512-sample chunks,
  420 ms default hold, 350 ms release, and no passage normalization.
- 104 / 106 correct bundled-sample trials advanced (98.1%).
- 52 / 54 correct score-derived “Course Clear” trials advanced (96.3%).
- Zero distinguishable wrong-note false advances; four mathematically
  ambiguous harmonic cases advanced and are reported separately.
- P95 rendered-onset-to-playhead-advance latency: 196 ms.
- Both misses were repetitions of `[53, 65, 74]`, where the model emitted no
  evidence for MIDI 65. Matcher calibration cannot recover a pitch absent from
  the model output without weakening exact-chord behavior.

Isolated/continuous rendering parity in Chrome (August 12, 2026):

- Isolated and one-event continuous PCM are sample-for-sample identical.
- The online-AMT scores, states, signal-active state, decoded evidence/events,
  matcher result, and advancement latency match frame-for-frame.
- Adding a later loud event leaves every preceding sample unchanged.
- Rolled, repeated, sustained, and chunk-alignment checks pass. Comparisons
  between different-length OfflineAudioContext graphs allow at most `1e-6`;
  observed differences were zero or one Float32 ULP.

Trace-level 12-passage baseline (August 12, 2026):

| Interval | Complete passages | Raw evidence | Independent match | Succeeded / total | Ordered advance | Blocked | Ordered p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 ms | 7 / 12 (58.3%) | 69 / 82 (84.1%) | 73 / 82 (89.0%) | 63 / 82 | 76.8% | 10 | 212 ms |
| 500 ms | 8 / 12 (66.7%) | 63 / 82 (76.8%) | 74 / 82 (90.2%) | 70 / 82 | 85.4% | 4 | 204 ms |
| 333⅓ ms | 6 / 12 (50.0%) | 57 / 82 (69.5%) | 72 / 82 (87.8%) | 40 / 82 | 48.8% | 32 | 220 ms |
| 250 ms | 8 / 12 (66.7%) | 48 / 82 (58.5%) | 73 / 82 (89.0%) | 50 / 82 | 61.0% | 23 | 208 ms |
| 167 ms | 6 / 12 (50.0%) | 37 / 82 (45.1%) | 11 / 82 (13.4%) | 42 / 82 | 51.2% | 5 | 214 ms |
| 125 ms | 8 / 12 (66.7%) | 6 / 82 (7.3%) | 16 / 82 (19.5%) | 48 / 82 | 58.5% | 4 | 228 ms |

The dominant failure is `next-attack-before-advance`; the sharpest completion
drop is from 2 to 3 events/second. Raw and independent metrics are identical for
the current and buffered policies because both replay the same captured traces.
The buffered policy is not accepted: it produced five fewer correct advances,
one fewer complete passage, and eight aggregate false advances. The deliberate
wrong-note and extra-note safety families themselves had zero false, skipped,
or duplicate advances under both policies at every speed.

### Pre-canonical renderer baseline — August 12, 2026

This is the previous committed baseline from `2da08d8`. It predates the shared
canonical renderer and records only Course Clear at the 1000 ms interval for
the continuous benchmark.

- 104 / 106 correct bundled-sample trials advanced (98.1%).
- 52 / 54 correct score-derived “Course Clear” trials advanced (96.3%).
- Zero distinguishable wrong-note false advances; four mathematically
  ambiguous harmonic cases advanced and were reported separately.
- P95 rendered-onset-to-playhead-advance latency: 260 ms.
- Both misses were repetitions of `[53, 65, 74]`, where the model emitted no
  evidence for MIDI 65. Matcher calibration could not recover a pitch absent
  from the model output without weakening exact-chord behavior.

| Interval | Raw complete evidence | Threshold-qualified | Independent match | Succeeded / total | Ordered advance | Recognized but blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 ms | 20 / 27 (74.1%) | 19 / 27 (70.4%) | 24 / 27 (88.9%) | 12 / 27 | 44.4% | 12 |

The first causal stall was zero-based event index 12: measure 2, moment 5,
target `[51, 63, 72]`. MIDI 51 and 72 produced fresh, high-confidence onsets,
but MIDI 63 produced only active-note evidence and no fresh onset. Independent
replay therefore classified the event as `carry-over`; ordered playback never
advanced before the following attack. Twelve later events matched independently
but remained blocked behind this target. The raw and independent metrics were
identical for the current and buffered policies, confirming that both policies
replayed the same model trace. No model threshold or production matcher behavior
was changed for this diagnostic baseline.

These are deterministic digital fixtures rendered from the app's bundled piano
samples. They demonstrate runtime equivalence and provide a regression gate;
they are not a substitute for acoustic-piano, microphone, room-noise, and
digital-piano input trials. Keep the current preliminary matcher profile unless
those trials show a systematic error.

## Running the benchmarks

Except for `listen-parity`, each listening command below runs the legacy renderer
first and the Tone renderer second, emitting adjacent `*-legacy` and `*-tone`
entries. Start the benchmark development server first, then run any desired mode
from another terminal.

```powershell
npm --prefix webapp run dev:wasm-benchmark

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-smoke

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-accuracy

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-parity

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-articulation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-articulation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-inference-reset

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-inference-reset-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-threshold-sweep

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-retrigger-sweep

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-retrigger-sweep-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-constant

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-mixed
```

See the [piano dynamics benchmark](PIANO_DYNAMICS_BENCHMARK.md) for the
velocity-layer methodology, asset smoke checks, and measured 40-run matrix.
