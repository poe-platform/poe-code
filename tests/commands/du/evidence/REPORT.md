# DU author checkpoint — August 27, 2026

## Candidate and boundary

Source/test/documentation commit:
`877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3`.
Only new `src/commands/du/**` and `tests/commands/du/**` files are owned.
No root barrel, package export, contract, provider, other command, or shared
oracle source/binary was edited. Runtime dependencies were not added.

Exports are `createDuCommand`, `createDuCommands`, `duCommands`,
`DuCommandsOptions`, and `DuLimits` from the leaf module. Integration into root
exports, the package subpath, and aggregate command families is pending its
assigned owner. The built check imports isolated emitted modules and uses the
actual Shell/plugin boundary; it does **not** claim a packed public DU import.

This is an author-green checkpoint for a deliberately bounded DU profile, not
independent acceptance, a whole-repository gate, GNU/Linux qualification,
deployed-service acceptance, superiority, 72 hours of work, or project completion.

## Source-checkpoint checks

`checks-QICChQ/manifest.json` records HEAD before/after as the source commit above.
It captures actual source hashes, git state, exact commands, and raw logs:

| Check | Result |
| --- | --- |
| Scoped current tests | 140 passed, 0 failed/skipped/cancelled |
| Scoped strict TypeScript check | exit 0 |
| Isolated ESM/declaration build | exit 0 |
| Isolated built-module/plugin/actual Shell check | exit 0 |

No shared/root build was run or overwritten. Original hashed paths did not
change during the final check. This was a **live committed-source** execution,
not an extracted immutable archive gate; original-path postchecks are explicitly
not append-proof. Unrelated untracked work appears in recorded git status and
was neither staged nor committed with this task.

Actual recorded capture times: first GNU profile creation
`2026-08-27T17:05:07.249Z`; source-checkpoint checks ran
`2026-08-27T17:22:22.359Z`–`2026-08-27T17:22:24.574Z`.
These are capture timestamps, not a claim to measure all inspection/work time.

## Native profile and preserved differences

The installed oracle is the existing, shared **read-only**
`tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du`, GNU coreutils 9.7
running on Darwin with Node v22.22.2. No build, install, dependency download,
private-home lookup, or BSD substitution was necessary.

Primary GNU references inspected: the adjacent `src/du.c` and bundled
`doc/coreutils.texi`, especially `Block size` (line 894) and `du invocation`
(line 12571). The documentation describes environment precedence, upward block
rounding, apparent regular-file/symlink sizes, and reporting depth. Native
execution resolves details such as human rounding, suffix labeling and errors.
In particular `-Bsi` output was measured rather than inferred from the broader
documentation's SI prose.

| Oracle input | SHA-256 |
| --- | --- |
| Native `src/du` | `f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b` |
| Native `src/du.c` | `3cd1c0120881ba28da3345b1324e9d146f948a95db6ce2900ba27b3fe8f45bf9` |
| GNU `doc/coreutils.texi` | `39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca` |

`native-P1ILRO/profile.json` preserves all 87 original cases and raw native
stdout/stderr/status. `../native-profile.json` is a byte-identical canonical
native-data copy, not a product implementation pin. All original cases remain
in the current tests. They cover common options, sizes around scaling boundaries,
links, hardlinks, errors and environment behavior. No cases were deleted to
improve agreement.

`comparison-zAVfBj/results.json`, run at the committed source checkpoint, records:

| Cohort | Exact result |
| --- | --- |
| Memory versus 87 captured native cases, status + stdout | 84/87 |
| Same cohort, status + stdout + stderr | 72/87 |
| Rooted Real versus 18 live GNU cases, all three fields | 18/18 |

The live Real cases include allocation units, summary/depth/all output, apparent
sizes, hardlinks, a task-owned sparse file, final symlinks, and trailing-slash
resolution. Record-normalized comparison is also retained, but all 18 measured
cases happened to match exact bytes as well. The oracle binary and C source
hashes match before/after that run. This is not an archive-wide integrity claim.

The 15 non-identical captured cases are explicit profile differences:

- Two invalid/empty selected `DU_BLOCK_SIZE` cases fail strictly here; GNU 9.7
  silently uses its default. No allocation fallback is involved.
- Repeated directory operands remain visible here; GNU prunes repeated directory
  identity. This command deliberately preserves distinct mount/overlay namespaces.
- Combining `-s` and `-d0` succeeds here without GNU's redundant-option warning.
- Eleven failure cases have deliberately different human-readable diagnostics;
  status and stdout match. Current tests assert their exact product diagnostics
  and preserve the original GNU diagnostics, not merely a nonempty-stderr test.

These are not 87 GNU passes. Other documented restrictions include decimal-only
integer grammar, safe-integer products/aggregates, deterministic nonlocale child
ordering, POSIXLY_CORRECT affecting default units rather than stopping option
parsing, unsupported follow/one-filesystem flags, and strict incomplete-total
suppression. No broad compatibility claim is made.

## Backend and safety evidence

Actual Shell flows exercise Memory, rooted Real, read-only, mount, overlay,
S3 MockS3Client and WebDAV MockDav. Apparent positive flows are checked alongside
default allocation errors on unknown providers. Real allocation is checked
through read-only/mount/overlay selected-entry wrappers. S3 requests are limited
to HEAD/list operations and DAV requests to PROPFIND during measured DU calls;
these remain mocks, not deployed providers.

The command-boundary proxy permits only `lstat` and `readdir`, checks signals,
and rejects content reads, mutation calls and other filesystem methods. Tests
cover scoped identity, shared-directory/different-mount namespaces, unknown
identity, known zero, invalid/unknown allocation, invalid logical size, incomplete
totals, literal names, byte budgets, sorting work, depth, arithmetic, malformed
listings, backpressure, timer cancellation, late opaque host failures and exact
caller reason through the actual Shell. Registered/finally cleanup shares its
completion and drains only command-owned cooperative work.

**Separate RED provider no-effects control:** actual Overlay `readdir` retries
pending staging garbage cleanup and deletes hidden upper staging directories.
The named control passes only by detecting that failing no-effects property;
its command trace still contains only `lstat`/`readdir`. No all-adapter no-effects
claim or provider fix is included. Root/provider policy ownership remains needed.

All task-owned native/Real fixtures are cleaned in finally/test cleanup; all
oracle children are synchronous, bounded, and complete. Shared native scratch
belonging to other workers is untouched. Provider materialized listings and
opaque host work retain their documented resource/cancellation limitations.

## Preserved development history

- `initial-typecheck.txt`: initial test-string octal-escape diagnostics, corrected
  to explicit NUL joins without weakening the assertion.
- `checks-NGbR7E`: 48/49 tests; the path-cap diagnostic was incorrectly shortened
  by the path limit. Fixed the product diagnostic bound independently of path
  length; the original failing assertion and raw output remain preserved.
- `checks-xAkCQp`, `checks-WKwBGc`, `checks-VusE9r`, `checks-YDporU`: subsequent
  live development checks, retained rather than overwritten. Earlier green runs
  do not certify the final commit; use `checks-QICChQ` for that checkpoint.
- `comparison-ZrSuZR`: precommit raw comparison, retained beside the committed
  checkpoint's `comparison-zAVfBj`.
- Two read-only ad hoc summary attempts after the source checkpoint failed with
  `SyntaxError: Unexpected token ')'` (extra closing parenthesis). Neither ran
  product code nor wrote files; the corrected summary confirmed the source pin,
  capture counts and byte-identical native fixture. They are not test failures
  or a qualification run and did not alter any capture.

Canonical tests do not emit evidence. Explicit captures always create a unique
owned directory. The separate evidence commit preserves this history; source
implementation remains frozen at the checkpoint above for a different reviewer.
