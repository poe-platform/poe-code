# Split native capture repair: author evidence

Candidate: `46abd8792bee106b0a339a3e37f238604a2405ba`. This is a TEST/HARNESS-only
repair, not a whole-gate qualification. The four candidate paths and identical
parent/candidate product source tree IDs are recorded in `manifest.json`.
Frozen8670 wholegate17454pass12fail0skip remains **UNQUALIFIED**. Its original
mutated archive was not opened or rewritten.

## Behavior and reproduction

The two owned native test files no longer write initial/latest/profile evidence
under the repository, including on failure. Their native scratch now uses guarded
unique OS-temp directories. Original vectors, semantic assertions, binary hashes,
missing-oracle skips and mismatch aggregation remain intact.

With `VIRTUAL_BASH_SPLIT_CAPTURE` unset, successful tests do not serialize or write
reports. Failed cohorts emit lossless base64 JSON in TAP diagnostics. After hooks
report retained scratch paths, including on abrupt assertion failure. With the
switch set to `1`, each report is exclusively created in a new private OS-temp
directory and its absolute path is printed. Every other switch value is rejected;
the switch is not an output destination.

The test-only helper rejects repository temp roots and aliases into them, unknown
report names, existing report files/output symlinks, and replaced/symlink capture
directories. These checks are not a sandbox against malicious concurrent host
namespace mutation. No public API, product source or dependency changed.

Run from the repository with the exact native prerequisites in `candidate-handoff.txt`:

```sh
env -u VIRTUAL_BASH_SPLIT_CAPTURE node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/split/native.test.ts tests/commands/split/native-errors.test.ts
VIRTUAL_BASH_SPLIT_CAPTURE=1 node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/split/native.test.ts tests/commands/split/native-errors.test.ts
env -u VIRTUAL_BASH_SPLIT_CAPTURE node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/split/native-capture.test.ts
node_modules/.bin/tsc -p tests/commands/split/tsconfig.json --noEmit
```

## Results and denominators

- Original canonical pair: **4 passed, 0 failed, 0 skipped**.
- Explicit capture of the same pair: **4 passed, 0 failed, 0 skipped**.
- New capture regressions: **9 passed, 0 failed, 0 skipped**.
- Scoped TypeScript check: exit zero.
- Existing native vectors: GNU 43, Apple 20, GNU error scenarios 9, profile
  differences 4 scenarios run against both tools. Reruns are not new native coverage.

Four regression children repeat the original corpus with capture off/on and
success/injected mismatch. Fault injection changes only observed exit status in
copies of the two owned native tests, never expected data, fixtures, oracle
identities or product source. The injected child runs correctly retain **3 failed,
1 passed** tests and three scratch directories before regression-owned cleanup.

## Integrity and history

All **44** previously tracked split evidence files, including all **5** tracked
latest JSON files and the profile-difference report, have unchanged before/after
SHA-256 values in `manifest.json`. All four newly captured reports are byte-identical
to the corresponding historical reports. Their new retained OS-temp paths and
hashes are listed; old evidence is not overwritten or rebaselined. The large report
bytes are not duplicated here because they already exist in unchanged tracked files.

`before-hashes.json` records initial live source/test/evidence hashes and Git HEAD.
`candidate-hashes.json` records immutable candidate Git hashes; `after-hashes.json`
records final live hashes. Final live inputs match the candidate, and no baseline
source or unowned split input drifted. These were shared live-tree runs, not an
executed frozen archive; unrelated dirty files and concurrent commits remain outside
this scoped acceptance.

The first author typecheck and regression failures remain in `attempt-01-typecheck.log`
and `attempt-02-regression.log`. The regression initially counted tsx's cache as an
unexpected scratch entry. The correction disables disk caching in regression
children rather than relaxing the directory assertion. A later diagnostic change
uses base64 to preserve exact newline bytes through TAP escaping, checked by the
final regression. `final-*.log` contains the final candidate-source results.
Auxiliary read-only command failures are disclosed separately in `manifest.json`.
The full evidence whitespace check reports eight whitespace-only lines in the
retained raw `attempt-02-regression.log`. They are preserved byte-for-byte rather
than normalizing failure evidence; the candidate code and other evidence pass
their scoped whitespace checks.

## Limits and handoff

This evidence records Darwin/arm64, Node v22.22.2, native version output and exact
binary identities. It does not establish GNU/Linux semantics, deployed backend
behavior, superiority or full completion. Existing writers in split edge/stress/
dangling-native tests and repository scratch in other split tests are outside this
ownership and remain unchanged. No broad suite or original archive was run.

ROOT's different-agent verification is requested in
`/tmp/safe-bash-split-capture-repair-candidate.txt`; this report does not claim that
verification has occurred. Explicit captures remain on disk. All author-owned test
processes have exited. Initial failures and subsequent corrections remain separate.
