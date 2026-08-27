# Repeat-policy handoff: concrete boundaries, not promotion

2026-08-27. Delegated leaf; evidence only. This derives **10 existing rows**, not
a new corpus or execution gate. Curie's `8897ece3` judgment and pre-source freeze
`3cbcdc1a` are authority for the narrow reasoning, not a universal comparator.
The independent candidate inputs froze in `6d6c00d8` before source inspection;
review `954ddde4` authenticates isolated artifact `c433d023`. Two shorter examples
come from the author's final capture of already-frozen `53f2a468` inputs, **not**
from the independent candidate run. These qualifications must not be merged.

**Keep root's adopted P/aaa completed capture `a`.** GNU's empty command result
remains an explicit discrepancy, not an upstream-confirmed bug. No product,
historical fixture, root file, candidate policy, or acceptance count changes.

## Exact receipts

`MANIFEST.json` binds every selected input/capture/driver to its full Git commit,
blob, SHA256 and byte count, copies selected records with JSON pointers, and
records invocation details and native identities. `verify.mjs` checks those
bindings, byte spans, command projections and the complete owned entry set.

- Accepted source: `21220b465537bf45ffcfb36740956a69f43bf75e`.
- Candidate worker: `663b0b9010d939df16910c75d543f7a41cee832d6cd7cc2ab142996386206890`.
- Patch: `900d10baaaad15e6e428747ca5815b3c284f14a612d6752c9b7bdf91b2fed6de`.
- Independent archive: `04eca6b16fa410fce542ce1816a44aa9910449c407ca00a4fa2368337db0f7c9`.
- GNU expr 9.7, Darwin, repository `.oracle/coreutils-9.7/src/expr`:
  `e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
- Apple `/bin/expr`, separate Darwin profile:
  `584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f`.

The independent runtime is Node 22.22.2 / Darwin 25.4.0 arm64. Native environment
is exactly `{PATH:"/usr/bin:/bin",LC_ALL:"C",LANG:"C",LANGUAGE:"C",TZ:"UTC"}`.
Independent command rows execute `createExprCommand().execute` through the frozen
helper, **not Shell.exec**: argv `["+",subject,":",pattern]`, cwd `/`, empty memory
FS, exact virtual env `{LC_ALL:"C"}`; stdin acquisition throws. Native argv there
is `[subject,":",pattern]` for both binaries. Author rows instead use Shell.exec
with each argv word single-quoted, explicit env `{LC_ALL:"C"}`, default cwd `/`,
empty memory FS and default empty stdin; the accepted Shell adds exported
`PWD:"/"`. Their native GNU argv includes `+`. These env facts are source-derived,
not a newly instrumented env trace. Match spans are separate RegexExecutor byte
requests, not instrumentation of the command's internal invocation.

Patterns below are literal JSON (backslashes decode once):

```json
{
  "P": "\\(a*\\)*\\1",
  "F": "\\(a*\\)\\{0,2\\}\\1",
  "Q": "\\(a*\\)\\{2\\}\\1",
  "D": "\\(a\\(b\\)*\\)*\\2",
  "E": "\\(a\\(b*\\)\\)*\\2"
}
```

All spans are **half-open BYTE offsets**; all subjects here are ASCII. In command
columns, entries are `stdout hex / status`, including the terminating `0a`.
**Every listed command stderr is empty.** `—` means not captured in that cohort.
I = independent frozen run; A = author frozen run, separately qualified.

| Cohort / row | Subject / pattern | Candidate whole / first capture | Candidate command | GNU command | Apple command |
| --- | --- | --- | --- | --- | --- |
| I / history-four | `"aaaa"` / P | `[0,4)` / `[2,3)` | `610a / 0` | `61610a / 0` | `610a / 0` |
| I / history-six | `"aaaaaa"` / P | `[0,6)` / `[4,5)` | `610a / 0` | `6161610a / 0` | `610a / 0` |
| I / original/a | `"a"` / P | `[0,0)` / `[0,0)` | `0a / 1` | `0a / 1` | `0a / 1` |
| I / original/empty | `""` / P | `[0,0)` / `[0,0)` | `0a / 1` | `0a / 1` | `0a / 1` |
| I / original/aaa | `"aaa"` / P | `[0,3)` / `[1,2)` | `610a / 0` | `0a / 1` | `610a / 0` |
| A / finite-optional | `"aa"` / F | `[0,2)` / `[0,1)` | `610a / 0` | `0a / 1` | — |
| I / mandatory-nonempty | `"aaa"` / Q | `[0,3)` / `[3,3)` | `0a / 1` | `0a / 1` | `610a / 0` |
| I / optional-child-empty | `"aaa"` / E | `[0,3)` / `[2,3)` | `610a / 0` | `610a / 0` | `610a / 0` |
| A / nested-stale-backref | `"abab"` / D | `[0,4)` / `[2,3)` | `610a / 0` | `610a / 0` | — |
| I / descendant-retention | `"abaab"` / D | `[0,5)` / `[3,4)` | `610a / 0` | `610a / 0` | `0a / 1` |

**Native expr whole/capture offsets were not observed in these command records.**
Do not turn returned text into invented native offsets. Curie's separate public
libc probe supplies whole/first spans for P/a `[0,0)/[0,0)`, P/aaa
`[0,3)/[1,2)`, P/aaaa `[0,4)/[2,3)`, and Q/aaa `[0,3)/[1,2)`; those are **libc
observations**, not GNU or Apple expr register traces. Exact helper argv, JSON
stdout bytes, empty stderr, status 0 and identities are retained in the manifest.
Its helper hash is `f1b379d41ce6979ceadf1a378f0a5b0b6c28e0e52ca65a4839a3ca22d0706723`;
it linked Darwin libSystem 1356.0.0, not an independently hashed shared-cache
library or a second proven independent Apple engine. No native spans for F/D/E
are fabricated, and no malformed internal span is treated as a successful match.

## What actually isolates each choice

**1. FIRST completed DFS at equal whole extent (candidate line 342).** P/aaaa
is minimal by subject length **within P under the adopted no-optional-tail
reading** for different positive last-capture lengths: `s + 2k = 4` permits
`k=1,s=2` and `k=2,s=0`; lengths below four do not. Witness `[aa][a]` plus reference
`a` gives whole `[0,4)`, first capture `[2,3)`; `[aa]` plus reference `aa` gives
the same whole and first capture `[0,2)`. These are derivations, not recorded
iteration traces. The actual candidate's first capture proves the first
*outcome*, not which earlier partition it traversed. Source inspection explains
equal-whole retention as DFS. GNU's `aa` is an external counterexample to calling
that outcome universal compatibility, not proof of a normative ordering.
P/aaaaaa repeats the distinction (`a` versus `aaa`); it adds no universal proof.
An exact alternative decision is **choose `[0,2)` rather than `[2,3)` for
P/aaaa**, while retaining P/aaa `[1,2)`. A general history comparator still needs
its own specified ordering; “maximize final registers” is not established here.

**2. Optional-empty admission/overwrite (lines 375–377).** The smallest frozen
whole-span discriminator is P/a: the candidate admits sole empty participation
at zero, but rejects productive `[a][]` plus empty reference, which would have
whole `[0,1)` and first capture `[1,1)`. Both command outputs would be `0a / 1`:
**the command alone cannot test this rule**. P/empty separately establishes
successful empty participation, not an absent capture/no-match conflation.

F/aa is the shorter frozen **command-visible** optional-tail example: productive
`[a]` plus reference `a` yields the recorded `[0,2)/[0,1)`. Allowing optional
`[aa][]` introduces a competing `[0,2)/[2,2)` outcome (`0a / 1`). GNU's actual
empty tuple is compatible with that alternative, but neither proves that history
nor isolates its internal cause; admitting a path does not force it to win a tie.
Under the adopted prohibition, the productive outcome is forced for F/aa.
Thus this is a concrete compatibility boundary, **not a newly confirmed GNU bug**.

Do not overcorrect to “never empty after input advanced”: Q/aaa admits required
`[aaa][]` and returns `[3,3)`, while `[a][a]` plus `a` also spans three and remains
an unresolved history choice (Apple/libc select `a`). E/aaa supplies the nested
counterexample: each outer `a` consumes input, while child `b*` matches empty;
the completed group-2 empty enables the reference. Its first-capture-only record
does not expose group-2 offsets, but successful whole length three requires that
participation. Progress must belong to the **current repeat activation**, not
the whole match or its parent. Rejecting those required/local empties changes
these actual frozen cases. No general nested-empty policy is proved.

**3. Descendant retention versus clearing (line 370).** D/abab is an existing
author-frozen **four-byte minimum for retention-needed success in this pattern**:
the earlier outer iteration needs `ab` to complete group 2 as `b`, a later outer
iteration needs `a` without group 2, and the reference needs another `b`.
Witness `[ab][a]` plus retained `b` gives whole `[0,4)` and first `[2,3)`;
group 2's earlier `[1,2)` is **deduced**, not protocol-observed. Clearing group 2
at the second outer entry instead makes that reference absent; no other anchored
prefix of this subject satisfies the pattern under that clearing rule, so its
alternative result is **no match**, not an empty successful capture.

Independent D/abaab adds a second skipped descendant: `[ab][a][a]` plus retained
`b`, whole `[0,5)`, first `[3,4)`. It distinguishes retention across multiple
iterations without a required/optional-empty child match: `b` itself is
nonnullable. Candidate/GNU print `a`; Apple prints empty. That Apple tuple is
consistent with clearing/no-match, but does not identify Apple's algorithm.
The exact policy choice is **retain last completed descendant until it is
re-entered**, or **clear it when its enclosing repeat starts a new iteration**.
This evidence separates them; Curie's narrow P judgment does not select one.

## Bounded handoff recommendation and unresolved work

Retain the narrow P/aaa decision and keep all three general choices unpromoted.
If an explicitly provisional profile is requested, name its choices (FIRST DFS,
activation-local optional-empty suppression, retained completed descendants),
rather than advertising POSIX/GNU-wide acceptance. No new decision is needed to
preserve the narrow result; changing the alternatives above needs explicit scope.

- **State/work ownership:** admit every initial/fork state and vector before
  creation; charge traversal/comparison work and cumulative history allocation.
  Any future history comparator must be budgeted too. Exhaustion refuses the
  match, never returns a best-so-far semantic result. Logical units are not RSS.
- **Iteration ownership:** static repeat entry plus dynamic activation, parent
  iteration, ordinal, position and finite required count remain branch-local.
  Each backward edge consumes input or advances a bounded required count; a sole
  optional empty exits. A sibling/ancestor's progress is not this frame's progress.
- **Capture ownership:** separate absent/open/completed; opening invalidates
  completion. Fork mutable vectors, share only immutable history prefixes.
  Do not confuse an iteration's recorded absence with a retained completed
  register. A future clear policy must update reference lookup consistently;
  appending an absence event alone does not implement it. Publish only completed,
  ordered byte spans; the first-capture protocol does not certify all descendants.
- **Lifetime:** retain existing cancellation, worker retirement, awaited close/
  dispose and refusal contracts. Historical 137 scoped checks and resource
  boundaries remain evidence of that isolated run, not a new gate or proof of
  every history path. No opaque host-work preemption claim follows.

Existing author, independent and Curie read-only seals pass; exact fresh check
receipts are in the manifest. Run `node tests/commands/expr-stress/repeat-policy-handoff-20260827/verify.mjs`
to verify this handoff without executing engines/native oracles or writing data.
Only this new owned directory is written. No scratch, native child, worker or
server was created for semantic execution; verifier Git/Node children are awaited.
The owned seal detects new files **and empty directories** and rejects symlinks;
source bindings check listed files only, not an append-proof whole repository.
No web/normative re-research, broad corpus, engine change, promotion, full parity,
superiority, or 72-hour completion claim is made.
