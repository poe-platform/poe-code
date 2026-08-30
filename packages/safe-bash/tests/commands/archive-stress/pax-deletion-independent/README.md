# Independent PAX deletion verifier

Prepared only; execution requires the completed author handoff and a reviewed
READY JSON. No production, author tests, accepted verification or historical
reports are modified by this subtree. The seven D01–D07 controls are independent
table-driven assertions, not native-output-derived expectations.

The deterministic test backend delegates real MemoryFS writes and then applies
literal normal atime/mtime values through its saved backend method. Product
utimes calls are observed separately. This models a declared creation/write
policy rather than freezing a wall clock or deriving expectations from tar.
Required-field/all-size deletion rejection and missing-value dashes are approved
product policies; they are not universal POSIX error/display mandates.

## Execution after READY

```sh
node tests/commands/archive-stress/pax-deletion-independent/run.mjs --ready /tmp/safe-bash-pax-deletion-ready.json
```

The READY file is deliberately not supplied with placeholder hashes. Required
fields follow the accepted runner's schema1: status/author/rootAuthorization,
authorHandoff, head and complete gitState, inputs, authorTests/authorNames, b02,
historicalControl. New requirements:

- `deletionHandoff`: status READY, exact author detail path and SHA256.
- `legacyCorrection`: reviewed true, before original hash, after reviewed current
  options hash, original exact test identity, and `transport` equal to
  `tests/commands/archive/options.legacy.mts`.
- `baseline`: accepted snapshot root and accepted evidence SHA256.
- `research.detailSha256`: the pinned complete primary-source research report.
- `authorEvidence`: complete final author evidence/manifest path/hash list.
- `inputs`: every archive `.ts` plus archive README, corrected options, relevant
  configs/lock/package, new tests/helpers/runner/scope config, author deletion
  test, and unchanged old independent fixtures/controls/historical driver.
- `authorTests`: `tests/commands/archive/pax-deletion.test.ts`; exact new names
  must come from the final frozen author TAP, not an assumed denominator.

Execution retains five independent raw test profiles: accepted-baseline literal
177; patched literal177; corrected177; author-new; independent-new7. The original
options file is copied byte-for-byte as `.mts` ONLY into the temporary full
snapshot before sealing. No relative import is rewritten. It is included in
scoped types, while actual global `tsc --listFilesOnly` equivalence remains based
on the current root's real `src/**/*.ts` and `tests/**/*.ts` closure.

The literal-patched run is not a passing old177 claim. Its one approved conflict
must identify the exact original test, original expected raw mtime, and legacy
line108 stack; any other failure or incomplete accounting blocks acceptance.
Corrected/new profiles, baseline replay, scoped/global types, actual global build
and built4 must pass independently. All raw failures remain retained.

Historical baseline replay is not a source-only causal comparison to newer
FS/shell changes. It reuses the sealed accepted regular snapshot read-only.
The historical MemoryFS57a6148 omission control separately reuses its own sealed
snapshot and unchanged assertions/import guard. Neither is silently redirected
to the current product. Research's eight native vectors are not product tests.

The current tree is copied once with root locked regular dependencies, no live
aliases or old snapshot/engine/comparator copies. Prior reports are audited in
place; only necessary old runtime controls and exact GNU executable are copied.
All actual global compiler inputs are retained. Complete source and legacy
transport hashes, baseline hashes, exact commands, exclusions, profiles, unique
names, before/after checks and live drift are emitted to fresh `runs/run-*`.
Limits remain900s total,256MiB capture,10k files and8MiB per-command output.

Preparation validation is syntax-only. No baseline/product tests, source freeze,
compiler typecheck or build is authorized by this README or a WAITING checkpoint.
