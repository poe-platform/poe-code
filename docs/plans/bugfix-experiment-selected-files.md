# Experiment selected-file Git handling (POE-018)

## User-facing behavior

An experiment selected from `docs/plans`, `docs/experiments`, the legacy
directory, or another supported location must start without rejecting its own
sibling journal. Only the selected document and journal are exempt from the
clean-tree check; unrelated edits remain an error.

Discarding an iteration must preserve the current document and complete journal
while restoring experiment code and HEAD to the accepted baseline. This includes
metadata that is tracked, staged, untracked, ignored, or committed during the
discarded iteration. Existing unrelated stashes must remain untouched.

## Implementation

- Pass the resolved selected document and sibling journal to the default Git
  adapter. Keep custom adapters and the existing one-argument factory contract.
- Discover the repository root for scoped operations. Use quoted, literal,
  root-relative exclusions for precisely the selected in-repository files.
  External files do not become Git pathspecs; a nested working directory still
  checks and resets the full repository.
- Restore non-metadata tracked files and the index from the baseline, then move
  HEAD with a mixed reset that does not touch the preserved working-tree files.
  Do not use scoped stash/pop: actual Git controls demonstrate that a scoped
  stash can also restore unrelated staged code after rollback.
- Generate commit guidance with the selected-file exclusions on both staging
  and committing. Keep the existing working-directory commit scope, and quote
  the generated commit message. Do not query Git for injected adapters.
- Include the experiment instruction and default-run assets beside the root
  bundle. Actual SDK verification exposed that the bundled loader resolves
  these assets there, while only the standalone workspace copied them before.
  The selected-file fix cannot reach its Git checks in the shipped SDK without
  these runtime assets. Verify their packaging with the existing memfs bundle
  tests and actual default-filesystem SDK execution.

## Verification and delivery

- Add failing memfs public-SDK regressions for initialization, repeated runs,
  unrelated changes, prompt guidance, discard, failures, and cancellation.
- Add injected-exec adapter cases for exact scope, nested and external paths,
  literal filenames, failures, and rollback sequencing.
- Run actual Git controls in disposable owned repositories for committed,
  staged, untracked, ignored, deleted metadata, and preservation of stashes.
- Run focused source tests on supported Node versions, the maintained build,
  normal commit/push hooks, and monitor the GitHub release. Qualify the actual
  published artifact before counting POE-018 as delivered. Preserve unrelated
  CI blockers and drafts; do not weaken or bypass gates.

## Verified before commit

- The initial selected-file regressions failed before the implementation;
  bundle regressions separately reproduced the missing root runtime assets.
- The focused suite has 192 passing cases on Node 18.18.2, 20.20.0, 22.22.2,
  and 24.14.0. The maintained full build succeeds.
- Eleven actual-Git controls cover metadata states, repository aliases, nested
  invocation, external files, exact exclusions, and unrelated stash retention.
- Twenty-four built-SDK scenarios cover six document locations on all four
  Node versions. Each discards an iteration, resumes in another process, then
  verifies completed-run no-op behavior in a third process. Journal entries
  are written through the actual built CLI; Git, filesystem, and generated
  commit commands are real, while agent execution is injected. All disposable
  repositories are removed afterward.
- Local validation does not establish a published release. Release and artifact
  results are recorded separately in the workspace remediation ledger.
