# Runtime global lifetime

## Reproduction

Baseline `0d11f5dc9`, with an independent dynamic-constructor prototype fix in
the worktree. Executing exported dynamic functions after cleanup exposed
`Unknown intrinsic identity: ["globalThis"]`. Four standalone regressions
confirmed the same failure for non-strict this binding, unresolvable assignment,
destructuring assignment, and indirect eval. A fifth regression confirmed
direct eval failed with the released `["eval"]` identity table.

## Fix

Intrinsic installation captures the owning global object and eval object in
separate weak-budget-keyed runtime maps. Runtime this binding, assignment,
destructuring and indirect eval use the runtime global; direct-eval detection
compares the captured callee against the owning runtime eval identity.
Snapshot identity resolution is still released on cleanup. The mutable
globalThis binding is not used to locate the intrinsic global object.

Seven lifecycle tests cover these operations, original/replayed closures,
replaced globalThis, released accounting roots and snapshot tables, and owning
versus foreign eval identity. All pass. A broader focused run passed 512 tests
in 32 dynamic-function, eval, identity, accounting and snapshot files before
the last two lifecycle controls were added. Those scopes overlap and include
the independent dynamic-constructor prototype fix; they are not an isolated
test of the runtime-global commit.

Scoped lint and TypeScript passed. The maintained build completed 23 workspaces
and four fresh-process import checks. Four built-SDK lifecycle probes passed.
All 1,700 tests in the 127-file snapshot suite passed with both fixes in the
worktree. No push or release.

The follow-up `eval-foreign-realm.test.ts` independently validates a remaining
gap: three foreign eval invocation forms return the caller realm's global
marker instead of the owning realm's marker. They correctly avoid the caller's
local lexical variable, so the remaining bug is realm selection, not direct-eval
classification. This red audit is not part of this commit or passing counts.
