# Spectral listen-mode benchmark

Run on 2026-07-21 in headless Chrome against the bundled piano samples.

| Metric | Result | Acceptance |
| --- | ---: | ---: |
| Correct-trial advancement | 106 / 106 (100%) | at least 95% |
| Course Clear advancement | 54 / 54 (100%) | at least 95% |
| Distinguishable wrong-trial false advances | 0 / 20 | 0 |
| Mathematically ambiguous advances | 7 / 8 | reported limitation |
| p95 onset-to-advance latency | 279.3 ms | below 400 ms |
| Spectrum analysis duration | approximately 1–3 ms per frame | diagnostic |

The score-derived suite contains every one of the 27 pitched playback moments
from `Super Mario Bros - Course Clear`, extracted from cache key
`13b74407b0870ee53fd027779fab7caf531663830cc6fa9528c733f8c59d99c0`. It spans
25 distinct pitches from C3 through C6 and runs each moment twice. All 54 trials
advanced. Eighteen additional score cases omit the bass from a three-note target;
all eighteen were rejected, including E5/G4 played for E5/G4/G3.

The wrong-note suite explicitly separates physically distinguishable errors from
upper-note/harmonic ties. The latter include cases such as a played octave versus
the second partial, and equal-tempered G4 versus C3's nearly coincident third
partial. A magnitude spectrum without an instrument profile cannot identify which
source produced the shared bins, so listen mode deliberately favors the score in
those ties and the benchmark reports them outside the zero-false-advance gate.
This limitation is not applied to omitted bass notes: an upper note cannot create
the missing lower fundamental, and those cases remain mandatory rejections.

The expanded acceptance gate **passed**: both correct-trial rates exceeded 95%,
all distinguishable wrong trials were rejected, and p95 latency remained below
400 ms. Exact upper-harmonic outcomes remain visible rather than being silently
included as successful wrong-note rejection.

This is a deterministic rendered-sample result, not a substitute for the manual
acoustic- and digital-piano trials exposed by the benchmark page.
