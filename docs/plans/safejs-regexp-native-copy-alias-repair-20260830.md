# SafeJS native RegExp copy alias repair

Base: `8411130b542921ad92fcf88c51e6ec66370281b4` (published guard 13.0.4).
Independent static handoff manifest SHA-256:
`6ccbfba68f3be60b6326144772319e9c002f5749c3d9436ba4fb56f88775fc61`.
This is the separately routed existing alias defect, not a guard-introduced defect.

## Narrow repair and invariants

The production change is three added lines in `interp/values.ts`, using its
existing per-copy WeakMap. Ordering remains: reject proxy/invalid own brand;
capture primitive own DATA source/flags and the existing own DATA cursor;
admit the supplied compile owner when present; perform charged source/flag
preflight; then look up and return an existing native copy. On a miss, perform
the existing checked allocation, native construction and cursor assignment,
retain the successful allocation, then store that native object in the memo.
The existing finally block runs on both paths; a hit discards its new zero-charge
ticket without removing the first copy's live retained charge.

Repeated references reuse the first admitted native object. Distinct guest
objects with equal fields and independent top-level copies remain distinct.
This intentionally changes observable host-side identity and mutation sharing
within one copy, not identity with the guest or between separate copy calls.
There is no pattern interning, new API, global cache or cross-run cache.

Preflight still performs and charges its physical work per encounter. Only the
duplicate native allocation/construction is eliminated; no executed work is
refunded. For source `a`, flags `g`: preflight costs 2, allocation costs 3; repeated
pair costs 2+3+2=7 and retains 3 units, distinct pair costs 10 and retains 6. These
are source-derived test oracles, not values calibrated from execution. Invalid
native flags `gg` cost 3+4 before rejection; subsequent valid `g` costs 2+3,
total 12. These outcomes were subsequently observed unchanged in GREEN.
The saved 3 units for a repeated `a/g` are exactly the omitted duplicate
allocation/construction charge. Previously executed guest compilation and
remaining export preflight/allocation work are not discounted or refunded.
Limits, matching, raw cursor export semantics and cleanup remain unchanged.
No new budget sufficiency, universal native-resource, or equal-tight replay
promise follows; guard refusal and deadlines still apply on memo hits.

## Finite TDD and validation

New isolated test root `interp/values.regex-copy.test.ts` covers genuine guest
pair identity via public API, equal-but-distinct regexes, independent copies,
nested array/object/Map/Set aliases and cycles, ordinary host argument identity,
exact physical charges, own DATA hooks, changed length, exhausted work, stale owner
and native-construction failure cleanup. No native matching or large input.

Baseline new tests produced **9 pass / 4 fail**, raw exit 1. Failures were exact
public pair identity, nested graph identity, the normal host observer returning
false instead of true, and duplicate physical work 10 instead of the independently
derived 7. The repaired 13 cases pass. Repeated-versus-distinct cases retain the
exact 7/3 and 10/6 work/data assertions; independent copies have distinct native
identity and isolated cursor mutations. No native matching was executed.

Two existing controls explicitly asserted alias loss with `not.toBe`. The
compile-policy control passed unchanged on baseline (1 pass, 33 selector
exclusions). After the minimal production repair, the duplicate helper-policy
assertion produced a retained **109 pass / 1 fail** guard run. Both assertions
now use `toBe`, implementing the root-approved graph-copy identity contract
derived from the existing memoized array/object/collection branches. This is an
explicit semantic contract correction, not an assertion waiver or a budget
oracle calibrated to observed output. Source, flags, raw cursor and passive-hook
assertions, all numeric limits, timeouts and test counts remain unchanged.

Observed gates, each raw exit 0:

| Gate                                               | Actual result                                |
| -------------------------------------------------- | -------------------------------------------- |
| New copy tests plus compile-policy root            | 47 pass: 13 new + 34 existing                |
| Corrected guard/helper roots                       | 110 pass across 9 roots                      |
| Existing values, collections and host-bridge roots | 315 pass across 10 roots                     |
| Owned normal declaration-resolved TypeScript       | 4 TS roots pass                              |
| Owned ESLint                                       | 4 TS paths pass                              |
| Owned formatter write/check                        | 5 paths pass at the focused-phase postimages |
| Strict diff whitespace                             | pass                                         |

The unique selected passing cases total **438**, not 485: the initial 47
overlaps the later guard roots by 34. The 110 include the genuine EA checkpoint
and journal/replay controls; they do not substitute for fresh independent built
SDK copy/replay validation. All original RED logs and assertion preimages remain
under `/tmp/poe-safejs-copy-alias-20260830.Axog1k` with their original exits.
CPU was released at **2026-08-30T16:01:19Z**. No runtime, build or full suite was
rerun for this LIGHT seal. Only this plan changes after the focused-phase
formatter; final-plan formatting therefore remains a reviewer/publisher gate.

## Isolation, publication scope and remaining review

The fresh main clone is
`/Users/kjopek/Workspace/poe-code-safejs-regexp-copy-alias-20260830`.
It pulled the exact base before edits. Installed dependencies were copied with
`cp -cR` from the author's prior R7 workspace into separate files, not hardlinked
or shared writable modules. Both lockfiles, and the new clone before/after the
focused phase, have SHA-256
`60234a6893f09468ac19cfc69682b9d462de4fb6ff9f29db2feb6e366a996063`.
LIGHT metadata verification found all 19,669 regular files in the copied module
and four declaration trees have one link; all 109 symlinks resolve inside the
private clone; five corresponding source/copy inode samples differ. No dependency
content inventory was hashed to make this isolation check.

Normal type checking used private copies of previously built R5 declarations
for agent-spawn, frontmatter, safe-fs and tiny-mcp-client. This is disclosed
setup, not a fresh dependency build or install. Runtime used private HOME,
cache, config and TMP, `SKIP_SYNC_SKILLS=1`, and unset TERM; no hooks were disabled.
No install, build, full-root suite, built SDK/CLI or screenshot run occurred.

The publication union is exactly five paths: production `interp/values.ts`,
new `interp/values.regex-copy.test.ts`, the two existing
`interp/regex/compile-policy.test.ts` and `compile-helper-policy.test.ts`
identity assertions, and this plan. Source/test paths are relative to
`packages/safe-js/src/`. The new test and plan are absent from the base. The
sealed manifest binds all five pre/postimage states and the stock Git patch;
historical receipts and source transitions are evidence, not extra publication
paths. Existing source/test postimages are unchanged from accepted scoped GREEN.

Old R7 dirty source, immutable candidates and actual-package failure capsules
remain preserved. README/ledger/publication remain separately owned; no commits.
Fresh independent default SafeJS, relevant guard and new public-copy SDK checks
are pending root scheduling. There is no fresh independent, full-root, built SDK
or actual-release pass claim for this repair.
