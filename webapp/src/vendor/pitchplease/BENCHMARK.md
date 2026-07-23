# Spectral listen-mode benchmark

Run on 2026-07-21 in headless Chrome against the bundled piano samples.

| Metric | Result | Acceptance |
| --- | ---: | ---: |
| Correct-trial advancement | 48 / 52 (92.3%) | at least 95% |
| Wrong-trial false advances | 1 / 10 | 0 |
| p95 onset-to-advance latency | 379.6 ms | below 400 ms |
| Spectrum analysis duration | approximately 1–3 ms per frame | diagnostic |

The isolated-note set covers C3, G3, C4, E4, and G4. All repetitions except G4
advanced. Target-aware scoring and stable post-attack evidence advanced every
tested two-to-six-note correct chord, including E3/C4, G3/E4, C3/C4, and the
reported C3/C4/G4 case.

The expanded wrong-chord set retained real octave, third-harmonic, rational-interval,
wrong-note, and missing-note cases. Nine of ten were correctly rejected. Playing
only C3/C4 falsely advanced the C3/C4/G4 target because G4 is exactly C3's third
harmonic; without a timbre model those spectra can be ambiguous. The acceptance
gate therefore **did not pass**, despite crossing the separate 85% correct-trial
goal. The success, latency, and extra-note thresholds were not weakened.

This is a deterministic rendered-sample result, not a substitute for the manual
acoustic- and digital-piano trials exposed by the benchmark page.
