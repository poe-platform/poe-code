# Independent ssconvert conversion lifecycle stress QA

Executed 2026-09-19 by the required different agent after initial implementation. Root retains engine, command dispatch, exports, Safe Bash integration and Git ownership. This review owns `packages/ssconvert/src/conversion/independent-stress.test.ts` and the validated cleanup repair in `packages/ssconvert/src/io/publication.ts`.

## Reference and procedure

Use the captured Gnumeric 1.12.61 profile and exact source SHA-256 in [the lifecycle oracle evidence](ssconvert-lifecycle-oracle-qa.md). Native utilities remain a separate QA oracle; this review does not spawn native utilities or add a product fallback. Unit cases use original empty-sheet workbooks, text bytes, memfs and explicit injected capabilities. They do not write host files, query an LLM or change global environment state.

Run the maintained package test and lint routes. Root separately runs the explicitly selected uncached build closure and cross-workspace integration checks. The direct Vitest run is a TDD diagnostic, not a replacement for maintained package validation.

## Validated regression and repair

Before repair, `shares completion of overlapping owned cleanup without double unlink` failed with `ENOENT` when output abort and the registered invocation cleanup simultaneously unlinked the same private temporary file. The reproducer gates the injected unlink without a timer and waits for both cleanup callers. The repair shares the cleanup promise and closes temporary-file write/close admission before unlink begins. Both callers now await the same completion; exactly one unlink occurs. Genuine cleanup rejection remains observable, rather than being suppressed.

The first exploratory split runs failed because the test incorrectly supplied resource URIs directly to a path-based publication helper. Correcting the fixture to use the actual `createResourceIO` composition resolved those failures; no product change was justified by that fixture error.

## Verified coverage

The independent suite has 24 passing cases:

- SDK and CLI infer the same canonical local URI output for dot segments with query, localhost with fragment, percent-encoded space and dotless input. The dotless output appends `csv` without a dot, following the reference URI extension-pointer behavior.
- Unknown extension exits 2 before invalid forced importer or missing input, without publication acquisition or namespace changes.
- Owned cleanup is registered before the first filesystem acquisition; cancellation preserves the exact cancellation reason and removes the private temporary file while retaining existing destination bytes. Cleanup invoked synchronously during ownership registration prevents every filesystem acquisition; cleanup during admitted lstat drains that acquisition and prevents temp creation; cleanup during an admitted exclusive create waits for it and retires the resulting temp.
- Concurrent output and invocation cleanup share settlement and do not double unlink; pending cleanup prevents write and close admission. Exact unlink failure identity reaches every cleanup caller without retry or suppression.
- A hardlink output replacement preserves the input alias inode and bytes, replaces the output entry and restores output mode.
- A relative symlink remains a symlink and its target receives the published bytes.
- Injected rename EACCES retains complete private temp bytes and existing destination bytes, matching the measured publication profile.
- Injected write ENOSPC removes private temp bytes and preserves the existing destination, matching the measured failure profile.
- Injected post-rename chmod EACCES returns success silently for existing and new destinations, retaining the temporary file mode0600, matching the separately measured native follow-up. Opaque chmod errors retain identity and cancellation wins over an EACCES-shaped host error.
- Compound goal/solve/tool/resize/recalc/range requests call the injected stages in source order: duplicate tool properties use the last value, malformed tool properties diagnose before the tool, sheets resize in reverse order, a resize failure diagnoses and proceeds, explicit/automatic recalc both run before a terminal range failure without publication.
- The aggregate split byte limit applies across outputs, preserving already published files and removing the current unpublished temp on failure.
- Repeated native-template destinations publish serially, with the final sheet winning and each artifact accounted for.

Aggregate byte admission and cancellation cases verify product capability guarantees; they are not native cancellation or resource-budget differential passes. URI cases exercise the actual shared engine and resource-I/O composition. Alias and publication cases reproduce the corresponding reference observations using memfs; memfs does not qualify a real host provider's permission enforcement.

## Checks and remaining boundaries

Initial focused TDD run: one real cleanup failure, six passing cases after correcting URI fixture composition. After repair and additional cases, focused direct run: 13/13 passed. Maintained package checks are recorded below after completion.

No new filesystem-syscall interpretation of the `operations` limit was introduced. Its declared scope is requested transforms, options and merge inputs; ordinary conversion with operations zero remains legitimate. Sheet cardinality and aggregate output bytes bound split output work.

Unmeasured or unsupported cases are not passes: graph/clipboard rendering fidelity; native goal-seek numerical/dialog semantics; resize/recalculation numerical fidelity; arbitrary binary-format losses/warnings; native PID/time diagnostics; provider permission enforcement; symlink cycles/remote alias semantics; crashes or external races during publication; late host failures after cooperative cancellation; unmeasured chmod errno compatibility; all codec write failures and real full-filesystem exhaustion. Existing mode implementations and repairs remain root-owned and must receive root validation. The optional byte-write path without `openOutput` retains its explicitly injected host publication policy and does not establish libgsf publication compatibility.

The product does not gain host file authority, native execution, implicit network access, or stronger atomicity/rollback guarantees from these tests. No README, export, integration, Git, push or publishing action was performed by this reviewer.

Initial maintained package run while root TDD/engine changes were in progress: 376 passed, four failed (three new lifecycle regressions plus the historical graph unsupported assertion). Initial maintained lint observed two undefined `publishBytes` references in the in-progress root engine. These are failed intermediate checks, not verified passes; final checks will replace neither nor suppress this evidence. Root unit-runner selection `npm test -- --workspace=@poe-code/ssconvert --no-cache` was rejected as unsupported, so the actual maintained fresh package lifecycle was used: `npm test --workspace=@poe-code/ssconvert`.

Initially recorded publication chmod mismatch was subsequently measured by root native QA and repaired after two new failing in-memory regressions (existing and new output). The repair ignores only measured errno EACCES after checking cancellation; other errno/opaque host failures remain observable and unmeasured. Native owner/group restoration remains unsupported by this VFS contract. See the follow-up section in the linked oracle evidence for exact provenance and effects.

Final reviewer-maintained lint: `npm run lint --workspace=@poe-code/ssconvert` passed (ESLint, product TypeScript and test TypeScript). A fixture exact-optional property error discovered by the intermediate lint was corrected without changing test semantics. The independent stress suite remains 13/13 passing. Further whole-package reruns now pass historical parser controls and initial lifecycle regressions; root introduced a new reverse-resize TDD case during the final reviewer run, which was still failing while implementation was in progress. Root owns final cumulative package, build and integration verification; this reviewer does not report the partial whole-package run as a pass.

## Follow-up final verification

Root supplied measured native chmod EACCES behavior and requested acquisition-closure stress. Before repair, the two chmod cases failed by propagating EACCES. Before the acquisition repair, synchronous ownership cleanup allowed later temp creation, and cleanup during a deferred lstat incorrectly settled before acquisition finished. Publication now closes acquisition admission and shares an acquisition completion barrier; cleanup waits for admitted acquisition and retires any newly acquired temp. A third acquisition case verifies a temp already created by an in-flight exclusive write is retired before cleanup settles.

Final fresh maintained package lifecycle `npm test --workspace=@poe-code/ssconvert`: **390/390 tests passed across28 files**, including **20/20 independent stress cases**. Final maintained package lint `npm run lint --workspace=@poe-code/ssconvert` also passed, including ESLint and product/test TypeScript checks. Root retains uncached closure build and cross-workspace integration ownership. These final results supersede the interim failing package runs without erasing their evidence.

## Final source-stage follow-up

Root authenticated the finite native tool-test dispatch; the compound fixture now uses release-supported `moving-average` and explicitly checks the injected analysis tool identity. The original mock name `original` was not a valid native tool name; only that mocked name changed, preserving every property/diagnostic/stage assertion.

Four additional independent cases verify the new range goal-seek callback preserves exact cancellation and prevents subsequent solve/save, invalid image resolution is diagnosed after automatic recalc and before rendering/resource acquisition, canonical local file query output still resolves its exporter, nonsplit range overrides explicit selection, and split range preserves each selected output sheet. These are injected stage/control-flow passes, not native numerical solver or image rendering passes.

Fresh maintained package test after this follow-up: **397/397 passed across28 files**, with **24/24 independent stress cases**. No new runtime repair was justified by these four cases. Root owns remaining build/export/integration verification; boundaries already stated above still apply.

Final source-stage follow-up maintained lint also passed: `npm run lint --workspace=@poe-code/ssconvert` (ESLint and product/test TypeScript). Final focused independent rerun passed24/24 after separating ordinary canonical-query output from the split-template fixture.
