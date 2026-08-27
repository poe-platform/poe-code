# Independent post-READY verification

**Final status: RED SOURCE-GUARD CHECKPOINT; no current-worktree acceptance.**
All recorded test/comparison runs used stable frozen imports, but final sealing
found that the imported `src/commands/filesystem.ts` had subsequently changed
in commit `37e19b7` (`fix(cp): compare complete scoped identities and preserve
caller aborts`). This file is outside verifier ownership and was not modified
or reverted here. The root must coordinate a fresh dependency freeze/replay
before accepting the current tree. No additional tests or native probes were
run after discovering this movement. Earlier raw results remain immutable,
valid observations of their recorded source epoch, not certification of the
changed tree.

- Expected frozen dependency SHA-256:
  `a7280538f4168ae40939a56181feac8bac06fdf071fe566293f77425bce678d1`.
- Observed dependency SHA-256 at failed sealing:
  `da0f1f25acd63906cd42153b0ae8068b05ccc748c598b979ade42ca599e7f731`.
- Final audit HEAD: `5ce557d1ce7f8ca00c95a670ce3647409953db05`.
- Guard evidence: `post-ready-final-audit.json`; all 35 recorded imports matched
  the freeze during the runs, while this one dependency differed at final seal.

Verified August 27, 2026 UTC against frozen source
`21a6b9149e3a0e35e14f1c740860971f08053686`. This is the resumed fresh leaf
verification, not the earlier `b2d202a` review. No production, author-test,
contract, root-manifest or other worker files were changed. The prepared
`c440c1a` cohort, expectations, fixtures and harness remain byte-identical.

## Actual results

| Independently executed cohort | Result |
| --- | --- |
| Frozen independent holdouts (57 differential/policy + 15 host) | **69/72**, 3 failures |
| Unmodified author invocation cohort | **130/132**, 2 failures |
| Previous file-entrypoint cohorts | **58/58**: 41 current author + 17 prior independent |
| Selected existing targeted regressions | **121/121** |
| Fresh global `tsc --noEmit` | Exit 0 |
| Fresh build `tsc -p tsconfig.build.json --noEmit` | Exit 0 |

No skips, TODOs, cancellations, process deadlines, capture overflow or source
guard invalidations occurred **during the recorded runs**; the subsequent final
source seal failed as stated above. The final two typechecks were repeated after
adding the frozen-comparison tools and both again exited 0. The author's
300-regression claim is **not** adopted as our result: our explicit selected
cohort is 121. Different cohorts are not collapsed into one acceptance fraction.

All 50 predeclared bounded invocation-semantic rows, four retained strict-file
policy rows and 15 host-boundary rows pass. The whole holdout result remains
**69/72**, not 69/69. No new defect within the bounded implemented invocation
contract was observed. This does not erase any broader-compatibility failure,
establish full Bash/POSIX behavior, or claim superiority or 72 hours of work.

## Preserved failures and exact raw comparisons

Three frozen independent failures remain unchanged:

1. `sh-posix-special-assignment`: source
   `sh -c 'value=before; value=after :; printf "%s\n" "$value"'` returns status 0
   and `before\n`; both native profiles produce `after\n`. This is the explicitly
   documented broader POSIX special-builtin assignment limit.
2. `path-command-v`: `PATH=tools; command -v invtool`, with executable
   `tools/invtool`, returns 127 because `command` is not implemented. Both native
   profiles return 0 and `tools/invtool\n`.
3. `path-type`: `PATH=tools; type invtool` returns 127 because `type` is not
   implemented. Both native profiles return 0 and `invtool is tools/invtool\n`.
   These introspection builtins were already absent at the earlier checkpoint;
   this is not a newly supported resolver incorrectly reporting PATH failure.

The unmodified author's two losses are bash/sh `stdin-read-one-byte`, using
`-s` with `read -r -N 1 value\nZprintf "[%s]\\n" "$value"\n`. The virtual
read implementation rejects unsupported `-N`; the following `Zprintf` is then
an unknown command, leaving status 127 and no stdout. Primary 5.3 produces
`[Z]\n` and status 0. Historical 3.2 also rejects `-N`, but has different raw
diagnostics. Inspection of the earlier accepted `f4d9d2d` runtime confirms its
read parser likewise only admits `r`, `n` and `d`. These are real preexisting
unsupported guest semantics, not successful execution or new cursor bugs; they
are also not the five separate pending first-read lifecycle cases.

| Whole frozen raw cohort | Exact byte/status/effect matches | Losses retained |
| --- | --- | --- |
| Our 57 rows, actual GNU 5.3 roles | **48/57** | 9 |
| Our 57 rows, actual historical 3.2 roles | **46/57** | 11 |
| Author 104 rows, primary 5.3 lookup parent | **98/104** | 6 |
| Author 104 rows, historical 3.2 lookup parent | **82/104** | 22 |

Our raw losses include all three scope failures, all four strict execution
policy differences, and two primary/four historical diagnostic dialect/context
differences. The policies reject headerless direct execution, unsupported
interpreters, binary and invalid-UTF-8 source. Semantically checked diagnostics
retain their original complete bytes; they are not normalized for raw comparison.
All individual rows, expected/actual bytes and differing fields remain in
`post-ready-raw-comparison.json`, including every matching row and every loss.

No new invocation native capture was made. Our existing role-rendered fixtures
actually select each pinned profile's child interpreter; their rendered headers
are intentionally **not byte-identical**. The author's frozen PATH fixtures use
`#!/bin/bash`, so those children are 3.2 even under a 5.3 lookup parent. This
provenance limitation is retained, not relabeled. The comparison reuses the
72 captured holdout results and runs 104 author virtual observations once for
comparison against both complete frozen author profiles (208 comparisons).

The selected unmodified descriptor regression separately runs **17 existing
live `/bin/bash` 3.2 references** using its existing sanitized temporary-directory
helper, two-second subprocess timeout and the guarded outer process group. These
are not new invocation captures or any blocked lifecycle/NUL probe. Their exact
commands are defined in `tests/shell/descriptor-inheritance.test.ts` and its
unchanged `bash-bugfix-helpers.ts`; no modern-profile provenance is claimed.

## Freeze, import proof and cleanup

| Frozen shell source | SHA-256 |
| --- | --- |
| runtime.ts | `6a86339d76e764031a26671586842467a40dc989895589ab416306e655496145` |
| parser.ts | `b7f4070c006221c44d822f8a6c45f24f896942ea8e7bef4290a936bb616eb2d6` |
| input.ts | `03fce524aef5c5fc87b65c72adefc2dd86e92b0c702d675719ebb0770b876314` |
| shell.ts | `f4b9e55515e00ef456d48f6a3da60cf5b19b5af7fb91c700c151bd92726f6bb7` |

`post-ready-handoff-audit.json` checks 101 committed source/cohort files before
execution. Raw runs record actual `.ts` load hooks, not import-name assumptions:
27 distinct source modules for holdouts and 35 for the author/regression batch.
Before/after imported hashes and all-source change lists are preserved. Final
sealing compared every observed source import with the committed freeze, found
the changed filesystem command dependency, and verified author/prior test files
and all frozen cohort files remain unchanged. It did not waive the changed
dependency merely because the shell files themselves remain frozen. The initial
sealing assertion and full subsequent capture are preserved in the final audit.
No product output was emitted by TypeScript.

All 81 recorded resumed outer/holdout process groups are checked absent in final
evidence. Unmodified nested test helpers completed their own bounded children.
No readiness watcher was started or left running during this resumption. No
pending first-read, head-zero, frozen remote audit, paused NUL, source/dot/eval,
whole-default-suite or Curie-comparator cohort was run.

## Reproduction and immutable evidence

From the repository root, with the same frozen source and READY marker:

```sh
node --import tsx tests/shell-stress/invocation-modes/verify.ts fresh-holdouts.json holdouts
node --import tsx tests/shell-stress/invocation-modes/verify.ts fresh-regressions.json regression
node --unhandled-rejections=strict --import tsx tests/shell-stress/invocation-modes/compare-frozen.ts fresh-raw-comparison.json
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit
```

Expected runtime/comparator exits are nonzero because retained failures are real.
`compare-frozen.ts` intentionally uses the immutable original post-READY holdout
capture for our rows and fresh virtual observations for author rows; it does not
silently replace an oracle. The recorded fully guarded comparison/typecheck
invocation is in `post-ready-supplement-evidence.json`. Evidence writers reject
overwrites. Raw TAP retains all failed assertions; hex captures preserve bytes.
An exploratory attempt to parse TAP-escaped diagnostic JSON directly failed;
the durable comparator instead decodes its recorded `stdoutHex` bytes. This is
transport decoding only, not a fixture/expectation change or diagnostic cleanup.
