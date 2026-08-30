# Exact recorded reproduction inputs and commands

Prereplay commit: `9e6c5e2394d5d36df42529d74d1dd21301ddeab6`.
Repo executable-looking captures are inert `.data`/`.patch-data`, never TS test
discovery inputs. Do not execute the dormant historical snapshot scripts; they
remain reference-only. Actual executable copies exist only in the task TMP below.

Prerequisites are the exact read-only S1 candidate and local tool tree authenticated
in `artifacts/authentication-before.json`, `artifacts/tool-manifest.json` and
`artifacts/import-closure-proof.json`. Candidate:
`/tmp/safe-bash-owned-output-streaming-execution-restore-J93UJO/candidate`.
Task executables:
`/tmp/safe-bash-owned-output-streaming-fixture-replay-mcBOK1` (Node canonicalizes
that prefix to `/private/tmp/`). No installation or live-source fallback is valid.

Exact recorded acceptance and separate original-five invocations:

```sh
TMPDIR=/tmp/safe-bash-owned-output-streaming-fixture-replay-mcBOK1/tmp TSX_DISABLE_CACHE=1 node /tmp/safe-bash-owned-output-streaming-fixture-replay-mcBOK1/run.mjs acceptance
TMPDIR=/tmp/safe-bash-owned-output-streaming-fixture-replay-mcBOK1/tmp TSX_DISABLE_CACHE=1 node /tmp/safe-bash-owned-output-streaming-fixture-replay-mcBOK1/run.mjs history
```

The runner supplies task TMP/TEMP/TSX_CACHE_DIR before any tsx import; the driver
supplies the same environment to each child. The driver loops through the exact
20-row binding map or original5, with unchanged1200ms inner and3000ms/1MiB
record bounds. Raw argv/environment/PIDs/exits are in `round1/*.process.json` and
`round1/{acceptance,historical-five}.result.json`; individual stdout/stderr also
have separate inert captures. Qualification uses the same runner's `qualify`
mode and does not execute the first-read probe.

These are recorded commands, not permission to overwrite the sealed run:
`run.mjs` intentionally rejects a second execution with an existing process
record. An authorized future repetition must materialize NEW task-prefixed TMP,
restore exact historical `.data` bytes, and rebind only task locations/hashes in
the archived config/source-manifest/root authorization. Keep the SAME compiled
candidate mapping (or separately authorized authenticated reconstruction), all
criteria/profiles/assertions and bounds. Recompute module proof and prereplay
seal before replay. `prepare.mjs.data` and `qualify.mjs.data` record restoration
and graph qualification; `freeze.mjs.data` records exact config construction and
hash bindings. Its archival destination is THIS evidence directory, so do not
run that historical archival step against these sealed files. Use a fresh
authorized evidence destination instead. The complete fixture/config deltas
are `artifacts/*-fixture-delta.patch-data`.

No claimed fresh57+9, native, deployed-provider, release or whole-suite result
can be reproduced from this cohort because none was run. Their preserved prior
results are references only. The remaining three strict profiles must not be
filled from observed output to turn the cohort green.
