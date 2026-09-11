# Issue 723: standard ZIP flags

## Scope

Implement `zip -q` and `unzip -p` within the existing archive commands. Preserve
ZIP publication ownership and bounded codec/filesystem helpers. No safe-fs changes,
README edits, package dependencies or new command registrations. Root owns Git,
test-inventory registration, push and release delivery; issue 724 remains separate.

## Approach and verification

1. Inspect current argument parsers and reproduce unsupported flags before changing
   product code. Initial in-memory suite: 36 cases, 31 failures before implementation;
   five existing limit-rejection assertions already passed. Dependency/bootstrap and
   sandbox subprocess failures are not counted as product reproduction evidence.
2. Compare native Info-ZIP 3.0 and UnZip 6.00 with a fixed C locale, UTC timezone,
   fixed fixture timestamps, bounded subprocess output and unique cleaned-up oracle
   directories during an explicit one-time capture. Normal tests replay the captured
   byte buffers, diagnostics and exit codes using only the memory filesystem; they
   neither create host files nor launch native processes or skip missing tools.
3. Add quiet parsing and suppress only native quiet-mode progress/advisory warnings;
   retain fatal errors, file-output charging and existing publication ownership.
4. Add streaming mode using the existing selection, archive reader, decoder, actual
   decompression accounting and output-ownership helpers. Never enter extraction or
   staging. Respect native `-p`/`-l`/`-o`/`-d` combinations and first-match selection.
5. Cover binary stored/deflated data, empty files/directories, symlink bytes,
   extension fallback, unmatched/duplicate patterns, missing/empty archives, CRC,
   corrupt/truncated/trailing DEFLATE, advertised and actual aggregate limits,
   stdout/file budgets, cancellation, backpressure and read/write cleanup.
6. Run the scoped ZIP suites and native comparisons, update ZIP flag documentation,
   and hand the source freeze and exact file inventory to root for release gates.

An additional red test caught premature cancellation settlement while an enrolled
stdout write was pending. Reusing `createOutputOperation` fixed that ownership gap;
the resulting memory suite has 49 cases. Native tests have three groups, including
100 option/selection combinations. These are scoped compatibility checks, not a
claim of complete Info-ZIP support or a successful release.

## Exact new canonical tests

- `packages/safe-bash/tests/commands/zip-standard-flags.test.ts`
- `packages/safe-bash/tests/commands/zip-standard-flags-native.test.ts`

Shared deterministic fixture helper:
`packages/safe-bash/tests/commands/zip-standard-flags.helpers.ts`.

Flag documentation: `packages/safe-bash/docs/ZIP.md`.

## Native snapshot and manual recapture

The immutable capture is
`packages/safe-bash/tests/commands/fixtures/zip-standard-flags-infozip.json`.
It contains actual native process results, not expected values derived from the
virtual implementation: ten ZIP invocations, six successful native ZIP archives
with native streaming results, 100 selection/flag combinations, and six failure
cases in the same three test groups. SHA-256-checked, deduplicated base64 blobs
preserve stdout, stderr, input archives and native-created archive bytes exactly.
Version output, C/UTC environment, host/Node profile, argument vectors, fixed
source timestamps and historical capture-source hashes accompany the data. The
legacy live-test source hash identifies the runner before snapshot conversion;
it is provenance, not a requirement to pin current implementation bytes.

Recapture is an explicit agent-executed task, never part of unit tests or a
permanent QA script:

1. Preserve the existing capture. Read its argument vectors and the three groups
   in `zip-standard-flags-native.test.ts`. Record hashes of the current replay
   test, fixture helper and archive-format source. Check actual `zip -v` and
   `unzip -v` output for Info-ZIP 3.0 and UnZip 6.00; record full output and status.
2. Use an isolated disposable host directory per group and the captured helper's
   `binary`, `compressed`, `members`, `modified` and `archiveBytes` fixtures. Use
   `PATH=/usr/bin:/bin`, `LC_ALL=C`, `TZ=UTC`, a five-second subprocess timeout and
   a 1 MiB output bound. Set source-file and folder access/modification times to
   the fixture date before each ZIP invocation, avoiding atime-dependent archives.
3. Execute the ten ZIP argument vectors in order against the same group directory.
   Record native stdout/stderr/status for each. For every successful ZIP command,
   retain that archive immediately and run native `unzip -p` on it, recording its
   output and status before a later command updates the archive.
4. Write the bounded sample archive once in the second isolated directory. Run
   all ten flag combinations crossed with all ten selections, exactly in replay
   order. Record every native result and final root/folder namespace listings;
   streaming must not create the ignored destination or extracted members.
5. In the third directory, capture the three missing-archive invocations, the
   empty archive, and stored/deflated CRC-corrupt archives. Preserve the exact
   input archive bytes and native CRC diagnostics; do not substitute virtual
   diagnostics, which intentionally have the bounded implementation's wording.
6. Deduplicate byte buffers into indexed base64 blobs, recording each SHA-256.
   Add the native observations and provenance to a new snapshot candidate, not
   synthesized expectations. Remove only the owned temporary directories in a
   finally/cleanup path. Replay all three groups against the candidate entirely
   in memory, inspect differences, and replace committed evidence only with
   explicit authorization. Normal test execution must never recapture it.
