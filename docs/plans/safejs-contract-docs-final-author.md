# SafeJS 11.0.32 checkpoint contract documentation — author handoff

## Scope and status

This is a documentation-only author handoff dated August 29, 2026, awaiting
independent review. It is not independent approval, a new runtime execution,
or a claim that every compatibility case passes.

The publishable scope is exactly this report and
`packages/safejs/CHECKPOINT_REPLAY.md`. The separately held proposal document,
`docs/plans/safejs-readme-skill-proposals-11.0.32.md`, is excluded from the
publication patch. Actual README files, the canonical skill template, and live
installed copies are unchanged. No permission to change them is inferred from
this author task. No source, test, executable QA file, package configuration,
or dependency file is changed.

## Baseline and retained evidence

The new clone is
`/Users/kjopek/Workspace/poe-code-safejs-contract-docs-final-author`, created from
`git@github.com:poe-platform/poe-code.git` with `--branch main --single-branch`,
then immediately pulled with `git pull --ff-only` (already up to date).
The clean base is `3f996a58ecad69b5a797dbe446a08906797654a7`.
Applicable ancestor and root `AGENTS.md` instructions were read. Work was
performed directly as a delegated worker, without nested delegation.

The released runtime reference is poe-code 11.0.32,
`93dda91e9d0d7078e7940ba51bf73a81ed7aec49`. Between it and this clone's base,
the only changes are three plan documents and the checkpoint-view validation
test; there are no runtime source changes. This author does not refetch an npm
package, rebuild, reinstall, or rerun the accepted runtime validation.

The old held candidate is an input, not a patch to apply blindly. Its checkpoint
document preimage and postimage both differ from current main. The current
checkpoint document's exact base is 14,435 bytes, SHA-256
`b3c62930c236e3f1b1c9f64236c12449a0bdf73b104fcee3e3566eba256108d0`.
The new candidate records that preimage, not the obsolete one.

| Read-only input                                                                                                                                            | Manifest SHA-256                                                   | Use and limit                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Held contract candidate, `poe-code-safejs-contract-docs/out/safejs-remediation/contract-docs-validation/candidate-20260829-fe5a784c-noether/manifest.json` | `2970e026a05159308aabe22930a9570afebbe6ea939a3712cf7d9a4791252eef` | Four manifest-allowlisted captured documents only; obsolete runtime observations are not new results.                                         |
| F0, `poe-code-safejs-final-package-review/out/safejs-final-published-package/artifact/manifest.json`                                                       | `09379aed7eb24e455729e605e53d89408523d731ffe8e8b3655ac76bfe02b674` | Actual released package identity; retained tarball SHA `94aca9a7f6fa9c79e64ac29f88580c4378d285743a7dcb6203a4803d87738ac2`.                    |
| F2, `poe-code-safejs-f2-lifecycle-validation/out/safejs-remediation/f2-lifecycle-execution/dist/manifest.json`                                             | `0f8cf2c856c1e8cd8a988aa09b4c2bb36c62de7f41905a1cc7f44046776e937d` | Accepted scoped lifecycle evidence; 92 bounded executions across 12 profiles and four separate disposition controls, not a universal promise. |
| O17, `poe-code-safejs-o17-contract-independent/out/safejs-remediation/o17-current-validation/manifest.json`                                                | `79fdda8067a214506b1d6de03692f4d7484bab3dc27320d799d85954c7463096` | Current measured availability, used only in the permission-blocked proposal. Feature scope remains a user decision.                           |

These locators are relative to `/Users/kjopek/Workspace/`. Each manifest hash
was verified before use. Captured old document reads additionally checked their
manifest-listed byte length, hash, and canonical containment. No original audit
archive payload was read, searched, hashed, or executed. Prior F2 evidence and
all previous capsules remain untouched.

## Contract changes and traceability

Paths below are repository-relative. The sealed evidence index pins their
current bytes; line anchors help the reviewer locate the relevant assertions.
Reading a test is not recorded as freshly running it.

| Contract topic                           | Current authority                                                                                                                                                                                     | Documentation boundary                                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New v7 versus retained historical v6     | `packages/safejs/src/snapshot/dump-format.ts:2`, `packages/safejs/src/restore.ts:51`, `packages/safejs/src/run.ts:199`, `packages/safejs/src/run.promise-compatibility.test.ts:41`                    | New runs use v7; genuine v6 restores retain v6. Working histories do not erase historical failing raw v6 histories. No marker rewriting or universal compatibility promise.                                                                                      |
| Public external checkpoint               | Existing AR section of `packages/safejs/CHECKPOINT_REPLAY.md`; public `dump` path and F2                                                                                                              | Preserve `dump(execution, { mode: "replay" })`; default capture refusal during active host work and same-run callback restrictions are not weakened.                                                                                                             |
| Genuine H5 proof conversion              | `packages/safejs/src/interp/host-call.ts:57`, `packages/safejs/test/h5-context-converter-review.test.ts:147`, `packages/safejs/test/final-async-proof-conversion.test.ts`                             | Active context's `toSandboxValue`; real callback history and IDs, aliases/captures/cycles, joined/detached disposition. Returning a function is not starting a callback. Ordinary/foreign native functions remain rejected.                                      |
| Callback arity                           | `packages/safejs/src/interp/host-callback-arity.test.ts:17`, `:108`, `:129`, `:283`                                                                                                                   | Current tested host-observed lengths match guest signatures. The earlier zero wrapper length is not relabeled an intentional limitation. No blanket reflection parity.                                                                                           |
| Completed Map identity                   | `packages/safejs/src/snapshot/completed-map-alias.test.ts`, `docs/plans/safejs-review-completed-map-alias-final.md:123`                                                                               | Current shared function/container graph is preserved; old already-split identities cannot be inferred or repaired by replay. No universal Map guarantee.                                                                                                         |
| Argument digest and `toJSON`             | `packages/safejs/src/interp/host-digest-tojson.test.ts:87`, `docs/plans/safejs-tojson-baseline-independent.md:450`, `docs/plans/safejs-fix-static-digest-tojson.md:55`                                | Tested old plain/nested object digests require reset before host/provider reissue; tested old named-array control replays. Own-data digest is not a full graph fingerprint or a blanket noninvocation guarantee.                                                 |
| Raw views versus persisted bytes         | `packages/safejs/src/snapshot/backend.ts`, `packages/safejs/src/checkpoint-views-validation.test.ts`, `docs/plans/safejs-final-o10-validation.md`, `docs/plans/safejs-review-final-o10-validation.md` | Shallow raw bindings can drift; already serialized bytes do not. Backend serialization occurs inside the queued write. Full graphs and fresh restores remain required. Prior six profiles have 48 source and 48 built fresh restores; not new author executions. |
| Error channels and source throw identity | `packages/safejs/src/interp/source-exceptions-validation.test.ts:285`, `:425`, `packages/safejs/src/run.test.ts`                                                                                      | Fulfilled API results and promise rejection both require handling; guest `{ ok: false }` is data. Source catch identity differs from host copying/public normalization.                                                                                          |
| Synchronous source generators            | `packages/safejs/src/run.snapshot.test.ts:613`                                                                                                                                                        | Cite the existing background-dump loop returning `[1, 2, 3, 4]`, not an unexecuted public example copied from the held internal `[1, 2]` experiment. Source reconstruction does not serialize opaque native frames.                                              |

The introduction now distinguishes reuse of completed host-operation outcomes
from replayed source callbacks and `onReplay` hooks. The new H5 wording is a
typed, context-scoped public representation, not native-function acceptance,
forged metadata, a private adapter, or invocation of `compute` to remove a
function-bearing graph. No new executable example is introduced into the
contract; the syntax and measured values refer to existing public APIs/tests.

## Evidence qualifications retained

F2's six O13 future-settlement qualifications distinguish the exact captured
prefix from the controlled future proof schedule. They do not imply that every
future settlement order reproduces the original continuation timing. The
declared complete recovery journals remain checked. Eight observer-pairing
mismatches were retained in F2 evidence: request-array order was not the
deliberate reverse proof-return order; real call IDs established the pairing.
This documentation does not change those observations or their classification.

The eight historical watchdogs, twelve qualified O14 children, and earlier
21 lint failures remain in their original captures, not converted into current
passes. Held future proofs are not refusals merely because time elapses. The
completed Map historical split-loss controls likewise remain historical losses.

O17 is not added as an accepted limitation or known regression. Its native
3/3 and source/released-package 0/3 availability measurements are proposed in
the separate plan only; the user has not authorized implementation or README
changes. A successful API envelope containing guest failure is explicitly
distinguished from an API rejection.

## Documentation checks

The author performs only scoped formatting, whitespace, link/anchor, evidence
identity, and changed-path checks. Exact commands, statuses, tool identity, and
outputs are retained in the ignored candidate evidence. Runtime tests, types,
lint, builds, screenshots, package installs, and skill sync are not run or
claimed as new results for this prose-only task. No visual CLI behavior changes.

The existing formatter is invoked read-only from the owned F2 clone, with this
new clone as the working directory. It does not share writable dependencies,
install packages, or change the old capsule. Formatting edits, like all other
file edits, use `apply_patch`.

One initial metadata inspection assumed an old manifest `files` field and
failed with `Cannot read properties of undefined (reading 'find')`. The actual
field is `captureFiles`. No payload read or write occurred in that failed
attempt; the corrected lookup used exact manifest membership. This is retained
as an author inspection failure, not a runtime failure.

A formatter-launch setup attempt also stopped before spawning a child because
the persistent REPL does not expose `process`. The corrected command uses
`env -u TERM SKIP_SYNC_SKILLS=1`. The first completed Prettier check reported
formatting in this new report's tables; its output is preserved, and the
formatter's result is applied with `apply_patch` before the final check.

Final scoped formatting passes for all three authored Markdown files with
Prettier 3.8.3. `git diff --check` passes for the tracked contract. Each new
plan also has no whitespace diagnostics under `git diff --no-index --check
/dev/null <path>`; exit 1 there denotes the new-file difference, not a whitespace
failure. The changed-path check contains only the contract and two own plans.
The sealed index records unchanged README/template guards and the exact linked
contract/section checks. No runtime result is inferred from these checks.

## Independent review procedure

1. Verify candidate manifest, preimage, postimage and patch hashes. Confirm the
   publication patch has only the checkpoint document and this author report.
   Confirm the separate proposal is not permission to edit README or template.
2. Compare the public source/test anchors against the released source pin and
   F0/F2 identities. Review the exact v6 acceptance condition, retained marker,
   genuine active context conversion, and original callback dispositions.
3. Review documentation API syntax against current public exports. If executing
   examples or related tests, the reviewer records their own commands and
   results; this author does not preclaim them. Keep proof provenance and
   full-graph/journal oracles unchanged.
4. Check the historical boundaries: old Map split loss, tested old object digest
   refusal before reissue, named-array control, raw shallow views, and both
   public error channels. No wording may turn these into universal compatibility,
   security, noninvocation, or migration guarantees.
5. Run scoped Markdown formatting and strict diff checks, then report independent
   disposition. Publication remains a coordinator decision; README/template and
   installed-copy edits require separate explicit user permission.

The minimal candidate contains exact base preimages, absent-new-file markers,
postimages, byte lengths, hashes, and the publication patch. A separate proposal
manifest records only the held plan and unchanged target guards. Neither
manifest authorizes a runtime release or modifications outside its scope.
