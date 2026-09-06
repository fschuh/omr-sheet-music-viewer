# online_amt model

The canonical `online_amt_streaming.onnx` export and its MIT notice belong to
[`@fschuh/piano-transcription-engine`](https://github.com/fschuh/piano-transcription-engine).
`npm run prepare:listen-assets` copies them out of the installed package into
`public/generated-listen-assets/`, which this repository ignores. Export and
validation instructions live in the engine's `tools/online_amt/README.md`.

`online_amt_fixture/` stays here for the browser runtime benchmark page. It is
deterministic synthesized data, not a recording.
