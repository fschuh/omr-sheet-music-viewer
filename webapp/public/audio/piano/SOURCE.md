# Splendid Grand Piano samples

This directory contains the `Mp` (medium-dynamics) OGG layer of **Splendid
Grand Piano**, a sampled Steinway piano released into the public domain by
AKAI.

- Original sample library: https://github.com/sfzinstruments/SplendidGrandPiano
- Browser-format conversion: https://github.com/danigb/samples/tree/main/audio/splendid-grand-piano
- License: Public Domain

The app loads the nearest available sampled key and adjusts its playback rate
for pitches between sample roots. Each note in a chord uses an independent Web
Audio source, so simultaneous recognized notes remain polyphonic.

Sharp filenames use `s` (for example, `Mp-Gs2.ogg`) because `#` is reserved as
the URL fragment delimiter and is not portable in browser asset paths.
