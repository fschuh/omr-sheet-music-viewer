# Historical listen benchmarks

Round 1/2 harnesses, artifact emitters, manifests, verifiers, and completed-branch
simulations are non-active historical code and no longer run by `npm test`.
Historical policy tests in the parent listen directory and
`tools/online_amt/verify_listen_benchmark_evidence*` have the same status.
The browser benchmark entry remains for reference until extraction cleanup;
it is not an active evaluation gate.

Final outcomes and provenance live in
[fschuh/piano-transcription-engine](https://github.com/fschuh/piano-transcription-engine)
under `legacy/rounds-1-2/README.md`.
The full original implementation is preserved at viewer commit
`89afafcdd7fd06db0626feba6a0665ab1c3bf798`; use that checkout for historical commands.

Active functional evaluation belongs to the engine's public `/eval` API and
discovery-based tests. Production matcher and viewer integration tests remain
active during the Task 09 package cutover.
