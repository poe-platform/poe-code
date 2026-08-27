# Independent expectations, before production execution

The original 24 command vectors and exact baseline bytes are immutable. All
three fields (status/stdout bytes/stderr bytes) must remain equal, except the
specifically approved default-rg named-backreference rejection, independently
compared to the retained primary native rejection. Original hand-written
`rg-onlyempty` disagreement is not corrected by replacing the frozen output.

Benign whole-command controls precede any risk. Public API tests use static
compiled ESM through `Shell`, real command registration and actual byte sinks.
No default Shell hard deadline is expected. Configurable matcher request policy
must not time out upstream or downstream waiting. Preabort must win before
worker construction/input consumption; cancellation must preserve reason and
retire owned work before settlement. Other shells and queued siblings survive.
Live first records must reach sinks without waiting for another source chunk.
Early downstream exit must retire accepted work. A configured executor permits
two workers by default; no global slot. No worker is held alive indefinitely
by an idle source/sink, nor retained after all invocations end.

Queue admission is FIFO among admitted requests, bounded by count and the
UTF-16 descriptor plus byte-row payload accounting, including queued data;
cancelled entries leave accounting immediately, never consume future slots.
Terminating workers still count toward capacity until awaited termination.
Compilation and matching are worker-side, including invalid input and fragments;
fast case-sensitive literals are permitted only under proven control semantics.

Static transport fixtures, once protocol is handed off, will exercise startup,
request timeout without caller signal, fatal exit, malformed responses, and
error/abort precedence with controlled awaited termination. A safe fake stall
may demonstrate default 1000ms without executing costly regex. Short real
worker policies are not mislabeled as observing the 1000ms default.

The small benchmark is full command output/status-gated, including compilation,
startup and retirement, with three alternating-order repeats per input. Report
individual elapsed times and host-load caveat; do not infer global speed or
memory superiority. Packaging must actually move a packed product tree and run
public command API from the consumer, not merely import an internal worker.

Four reserved risk candidates, never automatic retries: grep and rg each with
`^(a+)+$` on exactly 28 ASCII `a` bytes plus `!\n`, once under explicit short
request policy without caller signal, once under caller cancellation. These
are fixed tiny inputs, not a growing matrix. Each launch requires a distinct
durable claim before spawning, and one owned child only. Compiled static worker
benign controls, source inspection, heap/output cap and <=250ms post-ready
watchdog must pass first. Any watchdog/failure is preserved, not retried.

Findings are reported before product fixes. Fixed-source verification freezes
new exact hashes and retains failed-source results and harness corrections.

Root's 2026-08-27 focused batching reminder adds two benign early-selection
controls, not risk breadth: `rg -q '^a'` and `rg -m1 '^a'`, exact input
`a\n12345\n`, explicit existing `maxLineBytes: 4`. Both must succeed before
the later oversized record, with no stderr and stdout empty / `a\n` respectively.
They run first against the original frozen baseline, never a new baseline.
