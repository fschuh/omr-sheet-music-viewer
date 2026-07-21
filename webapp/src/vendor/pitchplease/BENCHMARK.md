# Spectral listen-mode benchmark

Run on 2026-07-21 in headless Chrome against the bundled piano samples.

| Metric | Result | Acceptance |
| --- | ---: | ---: |
| Correct-trial advancement | 12 / 24 (50.0%) | at least 95% |
| Wrong-trial false advances | 0 / 4 | 0 |
| p95 onset-to-advance latency | 262.9 ms | below 400 ms |
| Spectrum analysis duration | approximately 1–2 ms per frame | diagnostic |

All four isolated-note, octave-pair, and three-note-chord repetitions advanced.
The four-, five-, and six-note fixtures missed at least one required pitch and did
not advance. The acceptance gate therefore **did not pass**. These thresholds were
not relaxed after replacing Basic Pitch.

This is a deterministic rendered-sample result, not a substitute for the manual
acoustic- and digital-piano trials exposed by the benchmark page.
