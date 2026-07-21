# PitchPlease algorithm provenance

`webapp/src/spectralPitchDetector.ts` adapts the peak detection and harmonic-sieve
design from PitchPlease 2.0.0:

- Project: https://github.com/markusstrasser/pitchplease
- Source reviewed: `pitchplease.js` on the upstream `master` branch
- Package: `@markusstrasser/pitchplease` 2.0.0
- License: MIT (reproduced in `LICENSE`)
- Reviewed: 2026-07-21

The adaptation expands the analyzed range to MIDI 21–108, bounds noisy peak
inputs by strength rather than frequency, retains octave-aware fundamental MIDI
values, and adds per-note positive spectral-flux attack detection. It does not
use PitchPlease's pitch-class chord naming; exact score matching remains in the
application's independent chord matcher.

No model, microphone recording, or remote service is bundled or used.
