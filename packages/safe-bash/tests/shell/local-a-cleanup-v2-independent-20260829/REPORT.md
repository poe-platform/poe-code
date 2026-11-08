# Independent local-a cleanup v2 review

## Verdict

The v2 branch delta resolves the three prior branch-cleanup findings (finite SOURCE/PURE acceptance of those repairs). Overall local-a SOURCE/PURE readiness remains **HOLD** for the directly required internal preparation acquisition described below. No production files or composition inputs were changed. Original review `42530f2839dccd98a63e6d14d32354ad1022462f` and its failures remain immutable.

Source: `faff3d1b56b841594768e476700209e1d2bca734`; evidence: `2e79988a91dcff82515771f5be4932b19429dad2`, `tests/shell/local-a-cleanup-v2/HANDOFF.md`. Runtime SHA256: `bff86fcfc7f59b4f0a42a304edf72b9b69027b508c532b1401bea0628d201d2b`. Exact baseline prefix/suffix equality confines this source delta to the generic indexed-local branch.

## Finite observations

- Exact author replay: **11/12**, preserving C05 failure. Four independent novel groups: **3 PASS / 1 FAIL**. One PURE helper; no product classes were imported or executed.
- N01 independently isolates C05: the injected `store.publish` failure occurs after its callback attaches the saved state to `locals`. Discarding that attached state would destroy restoration ownership. Eight earlier cuts discard once; this publication cut correctly discards zero times. C05's unconditional discard expectation is a fixture defect, not evidence that this branch repair fails. This does not establish complete runtime publication atomicity.
- N02 preserves borrowed typed saved state for both existing-local and prefix-assignment cases when publication fails; no redundant preparation or discard occurs.
- N03 independently attempts all four cleanup stages and retains raw primaries `undefined`, `null`, `false`, and `0`, with four ordered, identity-preserved secondary reasons.
- N04 demonstrates the directly required preparation gap using the exact new branch and unchanged `prepareVariable`/`discardVariable` fragments, with finite reservation doubles. With 64 metadata bytes available, owner creation charges 64 successfully, then hold admission requires another 64 and refuses. One owner is created, zero are closed; caller discard runs once but has no registered typed record to reach. The raw budget reason survives.

## Smallest blocking fix

At pinned `src/shell/runtime.ts:1238`, `ArrayOwner.create` succeeds before the fallible `store.owner.hold()` at line 1239, which is outside the helper's `try` at line 1241. Registration is later at line 1249. `discardVariable` returns for absent records at lines 1269–1270. Actual source reservation amounts are in `src/shell/arrays/ledger.ts:166` and `src/shell/arrays/ledger.ts:209`.

This helper defect predates v2, but the new generic local-a branch directly invokes it: it is not an unrelated policy objection. The narrow correction is to place hold acquisition inside the owner's cleanup boundary and make final hold release conditional, so an acquired owner is retired if hold admission refuses. This requires only the implicated helper scope, not parser, public API, dependency, or broad array changes. No fix is implemented here.

The counterexample is isolated SOURCE/PURE evidence, not execution of a real ledger/owner or proof of permanent process-wide leakage. Eventual parent-owner cleanup may reclaim resources; the demonstrated gap is retirement at the failed preparation boundary. Full binding atomicity, runtime restoration, budget epochs, and actual R17 remain unqualified.

## Composition and authority

No final-composition update or build freeze: the previously reconciled 323-input projection remains unchanged until the required source fix is accepted. Accepted PUBLIC README selection, 115 typed tool inputs, and exclusion (not deletion) of 40 foreign extras remain intact. K08/CORE/publicNode/B35/PIPE selections are not overwritten. Original PIPE 75 PASS / 3 FAIL remains historical evidence, not repaired-runtime acceptance.

No Shell, Worker, compiler, npm, install, network, or native/product execution. No author-source edits. This review supplies no build or actual-runtime GO.

## Receipt and accounting

`RESULT.json`: 11,766 bytes, SHA256 `6e7f9f489007c542084a638bf1dc54e1e4ba538fa891737c6c4ef39315f8db35`. `FRAGMENT-BINDINGS.json` authenticates individual source/evidence blobs and fragment extraction. `SOURCE-READINESS.json` records the withheld composition update. Raw capture and original failed replay are preserved.

Invocation accounting through planned publication: 19 known OS starts of 24, conservative peak 3 of 3, one PURE helper of two allowed. Direct capture precedes child execution. The receipt records bounded finite work/capture accounting with publication reserve; the grant is 24 MiB capture / 128 MiB logical work including publication, not a physical Git/RSS quota. Publication uses an explicit own-file list and compares foreign staging immediately before and after the commit.
