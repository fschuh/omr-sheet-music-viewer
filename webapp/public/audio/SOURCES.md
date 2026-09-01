# Piano sample sources

## Splendid Grand Piano

The tracked `splendid-grand-piano` directory contains four public-domain
velocity layers (`pp`, `mp`, `mf`, and `ff`) from AKAI's Splendid Grand Piano.
The browser-format source is the
[sfzinstruments Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano)
release. Its filename pitch labels sound one octave higher than written, so the
registry applies a +12-semitone concert-pitch correction.

## Salamander Grand Piano

The gitignored `salamander-grand-piano` directory is generated from the 16
locked `@audio-samples/piano-velocityN@1.0.5` packages, published from
[darosh/samples-piano](https://github.com/darosh/samples-piano), which packages
the library as browser-ready OGG. Salamander Grand Piano V3 is by Alexander Holm
and licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); the original release
is on [archive.org](https://archive.org/details/SalamanderGrandPianoV3), and
[sfzinstruments/SalamanderGrandPiano](https://github.com/sfzinstruments/SalamanderGrandPiano)
publishes the same library, as it does for Splendid above — a reference for the
instrument rather than the source of these files. Run
`npm run prepare:piano-assets` in `webapp` to prepare its 480 browser files.
Sharp signs are changed from `#` to `s` in generated URLs.

The app's semantic default is always `mp`. For Salamander, recorded layer
`v07` is the documented equivalent because it is nearest to conventional MIDI
velocity 54 in the evenly spaced 16-layer set.
