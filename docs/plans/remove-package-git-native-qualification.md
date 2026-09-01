# Remove package Git and native qualification

## User decision and boundaries

The user explicitly requested removing package Git support and the unrequested
GNU/native qualification machinery, then committing and pushing the changes.
This supersedes earlier requirements to preserve native binary admission gates.

Remove the SafeBash Git command family and public command export, the SafeJS Git
module and its harness injection, and their feature-specific configuration,
policies, tests and documentation. Keep repository Git, worktree management,
normal commit/push hooks, publishing, schema workflows and unrelated tools.

Remove native provisioners, executable qualification profiles, mandatory native
oracles, native-lane selection, and the Release workflow's qualification jobs and
dependencies. Do not replace them with opt-in modes, successful no-ops, skipped
tests, relaxed hashes or product output used as its own oracle.

Mixed tests retain independent deterministic product expectations. Pure live
native calibration/differential cases are intentionally retired, not passed.
Static fixtures and historical evidence remain unchanged. Existing source and
filesystem boundaries are not removed as a shortcut.

## Integration

Use an isolated main successor carrying the eight-path lint stress split from
local d51d2c796b314a55d3865435ba1e06bbda578818. Its initial remote baseline is
e91ecba8bdd56c4dd9285a3bc64336ce479aec84. Recheck remote main before pushing and
preserve subsequent unrelated changes. Do not activate or edit the original
dirty checkout. Earlier unpublished runtime work is not implicitly included.

Bohr owns SafeBash Git production/test removal. Turing owns SafeJS Git and the
specific root harness injection. The release operator integrates those patches
and owns native qualification removal, manifests, workflow and root documentation.

## Validation and delivery

1. Record runner behavior RED before removal and retain the complete result logs.
2. Run all retained affected tests and verify that mixed files have no empty
   success cases or dangling native imports. Record retired cases separately.
3. Run workflow lint, package checks, build, type checks, lint and ordinary tests.
   Preserve current-main workspace concurrency in CI.
4. Keep the required lint stress stage after workspace tests and before smoke
   and release: two full-scale cases, 180 seconds per case, seven-minute CI bound.
   These are explicit stress budgets, not a claim that old unit deadlines passed.
5. Commit specific authored paths with a breaking-change conventional message
   because public Git APIs are removed. Run normal hooks and a normal main push.
6. Monitor release and schema workflows through terminal results, then verify the
   actual registry version, gitHead and installed artifact. Do not claim release
   success before these checks complete.

## Current evidence

Runner removal has a causal RED and a 190/190 passing retained runner suite.
The changed SafeBash cohort initially passed 3,469 cases with two failures;
the remaining live-rg case was retired and the recorded sed dialect selection
was restored to its original policy. Both complete affected files then passed
22/22. The final metadata integration passed 48/48 retained cases. Root production
types and workflow lint passed before final-main reconciliation.

The first candidate was based on main 9fad33b3ad39f5908bd95e7ac5882ec3a763451c.
Intervening native binding and qualification-job changes are superseded by the
explicit removal decision; their historical plan remains in the tree. The newer
native-only Bash binding tests are retired with that infrastructure. No unrelated
runtime, dependency lock, Git repository operation or release plumbing is removed.

These scoped results are not a full-gate or publication receipt. Intermediate
failures and retired-case records remain preserved outside the checkout. Final
ordinary hooks, all retained tests and release workflow outcomes govern delivery.

## Subsequent main reconciliation

Local commit 549c74fe6876ef0641265adeb2070bbd54c8571c passed normal commit
hooks. Before push, main advanced to e81daf1e554ed99f87c58a885b0c1a87edeeb108.
The successor preserves its byte-value runtime, budgets, cancellation, new
deterministic tests, compact README and additional temporary-directory tests.
Its now-serial CI workspace setting is retained before required lint stress.
New native executable bindings are removed under the same explicit user decision.
No old runtime file or long README is overlaid onto the newer implementation.

The first normal push hook on this successor passed package lint but stopped on
one stale root export-list assertion: it still expected the removed public Git
command route. The root unit result was 28,908 passed, one failed and 43 skipped.
Only that obsolete expected export is removed; all other metadata assertions
remain. The failed hook is retained, and normal hooks must pass before delivery.

The next normal hook passed all 28,909 root cases, then SafeBash completed with
18,098 passes, nine failures and 64 skips. Six metadata consumers still referenced
retired native helpers; their bounded follow-up preserves deterministic cases and
small captured expectations without native execution. Two registry checks now
expect 79 commands after Git removal. The historical JQ evidence check retains
all immutable manifests, 23 captured snapshots and 140 other current comparisons;
only the source seals for the deleted live oracle and the live-oracle body removed
from semantics.test.ts are retired. No captured evidence bytes are changed.
These failed hook results are preserved, not relabeled as passing.

All normal hooks subsequently passed on 93760982212711fb3e7c46d1d6fe805819275310:
28,909 root cases, 18,124 SafeBash cases, all other declared workspace tasks and
both mandatory lint-stress cases. Git then rejected the push because main had
advanced to f83c88a31b91f89193c0caf71d215b3911e49313. The merge preserves that
history and its plan additions. Its executable changes only extend the explicitly
retired native prerequisite framework, so no binaries, profiles or launcher-only
tests are reinstated. Retained executable source is identical to the fully tested
local commit. Normal hooks still run on the final merge before another push.
