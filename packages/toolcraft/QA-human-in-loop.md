# Human-in-loop QA

- [ ] Sync mode on darwin
      Run a command configured with `humanInLoop: { mode: "sync", ... }` on macOS and confirm a real `osascript` approval dialog appears before the handler runs.
- [ ] Async mode detaches
      Run a command configured with `humanInLoop: { mode: "async", ... }` on macOS and confirm the approval dialog appears from a detached subprocess, the CLI returns immediately, and `ps` still shows the runner process after the original CLI exits.
- [ ] Approval lifecycle and result
      While an async approval is running, confirm `approvals list` shows the entry. After approving, confirm `approvals show <id>` reports state `approved-done` and the task metadata includes the handler result.
- [ ] Decline reason metadata
      Decline an approval with a reason and confirm that reason is written into the task metadata.
- [ ] Reserved `approvals` group
      Define a user `approvals` group in the host command tree and confirm startup fails with `Error: 'approvals' is reserved for human-in-loop built-ins`.
