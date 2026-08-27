# Author consumer correction, not production fix

Attempt01 against488ef9e3 passed production build/types,42 registry tests and
six negative-type controls, then reported12/16 public tests. Four tests wrongly
expected Shell.use to throw plugin setup errors synchronously. The existing
Shell queues setup on its readiness promise; execution observes rejection.
Source0123 shell.ts35–55 establishes this behavior. Product wiring is unchanged.

Three collision tests and one invalid-limit test now exercise the actual
synchronous plugin.setup(host) boundary, retaining their exact rejection,
registry-preservation and top-level replacement assertions. A new public test
also requires Shell.use to return the shell, subsequent exec to reject with the
collision diagnostic, and the original registry to remain untouched.

This is17 cases after one added boundary test, not an unchanged16/16 replay.
Attempt01 remains captured with12 pass/4 fail and unreached fallback controls.
No failed output expectation, command behavior or resource limit is changed.

Attempt03 passed63 registry/adjacent tests and all strict declarations, then
reported14/17: three replacement checks compared the stored unrelated definition
to the caller's pre-registration object. CommandRegistry deliberately stores a
frozen copy. Those assertions now require identity with the actual registered
entry captured before replacement, and require the replaced entry to differ
from its actual previous stored entry. This strengthens the intended preservation
check rather than demanding undocumented identity with the registration input.
The same17-case cohort is retained and the14/17 observation stays captured.
