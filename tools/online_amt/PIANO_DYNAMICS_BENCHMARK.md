# Piano dynamics benchmark

Measured on August 16, 2026 in headless Chrome on the development Windows
machine. This benchmark compares the historical direct Web Audio renderer with
the app's Tone.js path across every bundled acoustic velocity layer.

## Method

- Fixture: the existing normal-articulation Course Clear passage, 27 physical
  attacks at 1000 ms, 420 ms hold, 350 ms release, 16 kHz mono, 512-sample
  chunks, and no passage normalization.
- Renderers: `bundled-piano-web-audio-v1` (legacy) and
  `bundled-piano-tone-v2` (Tone). Both resolve samples through the shared piano
  registry; Tone routes every layer sampler through one compressor and limiter.
- Libraries: Splendid Grand Piano's public-domain sfzinstruments release and
  Salamander Grand Piano from locked `@audio-samples/piano-velocity1..16`
  version 1.0.5 packages.
- Constant suite: four Splendid layers plus 16 Salamander layers under both
  renderers, producing 40 runs. Every run renders one continuous passage and
  records renderer, piano, layer, library version, peak, RMS, PCM signature,
  recognition summary, latency, and safety counters.
- Mixed suite: one uninterrupted crescendo-decrescendo trace per piano and
  renderer. Splendid distributes its four layers across the passage.
  Salamander visits `v01` through `v16` in order, then descends monotonically
  to `v01` over the 11 remaining attacks. Recognition state is never reset
  between physical attacks.
- Acoustic layer and chord mix gain are independent. All notes in one chord use
  the same layer; chord size only changes the existing summing gain.
- Cross-piano rates are the mean of the two piano rates, so Salamander's 16
  layers do not outweigh Splendid's four. Counts remain raw totals.

`Complete` below means the ordered matcher completed all 27 attacks. `Safety`
is false/skipped/duplicate advances, and `P95` is independent/ordered latency in
milliseconds. Hashes are FNV-1a signatures of the complete Float32 PCM bytes.

## Constant-layer results

### Piano summaries

| Renderer | Piano | Ordered | Independent | Complete | Misses | Safety | P95 | Peak | RMS | Worst layer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Legacy | Splendid | 85/108 (78.7%) | 99/108 (91.7%) | 1/4 | 23 | 0/0/0 | 204/204 | 0.9461 | 0.11430 | `ff` |
| Legacy | Salamander | 53/432 (12.3%) | 389/432 (90.0%) | 0/16 | 379 | 0/0/0 | 212/212 | 0.6815 | 0.04210 | `v06` |
| Tone | Splendid | 55/108 (50.9%) | 93/108 (86.1%) | 0/4 | 53 | 0/0/0 | 220/220 | 0.6085 | 0.08779 | `ff` |
| Tone | Salamander | 131/432 (30.3%) | 399/432 (92.4%) | 1/16 | 300 | 1/0/0 | 228/228 | 0.6312 | 0.05832 | `v15` |
| Legacy | Equal-piano aggregate | 45.5% | 90.9% | 12.5% | 402 | 0/0/0 | 212/212 | 0.9461 | 0.05654 | `v06` |
| Tone | Equal-piano aggregate | 40.6% | 89.2% | 3.1% | 353 | 1/0/0 | 228/228 | 0.6312 | 0.06421 | `ff` |

The one safety event is deterministic in the measured reruns and belongs to
Tone + Salamander `v05`. It is reported as a false advancement rather than
folded into accuracy. There were no skipped or duplicate advances, and the
carried-bass matcher configuration was unchanged. The low completion rates are
mostly cascade loss after an early ordered stall: independent pitch evidence
remains near 90% even where later correct recognitions cannot advance the
ordered playhead.

### Splendid layers

| Renderer | Layer | Independent | Ordered | Complete | Miss | Safety | P95 | Peak/RMS | PCM hash |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Legacy | `pp` | 25/27 | 20/27 | No | 7 | 0/0/0 | 204/204 | 0.9380/0.12084 | `582021be` |
| Legacy | `mp` | 26/27 | 20/27 | No | 7 | 0/0/0 | 204/204 | 0.8636/0.11461 | `67967953` |
| Legacy | `mf` | 27/27 | 27/27 | Yes | 0 | 0/0/0 | 204/204 | 0.9461/0.11360 | `0fb70d45` |
| Legacy | `ff` | 21/27 | 18/27 | No | 9 | 0/0/0 | 212/220 | 0.8045/0.10815 | `0b7f6f8f` |
| Tone | `pp` | 24/27 | 20/27 | No | 7 | 0/0/0 | 220/220 | 0.5626/0.09149 | `844c7c3c` |
| Tone | `mp` | 23/27 | 13/27 | No | 14 | 0/0/0 | 236/220 | 0.6085/0.08719 | `2db6e4c7` |
| Tone | `mf` | 26/27 | 19/27 | No | 8 | 0/0/0 | 220/220 | 0.5931/0.08741 | `5160b193` |
| Tone | `ff` | 20/27 | 3/27 | No | 24 | 0/0/0 | 220/220 | 0.5357/0.08505 | `dd0434d7` |

### Salamander layers

| Layer | Legacy independent/ordered | Legacy miss | Legacy P95 | Legacy peak/RMS | Legacy hash | Tone independent/ordered | Tone miss | Tone safety | Tone P95 | Tone peak/RMS | Tone hash |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `v01` | 24/5 | 22 | 212/212 | 0.0864/0.00983 | `842ec358` | 24/4 | 23 | 0/0/0 | 228/220 | 0.1503/0.01663 | `4bbd15b3` |
| `v02` | 21/4 | 23 | 212/212 | 0.1356/0.01500 | `1c4dc1ef` | 26/3 | 24 | 0/0/0 | 228/220 | 0.2289/0.02547 | `f3a8a5d2` |
| `v03` | 23/3 | 24 | 212/212 | 0.1629/0.01956 | `f5d7ba10` | 26/13 | 14 | 0/0/0 | 228/228 | 0.2660/0.03286 | `4b2d55ad` |
| `v04` | 23/3 | 24 | 212/212 | 0.1986/0.02403 | `553c25e9` | 26/13 | 14 | 0/0/0 | 228/228 | 0.3058/0.03981 | `ea395035` |
| `v05` | 23/3 | 24 | 212/212 | 0.2470/0.02679 | `7ea527d5` | 25/23 | 3 | 1/0/0 | 228/228 | 0.3653/0.04367 | `aadb4ce2` |
| `v06` | 22/3 | 24 | 212/212 | 0.2621/0.02973 | `2de25c39` | 24/3 | 24 | 0/0/0 | 228/220 | 0.3803/0.04808 | `7fefb958` |
| `v07` | 25/3 | 24 | 212/212 | 0.2984/0.03291 | `2c97ae4b` | 25/3 | 24 | 0/0/0 | 228/220 | 0.4122/0.05214 | `6326665a` |
| `v08` | 26/3 | 24 | 212/212 | 0.2869/0.03692 | `2d292ef5` | 25/3 | 24 | 0/0/0 | 228/220 | 0.3972/0.05786 | `3a516714` |
| `v09` | 26/3 | 24 | 220/212 | 0.3483/0.03908 | `c2d3df26` | 26/3 | 24 | 0/0/0 | 228/220 | 0.4772/0.05975 | `81cea899` |
| `v10` | 24/3 | 24 | 212/212 | 0.3536/0.04473 | `dad990c8` | 23/13 | 14 | 0/0/0 | 228/228 | 0.4609/0.06631 | `87d53622` |
| `v11` | 26/3 | 24 | 212/212 | 0.4178/0.04852 | `056f8540` | 26/3 | 24 | 0/0/0 | 228/220 | 0.4718/0.06919 | `e42c81f8` |
| `v12` | 25/3 | 24 | 212/212 | 0.4534/0.05330 | `0b3361a9` | 27/27 | 0 | 0/0/0 | 228/228 | 0.5294/0.07340 | `270bc770` |
| `v13` | 26/5 | 22 | 212/212 | 0.4836/0.05674 | `66dc8682` | 23/8 | 19 | 0/0/0 | 228/228 | 0.4916/0.07521 | `998cdcd8` |
| `v14` | 25/3 | 24 | 212/212 | 0.5900/0.07073 | `9209cba9` | 25/4 | 23 | 0/0/0 | 228/220 | 0.5535/0.08663 | `cc7e946b` |
| `v15` | 25/3 | 24 | 212/212 | 0.6815/0.07956 | `2b13919d` | 23/3 | 24 | 0/0/0 | 228/220 | 0.6312/0.09182 | `30c19ba5` |
| `v16` | 25/3 | 24 | 220/212 | 0.6705/0.08614 | `ac07579e` | 25/5 | 22 | 0/0/0 | 228/228 | 0.5779/0.09431 | `a66f2357` |

Only Tone `v12` completed the Salamander passage. All 16 PCM signatures are
distinct under each renderer, including adjacent layers with similar peaks.

## Mixed-dynamics results

| Renderer | Piano | Independent | Ordered | Complete | Miss | Safety | P95 | Peak/RMS | PCM hash |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Legacy | Splendid | 26/27 | 20/27 | No | 7 | 0/0/0 | 204/204 | 0.8177/0.11252 | `203a0871` |
| Legacy | Salamander | 25/27 | 3/27 | No | 24 | 0/0/0 | 212/212 | 0.5959/0.04354 | `f6e37358` |
| Tone | Splendid | 24/27 | 13/27 | No | 14 | 0/0/0 | 220/220 | 0.5931/0.08742 | `89a91a3f` |
| Tone | Salamander | 25/27 | 4/27 | No | 23 | 0/0/0 | 228/220 | 0.4906/0.05923 | `d84432ba` |
| Legacy | Equal-piano aggregate | 94.4% | 42.6% | 0% | 31 | 0/0/0 | 212/212 | 0.8177/0.07803 | — |
| Tone | Equal-piano aggregate | 90.7% | 31.5% | 0% | 37 | 0/0/0 | 228/220 | 0.5931/0.07333 | — |

All four mixed runs used one continuous recognition trace and kept the
production matcher configuration. The all-layer Salamander assignment was:

```text
v01 v02 v03 v04 v05 v06 v07 v08 v09 v10 v11 v12 v13 v14 v15 v16
v15 v13 v12 v11 v09 v08 v06 v05 v04 v02 v01
```

## Regression and smoke checks

- Asset preparation validated 16 locked packages, 30 roots per layer, 480
  non-empty generated files, deterministic browser names, and an idempotent
  marker. Generated Salamander audio remains ignored by Git.
- Splendid `mp`, Salamander `v01`, and Salamander `v16` loaded and produced
  finite, non-silent PCM under both renderers.
- The existing canonical Splendid `mp` smoke result is unchanged: legacy peak
  0.603168, RMS 0.100907, 196 ms; Tone peak 0.432499, RMS 0.078035, 196 ms.
- The dedicated parity suite passed all checks. The new dynamics runs do not
  change target pitches, carried-bass rules, articulation, timing, or matcher
  thresholds.

## Running

Start the benchmark server, then run either paired suite:

```powershell
npm --prefix webapp run dev:wasm-benchmark

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-smoke

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-constant

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-mixed
```

For a focused rerun, append `-legacy` or `-tone` to either dynamics suite name.
The benchmark page also exposes manual controls and the automatic query
parameters `listen-dynamics-constant=auto` and `listen-dynamics-mixed=auto`.
