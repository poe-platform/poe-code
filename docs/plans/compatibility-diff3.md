# Independent diff3 qualification

Qualify the existing private command against GNU diffutils 3.12 without changing
registration, publication or shared integration files. Use the archived package
pattern at `archive/safe-bash-command-package-pattern.md`; its original path is
already deleted in this worktree. Preserve that pending move.

1. Download the official 3.12 archive into task-owned ignored
   `out/compatibility-diff3` (this host has no `/out`), verify SHA256
   `7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`,
   configure with `--disable-nls` and build. Only manual controls spawn it.
2. Bind results to HEAD plus SHA256 of every command source, manifest and public
   facade. Record Node/npm/compiler/oracle versions. Generate 64 triples from
   seed `0xd1ff3003`, LCG `imul(seed,1664525)+1013904223` modulo 2^32;
   use upper 16 bits for choices. For each operand choose 0–9 lines from
   `a`, `b`, `c`, `.`, empty, byte FF and byte FE, and independently remove its
   last LF when the next choice modulo 2 is one. Keep empty inputs empty.
3. Compare exact stdout/stderr bytes and status for report, `-m`, `-mE`, `-e`,
   `-x`, `-X`, `-3`, with matching pinned diff and C locale. Test the same bytes
   through literal CLI and SDK with memory VFS, explicit signal and cleanup;
   verify unchanged operands and final live accounting. Record all differences,
   explicit unsupported cells and original seeds before minimizing failures.
4. Add fast memory-only regressions for validated failures before repairs.
   Independently reconstruct both variants from edit ranges for deterministic
   byte triples, and validate token terminators and source ownership. These
   reconstruction checks do not establish GNU tie parity.
5. Run maintained command test/lint/build routes. Inspect a terminal screenshot
   containing report, conflict merge and reverse ed dot-repair output. Keep
   performance measurements separate; none are required for semantic proof.
6. Record passes, failures, skips, missing runtime/installed-artifact cells and
   deviations. Purge task-owned temporary native build, logs and screenshots.
   No commit, push, release or private package publication is requested.

## Verification receipt — 2026-09-19

Candidate is the dirty worktree at HEAD
`35d01c57f8078d8afa916dc59929395d857e9c55`, not that commit alone.
SHA256 of the command-owner source/configuration and public facade is
`874ecf52ab22933c7679eb7ba518430355087a7e23662f15a7bf1af8e8418bdf`.
Reproduce by collecting every `.ts` file recursively under
`packages/safe-bash-command-diff3/src`, plus that package's `LICENSE`, `README.md`,
`package.json`, `tsconfig.json`, `tsconfig.test.json` and
`packages/safe-bash/src/commands/diff3/index.ts`. Sort repository-relative paths
lexically; feed each UTF-8 path, NUL, exact file bytes, NUL into SHA256.
The new literal oracle fixture file `src/generated-controls.ts` has SHA256
`190fcaa3f46d9d987c6870e8fc9d7bdb6a38af46cb0dea17a4c22fd6aa1ae61f`.
This binding includes the tests; it does not claim the entire dirty repository
equals HEAD. No production command source was changed.

Runtime/tool cell: macOS ARM64, Node v22.22.2, npm 10.9.7, TypeScript 5.9.3,
ESLint 9.39.4, Apple clang 17.0.0 (`clang-1700.0.13.5`). The fresh official
archive matched the SHA256 above. Both freshly built `diff` and `diff3` report
GNU diffutils 3.12. Native diff3 executable SHA256:
`e2b7b439a60f39afb5e33c44c9fc8cf78cf66ca9a0b843e0114a014d876219e8`.
Native comparisons used matching `--diff-program`, C locale and
`POSIXLY_CORRECT` unset; that is solely the manual oracle protocol.

### Fixture cells, bytes, statuses and effects

- Fresh corpus: 64 generated triples from the exact recipe above, each in seven
  modes (448 observations). Operands are generated in ours/base/theirs order.
  Reconstruction uses the same generator but compares raw token bytes to the
  original operands, independently rebuilding both variants and unchanged gaps.
  It validates LF flags, ordered/bounded ranges and owned source storage.
- Six additional observations use `ours\n`, `base\n`, `theirs\n` and one label:
  `-m` with empty label, `-m` with `first\nsecond`, `-m` and `-mE` with
  `Ω\t\r\\'`, `-A` with `Ω\t\\'`, and `-E` with empty label. These are
  JSON-style escapes; Ω is UTF-8 CE A9. All six conflict statuses are 1,
  stderr is empty, and exact output hex is preserved in the fixture file.
- All 454 fresh observations matched native stdout/stderr bytes and status,
  with zero differences or unsupported cells in this bounded corpus. Each was
  replayed against GNU and checked for byte-identical operands and no new files.
  The fixture records every input byte and each argument/status/output pair.
  Only executable-path text in native diagnostics is mapped to `diff3`.
- Original 292 literal observations from `src/fixtures.ts` were also replayed
  against the fresh native build: zero differences. These cover the existing
  nineteen core profiles, options, stdin defects, horizon 99/100/101 inputs,
  boundary cases, binary behavior, inventory and file/arity errors. Only native
  executable paths are replaced by the existing `<DIFF3>`/`<DIFF>` placeholders.
  This replay validates the upstream records; documented safety deviations mean
  these are not 292 blanket product-parity passes.
- New memory-only tests execute every fresh observation through literal CLI and
  independently mapped SDK options (908 executions). They assert exact bytes,
  statuses, unchanged operands, three closed VFS streams, cleanup before
  acquisition, repeated idempotent cleanup and zero final SDK live counters.
  Streams reuse and erase a one-byte producer buffer. Unrequested stdin
  consumption and reads outside the three VFS operands fail the test. Expected
  bytes originate solely from GNU; tests never spawn it or fetch fixtures.

### Maintained checks and installed artifact

- Final command workspace test route: 399 passed, zero failures/skips.
  Package lint and both source/test typechecks passed. New generated/reconstruction
  checks stay fast; durations are runner diagnostics, not performance evidence.
- Selected command build and selected `@poe-platform/safe-bash` build closure
  passed, including its postbuild. The build exclusion adds only the new oracle
  data file, keeping test fixtures out of runtime artifacts.
- Public artifacts were staged as `0.0.0-compatibility-diff3`, packed with
  lifecycles disabled and offline-installed into a canonical temporary consumer
  outside the checkout. No private diff3 workspace was installed. Maintained
  installed diff3 runtime fixture and strict NodeNext declaration consumer
  passed, with exact optional properties and unchecked indexed access enabled,
  without `skipLibCheck`.
- The same 454 CLI/SDK observations passed against installed public exports:
  70 test groups, zero failures/skips, 908 executions. The harness was transpiled
  without semantic changes and its imports were AST-mapped to public subpaths.
  Runtime and corpus ran under Node filesystem permission limited to the
  consumer, with no child-process permission. This is a negative host authority
  control, not a complete isolation claim.
- AST scan of all 1,264 installed safe-bash JS/declaration files found zero bare
  private command/contracts imports. The packed diff3 implementation has only
  relative canonical first-party contract imports, no bare runtime imports and
  no shipped generated/test fixtures. Private manifest/empty runtime dependencies
  and opt-in composition were preserved.
- Actual memory-VFS Shell report, `-m` conflict and `-A` ed output screenshot
  inspected: statuses 0/1/1, readable indentation/markers and reverse dot repair.
  The maintained screenshot tool captured the virtual CLI through a Node harness.
  The first screenshot's long harness header was removed for readable inspection.

Public tarball SHA256 receipts:

| Artifact | SHA256 |
| --- | --- |
| safe-bash | `748770efcb3b95277826e774b92880a5c15c62882d187e13c7eb118372c4cbbe` |
| safe-fs | `36b992498ac0aa749523b9760edd874303ec6a18ed026bba10607df976a1338e` |
| safe-js | `411ff4c4e86d7f62d1e64adc37d69e1d07f9b69a61b4ffc45a30ffdd90ba85d7` |

### Investigated failures and limits

No command mismatch was found, so no production repair or minimized failing
command case was necessary. Initial test-harness lint rejected a generator with
no yield; the forbidden-stdin capability now fails synchronously on iterator
acquisition. TypeScript rejected conditional result inference; an explicit
contract result annotation fixed it. Both final maintained gates passed.
The first native effects replay sorted its operand array in place after the
report cell, accidentally swapping ours/base. Sorting a copy restored the exact
operand inventory; all 454 replay cells then passed. These harness failures are
recorded separately from semantic differences and were not hidden by a product
change or weakened assertion.

The admitted target is explicitly GNU 3.12, including unflagged `-X` and default
identical-change conflicts. Product still rejects external diff programs and
multiple stdin operands, supports single stdin in every position, refuses CR/LF
ed labels and malformed UTF-16/NUL metadata, sanitizes diagnostics and fails
directories through its VFS file contract. These remain deliberate deviations.
Existing cancellation, quota rollback, failed sinks, late acquisition, binary,
realm and fresh-invocation/replay controls passed in the command unit route.
Native duplicate-stdin/reopen defects were reproduced only by the oracle replay.

Missing cells: actual browser/workerd, other Node versions/platforms and broad
repository gates were not run here. Earlier installed/safety QA documents record
the committed public-peer binding blocker for shell checkpoint qualification;
it was not rerun or repaired in this scoped qualification. Diff3 itself has no
checkpoint API. New fresh invocation checks do not qualify shell checkpoints.
GNU costly-search shortcut inputs remain explicitly unsupported (`ALIGNMENT`),
and universal repeated-line tie parity remains unproved. No resource bounds are
represented as RSS guarantees; sink prefixes and shell redirect truncation are
not rolled back. No performance measurements or complete release acceptance
are claimed. Focused passes do not replace an incomplete/failed broad gate.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No publication was requested or performed. Task-owned native builds,
staging, consumer, logs and screenshots are purged after durable receipt capture;
literal byte fixtures and regressions remain in the command package.
