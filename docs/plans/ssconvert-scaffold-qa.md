# ssconvert scaffold verification

Execute from the authorized poe-code worktree. Root owns package/public exports
and Git. Do not push, publish, edit any README, or overwrite existing audit files.
Temporary evidence belongs in out/ssconvert-scaffold and is removed after findings
are recorded. The existing reference-profile.json is historical captured evidence
with explicit incomplete gates; do not treat its source census as runtime coverage.

1. Inspect root/scoped AGENTS.md, workspace manifests, status and export/build
   declarations. Preserve pre-existing edits.
2. Download the official 1.12.61 source archive only to out, authenticate SHA-256
   2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and inspect
   src/ssconvert.c parser and dispatch. Native binaries remain separate QA oracles.
3. Before implementation run original in-memory/memfs contract cases for shared
   CLI/SDK writer dispatch, scalar versus repeated options, ordered updates,
   producer buffer reuse, budgets and unsupported-operation namespace effects.
4. Have a different agent stress the implemented engine with failing regression
   tests before repairs. Inspect cleanup admission/drain, cancellation identity,
   cleanup failure aggregation and option-value validation.
5. Run uncached maintained domain build/test/lint and cross-workspace Safe Bash
   build closure, selected maintained command tests, source/test typechecks,
   integration/build runner checks and focused ESLint. Verify both root public
   domain and Safe Bash exports with built public consumers. Avoid unit native
   subprocesses, filesystem writes and LLM calls.
   Execute original public-SDK negative controls for cross-engine ownership,
   exact binary byte limits, disposal and original abort-reason identity. Supply
   a reused foreign-realm byte producer, foreign workbook/output bytes and a
   foreign abort reason through explicitly configured trusted capabilities;
   inspect retained snapshots and exact bytes. This checks interoperability,
   without claiming VM isolation or checkpoint/replay support.
   For shared root export/build wiring, run full `npm test -- --no-cache`,
   `npm run lint` and `npm run build`. Finish build/write stages before held-input
   guarded checks; retain failed attempts and report skips/TODOs independently.
   A focused rerun never completes a failed or incomplete full gate.
6. Capture a CLI-visible response with the maintained screenshot tool into out,
   inspect its image and record actual coverage. This is ad hoc visual inspection,
   not a screenshot test. An opt-in virtual command cannot be invoked through an
   unrelated root poe-code command; use a host harness bound to the actual plugin.
7. Record counts, verified routes and every unsupported/unmeasured operation in
   docs/ssconvert/scaffold-verification.md. Preserve exact failing assertions;
   do not mark unsupported profiles or unavailable oracles as passes.
8. Confirm no README was created or edited. docs/ssconvert/usage-draft.md is a
   proposed complete usage/config/environment draft, not package documentation
   delivery. README publication remains unresolved pending explicit permission.
9. Remove only task-owned out scratch, recheck the final diff/status and report
   local implementation separately from Git/remote/release delivery. No push or
   publication is authorized for this task.
