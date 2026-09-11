# Byte lifecycle cancellation admission

The full qualification on `024ecd01bd742a9d783571fec01aac29492b657a` reported an `unzstd` sink-cancellation failure. The run was intentionally interrupted after that concrete failure; it is incomplete, not a passing gate. Its unchanged focused lifecycle replay passed all 73 cases, so that observation alone did not establish a product defect.

The cancellation fixture created a blocked promise immediately and scheduled cancellation after 15ms, before knowing whether the command had called the selected source or sink. If setup took longer, cancellation could prevent admission entirely. The fixture then rejected its own unconsumed promise, producing an unhandled late rejection without testing the intended blocked-operation behavior.

## Controlled reproduction

An external diagnostic temporarily delayed the actual `run` invocation by 40ms while preserving the original test body and 15ms cancellation timer. Both selected `unzstd` source and sink cases failed with `late uncooperative failure`, rather than a timeout. The diagnostic restored the exact original file in `finally` before implementation.

- Driver: `/tmp/poe-bytes-delayed-start.py`.
- RED: `/tmp/poe-bytes-delayed-red.log`, two failures, exit 1.
- Same delayed-start control after correction: `/tmp/poe-bytes-delayed-green.log`, two passes, exit 0.

This validates a fixture scheduling flaw. It does not establish the exact cause of the earlier full-run marker, whose detailed assertion was not emitted before interruption.

## Correction and retained coverage

Create the blocked promise lazily inside the selected source/sink callback. Signal entry and race that barrier against early command settlement. Assert exactly one admission, abort with the original reason, require the exact same rejection identity, then reject the admitted blocked promise and yield to expose unhandled late rejection. Cleanup rejects only a promise that was actually admitted; it does not attach a blanket catch that could conceal missing product observation.

All 73 cases remain. Every existing 3s test deadline remains. The separate long-empty-source tests retain their timers and continue to test cooperative timer cancellation. No product source changes are made.

The ordinary full lifecycle file passed 73/73 with no skips or cancellations in 4,449.560ms: `/tmp/poe-bytes-lifecycle-barrier-green.log`. Independent review and maintained broader qualification remain separate requirements. No commit, delivery, or release is claimed by these results.
