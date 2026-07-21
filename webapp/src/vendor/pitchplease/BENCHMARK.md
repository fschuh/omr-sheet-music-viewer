# Spectral listen-mode benchmark

Run on 2026-07-21 in headless Chrome against the bundled piano samples.

| Metric | Result | Acceptance |
| --- | ---: | ---: |
| Correct-trial advancement | 22 / 40 (55.0%) | at least 95% |
| Wrong-trial false advances | 0 / 5 | 0 |
| p95 onset-to-advance latency | 396.3 ms | below 400 ms |
| Spectrum analysis duration | approximately 1–2 ms per frame | diagnostic |

The isolated-note set now covers C3, G3, C4, E4, and G4. All C3, G3, C4, and E4
repetitions advanced, as did all C3/C4 octave-pair repetitions. G4 was consistently
rejected because its rendered sample still produced confident extra partials.
Larger chords remain inconsistent or fail because at least one required pitch is
missed. The added target-plus-octave wrong trial did not advance. The acceptance
gate therefore **did not pass**; its thresholds were not relaxed.

This is a deterministic rendered-sample result, not a substitute for the manual
acoustic- and digital-piano trials exposed by the benchmark page.
