# POE-011: preserve plan edits after role failure

## Problem

Failure recovery replaces the live superintendent document with a pre-role
snapshot. A user can edit that same document while an agent runs, so the rollback
silently deletes their requirements. The runtime cannot reliably attribute file
edits to the agent or the user.

## Behavior

- Halt on the original role failure without overwriting or recreating the live
  document, including malformed drafts and edits made during recovery itself.
- Save the pre-role snapshot beside the document as a uniquely named
  `.recovery-<uuid>.bak` file, using exclusive creation. For a builder failure,
  this snapshot includes the pre-round status.
- Include the snapshot path and compare-before-resuming guidance in the error.
  Keep the role error as its cause. If saving fails, report both failures without
  touching the live document.
- Preserve both versions rather than automatically reverting agent changes:
  the current file may contain useful agent work as well as user edits. The
  recovery snapshot allows the user to reconcile the task board and round status
  deliberately before resuming.
- Apply the same policy to builder, inspector, superintendent, and owner failures.
  Successful execution and interruption behavior are unchanged.

## Validation

- Regressions use memfs and deferred fake roles; no agent or network calls.
- Cover all four roles, malformed documents, deletion, recovery-write failure,
  repeated failures, a concurrent edit during recovery, and successful execution.
- Existing failure tests verify the recoverable pre-role version while retaining
  the live agent-modified document.
- Run superintendent tests, repository checks/build, and inspect the rendered
  diagnostic. Commit and push only this fix; verify the stable npm release.

## Scope

Only POE-011 is addressed. External completion handling (POE-012), concurrent
runner injection (POE-013), and the other audit findings remain separate work.
