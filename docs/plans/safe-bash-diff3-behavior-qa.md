# diff3 behavior candidate QA

Candidate: working tree on main at `35d01c57f8078d8afa916dc59929395d857e9c55`,
2026-09-19; Node v22.22.2 / npm 10.9.7; no commit, push or publication. Preserve the existing engine and unrelated package/publication edits.
The owner is private `safe-bash-command-diff3`, ESM with no external runtime
dependencies. Safe-bash exports and composes its bundled implementation.

## Executed behavior increments

Each repair followed a concrete failing memory-VFS or pure-byte test. Reviewed
increments cover selector/class rendering, report common-file selection, stdin
remapping, missing terminators, strip-CR retention, dot repair addresses, SDK
option snapshots, byte-kind admission, canonical sink failures, cleanup before
acquisition, empty-chunk accounting, metadata quotas and escaped diagnostics.
The required-limit omission, array-like byte coercion, inherited flagged-ed dot
range, stdin common mapping, synchronous cleanup registration and terminal
control injection were reproduced before fixing them. No engine alignment code
was changed, no tests query an LLM, and no unit test starts native diff or ed.

`behavior.test.ts` transcribes independent native expectations from the existing
[292-record corpus](safe-bash-diff3-native-controls.md). The 265 direct controls
cover 190 core records, 27 option records, 18 alignment records, 24 corner records
and six inventory records. Native stdin defects and host-specific error text are
qualified separately through the memory command adapter; retaining all records
does not imply byte parity for deliberately excluded diagnostics/defects.

The official archive SHA256 was independently checked as
`7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`.
Only bounded `src/diff3.c` research text was extracted, confirming stdin remapping
and dot repair ranges. This session performed no new native executable run and
copied no GNU source into production. Added source-derived regressions are not
represented as new independent native controls.

## Resource and capability evidence

Focused tests cover input/spool/coalescing/retained/output/decoded/argument/label
quotas, graph and work exhaustion, safe integers, empty chunks, pre-abort, stream
abort, late VFS acquisition, owned-write draining and sink error identity.
Cleanup is registered before acquisition and live accounting returns zero.
Budget exhaustion never selects greedy/minimal alignment. Logical accounting is
conservative and does not promise exact JavaScript heap or RSS bounds.

One stdin in each position is bounded-spooled once; multiple stdin operands are
refused before reading. Merge LF labels remain literal; flagged-ed labels reject
CR/LF to prevent script injection. External executable selection is rejected
before I/O. Diagnostics escape control/non-ASCII metadata and are omitted if
their remaining quotas cannot accommodate them. Ed is output only, including
`-i` suffixes; source inputs remain unchanged.

## Installed consumer procedure and observations

Build through the maintained root route, package the three public safe artifacts,
then npm-pack and offline-install their tarballs into an isolated consumer with
no private command workspace. Run the maintained
`scripts/fixtures/safe-packages-diff3.mjs` under Node's permission model with read
access confined to that consumer. Compile
`scripts/fixtures/safe-packages-diff3-types.mts` with strict NodeNext,
exactOptionalPropertyTypes and noUncheckedIndexedAccess, without skipLibCheck.

The initial installed candidate passed pure analysis, foreign-realm byte
ownership, command runtime identity, opt-in registration/collision/replace,
Shell/SDK parity, symlink input aliases, pipeline/VFS script, redirection,
directories, unmodified `-i` source and external-selection rejection. Declared
public dependencies were installed normally from the offline cache. An initial
manual-copy setup omitted those dependencies; that setup was corrected rather
than waived. Python archive extraction was corrected for the local API after
validating package-prefixed regular-file/directory entries.

Actual installed Shell screenshots were generated and viewed for report,
three-section conflict merge and escaped-dot ed output. Report status 0, merge
status 1 and script status 0 were legible and consistent with the byte fixtures.
Screenshots are ad hoc evidence, not added snapshot tests.

## Verification receipt

Focused final package unit route: **320 passed, zero failed/skipped**. Package
lint and source/test typechecks passed. Publication boundary tests: **164 passed
across three files**. Final maintained root `npm run build` passed. Refreshed public tarballs were
offline-installed, and permission-confined runtime plus strict NodeNext types
passed again. Final repository `npm run lint` passed, including type and workflow routes
(zero errors, four accepted historical warnings). Broad unit verification is
recorded below; no successful full-suite claim is implied by focused checks.

One broad run overlapped a workspace rebuild and observed missing
`packages/safe-bash-command-op/dist/encoding.js`. This is invalid concurrent verification; rerun
the affected 15-case scan-boundaries file after the build completes, preserving
its assertions: all 15 passed without failures/skips.

## Open qualification

Keep systematic isolation/replay/realm auditing, browser/workerd command
profiles, deterministic generated-triple compatibility and global ship/release
gates open. The GNU costly-search shortcut remains explicitly unsupported
(`ALIGNMENT`), with no silent fallback. Passing the retained repeated-line
controls qualifies the admitted profile, not universal GNU alignment parity.
The artifact command profile advertised here is Node ESM. No private package is
published and no release claim is made.

Candidate SHA256 fingerprints (before evidence cleanup):

| Source | SHA256 |
| --- | --- |
| behavior.ts | `801e082c50f9d1ee23ece2f1fc086194f921a6bd4a166c1f5189ae3f7cde7d39` |
| command.ts | `b73b07dd43d247129d34d030173324a6cad90f67a318c4f6d8f27926d6fca39e` |
| bytes.ts | `3dd8b4f662acf50f59f2ca8ca2f9e7783c55fbf2cb0917ad99dd0bac663b67d1` |
| fixtures.ts | `09f892c6430e16fcbc59896592bc7b3cc75e8f73e4f0d527f4cd788234616acd` |

An independently reproduced full-suite blocker is
`private checkout refuses qualification through retired public exports` in
`tests/integration/s3-http-exports/exports.test.ts`. Its verifier requires
selected committed package metadata to equal the working tree; pending manifest
and lockfile edits trigger `Peer binding requires the selected committed package
metadata` before the test's expected public-runtime refusal. The direct isolated
test reproduces this in about two seconds. Preserve the metadata/replay guard,
assertions and unrelated edits; do not commit other work or change the oracle
to manufacture a passing delivery gate. Global full-suite/ship acceptance remains
open until a matching committed candidate can be qualified.

Maintained root `npm test` finished with exit 1 after all 1,253 active safe-bash
test files ran: 42,700 cases, 41,869 passed, two failed and 829 skipped. Skipped
controls are not counted as passes. The reported failures were the concurrent-build missing op output
and the independently reproduced committed-metadata guard described above. The
former subsequently passed all 15 cases. The orchestrator stopped at safe-bash;
this is not a full-workspace pass. Focused command/behavior tests, public boundary
tests, final normal build, final root lint, installed runtime/types and reviewed
screenshots passed. No assertion was weakened, timeout increased, unsupported
version removed, or unrelated edit reverted.

Task-owned temporary logs, screenshots, extracted research text, artifacts and
the isolated consumer are purged after recording this durable receipt. Recreate
them using the documented routes when reviewing a matching committed candidate.
