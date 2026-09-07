# Piano transcription engine extraction report

> **Status:** Complete, September 7, 2026. Every automated check passed on
> September 6, and the manual listen-mode smoke was run on a real piano on
> Windows on September 7. Round 3 planning is unblocked.
>
> **Plan:** [piano-transcription-engine-repository-extraction-plan.md](piano-transcription-engine-repository-extraction-plan.md)
> **Baseline:** [piano-transcription-engine-task-01-baseline.md](piano-transcription-engine-task-01-baseline.md)

The listen engine left this repository. What remains here is the application:
listen-mode orchestration, score navigation and the playhead, settings and
persistence, feedback rendering, the MIDI input adapter, and a thin worker entry.

## What this repository still supplies

The engine deliberately resolves nothing on its consumer's behalf, so three
things are viewer code and stay viewer code:

- `listenRecognizer.ts` gives the recognizer its model and worklet URLs, builds
  the Vite worker, and words microphone permission and device failures. The
  engine reports the underlying error; the phrasing a person reads is ours.
- `onlineAmtWasm.ts` resolves ONNX Runtime's WASM binary from this application's
  own dependency copy. npm hoists `onnxruntime-web` above the installed engine,
  so no path relative to the package can find it.
- `onlineAmtWorker.ts` receives the recognizer's initialize message and creates
  the session, adding the WASM source the message does not carry.

`prepare:listen-assets` copies the canonical model, its MIT notice, and the
capture worklet out of the installed package into
`webapp/public/generated-listen-assets/`, which this repository ignores.
`predev` and `prebuild` run it, so no command needs an extra step. The
Diagnostics panel names the engine version and revision the running build was
made against.

## Identification

| | |
| --- | --- |
| Engine commit adopted | `cd485c67b4f08c3e3cce5804a950367af73b866c` |
| Viewer commit that adopted it | `3a5873db90a0ba98f76d540ba8a774ce80946422` |
| Pre-extraction baseline | `89afafcdd7fd06db0626feba6a0665ab1c3bf798` |
| Production model | `online_amt_streaming.onnx`, 71,955,821 bytes, SHA-256 `a77be826…90ac4` |
| Production default profile | `baseline-v1` in registry version 2 |

The dependency is one exact Git revision in `webapp/package.json`. Nothing
follows a branch or a tag, and the model is no longer committed here.

## What was archived rather than ported

The benchmark page, its query-string route, the extra HTML entries, the browser
benchmark driver, the Round 1/2 search and decision modules, their emitters, and
the evidence verifier were removed rather than moved. Their conclusions are
archived in the engine under `legacy/rounds-1-2/`, and the full implementation
remains at the baseline commit above.

The frozen reports and result files stay here, because their score-bearing detail
cannot be redistributed: `tools/online_amt/` keeps the three Round 1/2 benchmark
reports and `benchmark-results/` keeps its result JSON. Each carries a dated note
saying the code it describes was removed and naming the commit that still runs
it. No recorded command or measurement inside them was rewritten.

The three fixtures derived from the copyrighted Course Clear score moved to
private `piano-transcription-evals` under `fixtures/rounds-1-2/`. They are not in
this repository's working tree and must not return to it or to the engine.

## Platform coverage

The manual smoke ran on Windows and found the extraction's only platform defect:
the engine's package verifier compared Windows path separators against a POSIX
literal, so its canonical-model check failed inside `prepare` and `npm install`
here could not complete. Engine commit `1cb9baa` fixed it, and a follow-up audit
closed a second hazard of the same family: neither the engine nor the private
eval repository declared checkout attributes, so a Windows install of the engine
would have delivered a CRLF capture worklet and licence notice whose SHA-256
digests no longer matched the frozen baseline, and this repository would have
copied that worklet into the application. Both now declare them.

Neither repository runs automated checks on Windows, so a defect of that kind
still reaches a person before it reaches a check; run an install and a build
there when either repository's tooling changes how it handles paths or how its
files are stored.

## What must pass before a later engine revision is adopted

Change the one revision in `webapp/package.json`, then:

```bash
npm --prefix webapp ci
npm --prefix webapp test
npm --prefix webapp run build
```

The engine's own `npm test` and `npm run eval:browser-parity` must pass at that
revision first; its `EXTRACTION.md` lists them. Then run the manual listen-mode
smoke on real input — start, target changes, advancement, pause, resume, stop,
and microphone denial. No automated check in either repository replaces it, and
it remains required before the production matcher profile changes.
