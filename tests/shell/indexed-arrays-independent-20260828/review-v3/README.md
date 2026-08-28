# Array design response review — 2026-08-28

**Design-only, not implementation acceptance.** This is additive to independent
`0d70a9d4`; none of its documents, native questions or recorded outcomes change.
No product import/execution, native launch, build, package test or XAN action is
authorized by this review. The synthetic controls below are proposals for later
mechanical proof, **not product passes**.

## Binding and chronology

Reviewed author `c54db6863aa96c537778cf4dc85bd104a3155e90`, specifically
`addendum-v3/DECISIONS.md` and `PEAK.json`, and Locke's native artifact review
`d4f3d9f91a8549ebdd3a222fbac04d379c6ce770`. `audit-static.mjs` pins their bytes.
Source R is LET `c26892c3a1a419311c9cf46a6c2976e696e00624`; parser B is
`5137a74ec855a32d8a8860eb66b62eb44d11e290`. Accepted DOTGLOB runtime
`d2502aae3c8458e0ac92662f2af07e7f9fc3923a` supplies a **read-only drift check**:
the scalar parameter-value branch, substring helper and pattern helper are each
byte-identical to R. No assertion about other moving-HEAD source is made.

Root's later acceptance of DOTGLOB supersedes the historical v3 packet's
“not accepted” description; that packet stays immutable. Accepted selected
composition `37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e` and 846-member package
`b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa` remain
**carried root qualifications**, not package revalidation here. A preliminary
attempt to resolve that selected-tree ID through this checkout's object database
failed (git status128; object unavailable here); no HEAD fallback was used.
The source-section comparison uses the explicit committed runtime instead.

## Disposition

| Finding | Current classification |
| --- | --- |
| G1 | **Policy closed by root**, not tested: staged target; certain later overflow before all RHS in the assignment; uncertain demand after its RHS once; no-op append validates; existing escaping/caller priority, then readonly before stale. |
| G2 | **Design feasible; mechanical certificate still required.** Finite watches/tickets and prepaid restoration remove the original unbounded-history objection. Resolve shared-ticket reservation and observer retirement details in `DECISIONS.md`. |
| G3 | **Policy conditionally closed by root.** Whole-state epoch/no retry is coherent; every mutation path, including accepted DOTGLOB, must participate. Completeness remains a future source-proof obligation. |
| G4 | **Claim closed by root.** Existing phase E is outside private caps; only cooperative loops checkpoint. No RSS, combined-live-memory or hard primitive-preemption claim. Array-derived allocations must not be relabelled E. |
| G5 | **Feasible release schedule, not yet mechanically closed.** Need an explicit dependency/refcount trace, watch detach, allocation-free restore, overlapping close and finite failure-path proof. |
| G6 | **Declared arithmetic is reviewable; operational accounting remains conditional.** Seven equations are coherent; watch-slot widening, shared-ticket check order, per-reservation failure ordering and pre-mutation maximum recomputation need the narrow decisions below. The graph is not a universal peak. |
| G7 | **Effect phases largely specified, three boundaries need ratification.** Control/export/prefix/local/listing proposals are intentional project choices, not GNU conclusions. See phased table and same-value overlay caveat. |
| G8 | **Recommend root's element-zero alternative, pending approval.** Preserve only the 16 supported operator tokens plus scalar length/substring forms; retain lazy branches and both expansion paths. Explicit-index operators remain refused. Concrete splice vectors are proposed, not native observations. |

This closes the original policy ambiguity only where root has actually decided.
It does **not** say eight findings are implemented/verified or authorize a runtime
window. The remaining requests are precise refinements, not a new public API,
cross-exec cap, parser preflight relaxation or arithmetic fallback.

## Native evidence remains separate

Locke authenticated **16 observations: 14 exit0, 2 exit127 (N12/N15)**, not 16
passes. N13 returned assignment0 and only index1=`rhs-write`; the historical
candidate predicted stale failure1 with index0 plus old index2. Keep that
contradiction. N14 is substitution-local readonly, not concurrent parent mutation;
N16 shows native prefix shadowing, not effectful-prefix timing.

The five static supervisor gaps remain: absent-close settlement; final control
authentication; acquisition-before-registration; durable-row-before-count;
spawn-throw fabricating the close-observed field. Their failure paths were not
exercised. `STOPPED_FINAL_INTEGRITY` is retained; it is **not an observed escape,
copy violation or cleanup incident** and no later document seal cures it.

## Bounded static procedure

1. Commit this recipe, findings, literal vectors and audit before the audit run.
2. Run `node tests/shell/indexed-arrays-independent-20260828/review-v3/audit-static.mjs`.
   It only reads committed blobs through git, hashes source sections, checks the
   declared JSON arithmetic and inventories proposed controls. It neither imports
   source nor runs the proposed semantic/synthetic cases.
3. Preserve stdout/exit in an additive result file; a mismatch blocks the static
   conclusion. No retry with altered expectations. No package/native fallback.
4. A later implementation requires a separately bound candidate, executable
   mechanical traces and different review. These planned controls have no mutant
   kills, runtime counters, memory measurements or behavior acceptance yet.
