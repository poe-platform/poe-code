# Environment capture and restore

This extends the active standalone `op` goal. The user explicitly requested the
ability to retrieve and restore environments, including variables, with the same
implementation and verification scrutiny as the rest of the package.

Required behavior:

- Capture environment values without resolving or printing secrets implicitly.
- Preserve empty strings, unset variables, and the distinction between complete
  and selected-variable snapshots.
- Retrieve stored snapshots through the pluggable backend.
- Restore complete snapshots exactly; selected snapshots leave unrelated values
  unchanged and remove selected variables recorded as unset.
- Keep snapshots detached from caller-owned state and validate the whole snapshot
  before changing any target state.
- Apply host authorization and approval to capture, retrieval, and restoration.
- Keep CLI and SDK parity. A child executable cannot mutate its parent shell;
  any shell-script output must be explicit, while embedding hosts can restore
  their own execution environment directly.
- Preserve the original full `op` compatibility scope and standalone release
  requirement. These additional commands must be identified as extensions.

Clarification pending: whether “etc.” includes working directory, aliases,
functions, and shell options in addition to environment variables. Variable
capture/restore work can proceed independently.

Verification must cover round trips, unset versus empty values, selected versus
complete restores, malformed snapshots, mutation isolation, cancellation,
approval denial, failed restoration, and secret disclosure boundaries. No
environment capture from the developer's actual process is needed for tests;
use synthetic values only.

Shell-output verification must additionally prove that selected snapshots emit
only selected names, never disclose or reassign unrelated environment values,
and emit explicit unsets even when a name is currently absent. Evaluate against
a changed synthetic shell environment to check that those unset instructions
still take effect. Shell-script evaluation is not atomic: readonly variables or
other runtime shell errors can cause partial application, as documented in the
standalone guide. Atomic application is an embedding-host responsibility.
