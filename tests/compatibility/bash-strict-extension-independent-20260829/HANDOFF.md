# Independent strict-extension review: HOLD

2026-08-29. One authorized actual cohort, no retries or production edits.

Post-run dependency update: Root qualified-accepted unchanged Unit3 source7a5c6200/derived74dfe691 via d7ec5e26 + cccd876f6615020a083adf7ee8c51befa553c2ba. This removes the dependency-acceptance hold only; candidate37e793ce and all results are unchanged. The preseal and raw receipts truthfully retain their then-provisional description. See `actual-v1/DEPENDENCY-UPDATE.json`; no acceptance counts are imported into this review.

## Exact binding

- Executable preseal commit: `b4b1f490b217dadfe01b215d9295fc0c89ed1ce1`.
- Execution seal SHA256: `2bc4c4a68efa8649b40f2421941f1c6ce9a6e33d8604487d5af0cded3d0e12c6`.
- Production: `9bb91c370a0672687399c0a9da4ce1b161f79615` (runtime only).
- Derived candidate: `37e793ce6dce48a958030e7cc86fa8315d0b112e`; exact 293 source inputs.
- Full 954-member package SHA256: `aaabea71bc3a7f1982a2ded488cbf5a905de304f0bc6f39302d15e293da8495f`.
- Source manifest SHA256: `9924773241f116d4cd5008fa7cd7f7fc3d95521f5e57b33299dbf2ed7cc2bf69`.
- Composition is accepted resolved Unit2 plus PROVISIONAL Unit3 plus this extension, not live HEAD or Node. Derived tree membership was reconstructed from authenticated tree entries; GitDB storage of the derived root was not required.

## Actual results

| Cohort | Source-built | Offline-installed | Physically moved | Total |
| --- | ---: | ---: | ---: | ---: |
| Unchanged current author cases | 212/212 | 212/212 | 212/212 | 636/636 |
| Independent novel cases | 15/16 | 15/16 | 15/16 | 45/48 |

Main: **681 PASS / 3 FAIL / 0 skipped / 0 unexecuted, of 684**. Each author 212 is 48 redirection + 50 accepted strict-mode + 67 provisional conditional + 35 extension + 12 array cases. The three failures are the same N14 identity in the three layouts, not three distinct root causes. Source-built means compiled JavaScript built from the frozen source tree, not execution of untransformed TypeScript.

Separate controls: six type groups passed, with exactly eight bound negative diagnostics per layout (24 total); six loaded mutants killed and six restored controls passed; two package-binding refusals passed. Restoration controls are not added to main totals. One strict build and one scripts-disabled offline pack/install succeeded. Default80/package composition is checked only as selected input, not independently reaccepted globally.

Coordinator and outer launcher both returned **exit1**, reflecting actual assertion failures. No final all-green claim. Raw results are `actual-v1/SUMMARY.json`, `actual-v1/evidence/RESULT.json`, and per-child captures. No original author failure was rescored.

## N14: raw diagnostic reason lost across transparent invocation

Frozen fixture: `novel.mjs:31`; exact outputs and load bindings are `actual-v1/N14-FAILURES.json` and `actual-v1/FINDING-BINDINGS.json`. It registers a command `guard` that registers owned cleanup and returns the exact Promise from `context.invoke("f", [])`. Function f expands an explicit missing-parameter error. The stderr sink rejects with numeric `0`. Cleanup waits on a fixture gate, then rejects with boolean `false`. The fixture always releases the gate in finally. No caller cancellation occurs in this case.

Expected under the reviewed sink/cleanup-preservation profile: reject with the original numeric0, one diagnostic write, cleanup finished before public settlement. Actual in all three layouts: reject with boolean false; **two diagnostic writes**; cleanup completed once before settlement. Exact observed order:

`registered → diagnostic → cleanup-enter → release → cleanup-finished → diagnostic → settled`

This is NOT a cleanup leak, early settlement, deadline, unhandled rejection, or the author initial X10 deadlock. The cleanup gate retired normally. The failed assertion reports `false !== 0`; the captured row independently records two writes, one completed cleanup, and `exactZero:false`.

Source-supported path in the exact frozen runtime:

1. `src/shell/runtime.ts:1635`: explicit parameter diagnostic rejection is wrapped in private `NounsetDiagnosticFailure`.
2. `src/shell/runtime.ts:975`: `invokeChild` unwraps that private wrapper into its public raw reason.
3. `src/shell/runtime.ts:2185`: the registered command transparently returns that invocation Promise; ordinary runtime-return observation carries cancellation provenance, not this diagnostic classification.
4. `src/shell/runtime.ts:1981` and `:1623`: the outer simple command wraps/unwraps raw0 as an ordinary execution failure.
5. `src/shell/runtime.ts:1649`: the generic diagnostic path writes again and suppresses the secondary sink rejection. The original fatal diagnostic classification has been lost.
6. `src/shell/cleanup.ts:51` stores cleanup false; `src/shell/shell.ts:189` only prioritizes a captured throwing outcome. Once runtime has converted the diagnostic failure to a status, `throwCleanupFailures` exposes false.

Actual loaded runtime SHA256 in each layout: `6e4ce527e907cdb9dc0c415806ed734ea7181f69624fce558a89796fe6debd49`. Frozen runtime source SHA256: `b14268b38f9a156c45cae80e6871a646086746654803c2b05eb0a7ec7438443b`. Internal steps above are SOURCE analysis, not instrumented event claims.

Author X07 covers direct falsy sinks; X09 covers a prior guard cleanup then a later direct expansion; X10c covers caller cancellation during invoked diagnostic/cleanup. Those all pass here. None is this non-cancelled transparent-invoke composition with an independent cleanup failure. N15 also confirms callerfalse wins over a genuine typed sink error and completes cleanup.

**Owner action:** Root/Curie should resolve this precise invocation-provenance boundary. If the preservation guarantee includes this runtime-owned transparent return, retain diagnostic provenance through that return without globally treating arbitrary plugin exceptions as fatal raw reasons. Preserve caller-first, genuine limits, and owned-cleanup ordering. No production fix is made here. This review does not prove that9bb introduced the underlying invoke-unwrapping behavior: that machinery is inherited, and no historical runtime was rerun. If Root determines the public invocation contract intentionally excludes this composition, adjudicate that exact boundary explicitly; do not silently weaken N14 or relabel its current failure.

## Capture, cleanup, bounds, and retention

- 42 recorded direct children, all actual close events; coordinator PID73661 and Python outer PID73658 retired naturally. The outer process-group absence check passed, no rescue signals or unknown retirement reported.
- 32 fixed internal-loader admissions/reservations and matching hosting-process bootstrap records; individual internal-loader exit events are NOT independently observed. No Regex Worker was created (0 births/0 exits).
- Known runtime PID population is 44 (42 direct + coordinator + outer). The initial exec-shell role is a conservative slot, not an additional independently observed PID after exec. Publication/admin process records are separate; reservations are not births. This is not a full transitive/global OS census or RSS proof.
- Direct child raw capture: 3,266,819 bytes; outer capture473 bytes. Actual retained scratch73,436,331 bytes at runner close. Coordinator53.079s, outer54.049s. Publication is separately timed against the fresh60min grant.
- Postguards reached and independently rechecked selected source293, moved package954, all109 executable inputs, original tool identities, and copied raw-capture equality. Runner additionally checked its restored mutant package and built-dist equality. These are not private/global-worktree guards.
- Retained work: `/private/tmp/strict-extension-independent-active-StDeJ9/strict-extension-independent-hPvdL0`; processes closed, fixtures/artifacts retained for owner diagnosis. No cleanup of foreign or historical roots.
- No native Bash/Git oracle, network, private engine, Node module, comparator, XAN, P2, or old gate executed.

## Preserved history and qualifications

Author initial X10 deadline/unknown suspended internal cleanup remains unchanged. Initial-v2 moved35-versus-stale33 dispatch failure remains exit1; the separately continued unrun tail is not an old rescore. Preparation retained parse/locator/count refusals, then an overly strict empty-foreign-index predicate; the latter was corrected to explicit owned-only commit with byte-equal foreign index before/after. Pre-product N02/N03/N12 fixture revisions preserve the original unrun bytes and use the actual fresh-State-per-exec boundary.

Preparation child journals and captures are in `preparation-v1-evidence`; initial editing-expression parse and first inline sparse-tree refusal have tool-transcript-only qualification, not complete external raw capture. No instruction plaintext was captured. No runtime results are inferred from those source/data controls.

Five OPEN design IDs remain **U27, S-U27-INPUT-UNIT-v1, S-U28-PRESENCE-v1, S-U31-STDIN-v1, E23-source-discard**. All native Bash observations remain UNRUN. Provisional nounset status1 and exact diagnostics are project-profile choices, not GNU invocation goldens. Aggregate/discard/nested recovery, full strict-mode/Bash compatibility, and Unit3 acceptance are not supplied by this review.
