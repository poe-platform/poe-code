# Actual process-envelope qualification

The root's FRESH-ACTUAL-CORRECTED-ROOT-COORDINATION.md was observed during final
evidence preservation. It requires distinguishing the frozen supervisor's
children from the operator's administrative processes. That coordination file
is root-owned and is not included in these operator commits.

FINAL.json and the mechanically derived POSTRUN.json contain
`peakOwnedProcesses: 2`. This is the controller's assigned supervisor value, not
a measured peak across every process owned by this operator. It must not be
reported as proof that the complete authorized peak-two envelope was met.

While controller PID 69235 remained alive at BUILD_READY_COMMIT_RUNTIME_SEAL,
the operator ran a Node helper that synchronously invoked Git add, commit and
rev-parse for the runtime seal. The operator also ran a Node helper that invoked
Git show to verify that committed seal before publishing RUNTIME-START. Each
synchronous Git invocation overlaps the waiting controller and its Node helper:
at least three operator-owned processes, before considering shell/tool wrappers.
An exact all-owned peak and administrative child PID census were not measured.
The full peak-two bound was therefore not maintained. This is an operator
protocol qualification, not a product or compiler failure and not a retroactive
permission exception. No new concurrency experiment or permission expansion is
performed to repair this fact.

The actual controller made 27 of its frozen 70 supervised job dispatches, with
one child at a time. Its 27 receipts establish close and group absence for those
specific children. Administrative execFileSync calls returned, and their enclosing
tool commands settled. They are additional administrative processes, not counted
as more product cases or included in the 27-child supervisor retirement census.
The final preservation check observed the controller and all 27 exact supervised
groups absent using signal-zero probes only; it sent no termination signal.

The controller stopped on the independent, sealed moved-type wx-file collision.
It was not stopped by an all-process census guard. Both the harness stop and this
operator envelope violation remain in the evidence. The actual attempt is
consumed. No retry, product change, additional probe or follow-on work is authorized.
