# Source ReferenceError delivery and recovery

Validated missing-name failures reached Promise handlers and synchronous
generator callers as diagnostic-shaped objects rather than guest ReferenceError
instances. Runtime identity checks reproduced three failures before the repair.
Checkpoint tests independently reproduced the loss for ordinary Promise
handlers, executors and thenable callbacks.

Brand source-created unresolved-reference diagnostics in a weak registry. Convert
only those diagnostics at guest exception and Promise boundaries, with a
per-budget weak cache preserving shared error identity. Materialize errors before
storing rejected Promise/thenable state so recovery does not depend on a
process-local marker. Preserve arbitrary guest-thrown look-alikes and the public
bare unresolved-reference diagnostic envelope. Fatal budget handling is unchanged.

Focused validation in the current worktree:

- 99 runtime, exception and initial recovery checks passed.
- 158 constructor, generic Promise, continuation and recovery checks passed,
  including nine rejection producers and a restored guest look-alike control.
- TypeScript and focused lint passed before the final added recovery controls.

The completed whole-package snapshot in session 94065 excludes this repair:
22,631 passed, ten failed, 37 skipped. Do not attribute that run to this change
or report it as a successful gate. Publication remains paused.

The exact proposed commit was isolated from other uncommitted eval and exception
declaration work using a separate index and checkout. After correcting patch
assembly and running the maintained pretest:unit Intl-data preparation, all 238
selected tests across ten files pass in that checkout (19.91s). The same 238
tests also pass in the main worktree. The isolated checkout uses dependencies
from the previously built candidate; this is focused source verification, not a
fresh whole-workspace build or complete integration gate.
The isolated package TypeScript check and focused repository-configured ESLint
also pass. Whitespace checks pass. This repair is ready for its local atomic
commit; remote delivery and release remain intentionally withheld.
