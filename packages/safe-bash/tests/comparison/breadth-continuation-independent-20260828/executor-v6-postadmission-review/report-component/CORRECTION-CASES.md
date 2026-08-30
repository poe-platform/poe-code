# S20 correction preseal, August 28, 2026

This changes only the defective independent fixture, not the candidate or the
twenty original expected cases. Original preseal2d44ae1a, raw evidencee7e8b5f4,
raw19PASS/1FAIL are immutable. The independent audit is18qualified PASS,
1FAIL(D13), 1unqualified S20: its process died by SIGTERM and the harness
omitted an exit0 precondition despite declaring it. No candidate pass is
credited for that weaker original S20 execution.

The same S20 expectation is resealed unchanged: actual assessor must reject an
actual supervisor receipt with65537 observed stdout bytes,65536 retained valid
JSON-plus-whitespace, CAPTURE_LIMIT and clean exit0/close0. Exactly one child is
permitted here, taking the cumulative total to six (original driver plus four
original stubs plus this correction). No additional driver child, case family,
engine or candidate call cohort is authorized. This launcher runs from the CLI
and uses the actual inherited supervisor and launch ledger directly.

The corrected stub explicitly owns one1000ms keepalive interval, registers its
SIGTERM handler before output, clears that exact interval on SIGTERM or
publication/exception failure, then emits its final FD3 closure observation.
This keeps the handler alive long enough to exercise graceful exit0 after the
capture-limit TERM. It is a fixture-lifecycle correction, not a product timer
or benchmark. The actual supervisor's10s natural+2s TERM+1s KILL limits remain.
All buffers are <=65537, retained streams<=65536, FD3 and artifacts<=262144;
the extra generated payload is65537 bytes, keeping total below40MiB/64MiB.

Preconditions are asserted and reported independently from assessor correctness.
If the sixth child does not achieve them, S20 stays unqualified; no further
children or silent data-model substitution are authorized. Only the actual
supervisor receipt, with stdout/stderr decoded from its documented base64
representation, reaches assessTerminal. Exit/close/failure/count fields are
not forged. Known handle PID/group absence, interval retirement, inherited
clock retirement and active resource observations are required.

Use the pinned Node executable, strict unhandled rejections,128MiB old-space,
and correction-launch.mjs once after this preseal is committed. The original
seven harness files, original evidence and author files must stay unchanged.
No historical V6 output is replayed and no admission readiness is implied.
