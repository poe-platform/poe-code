# Post-freeze concretization

Freeze commit: 3af5da96 (full identity sealed in evidence). After that commit,
read candidate source interfaces (lines 1-59), followed by private state and
implementation. Also inspected author runtime fixture setup, its undefined
reason construction, and cases.json to identify overlap. Those are exposures,
not independent results. Author runtime suite is NOT rerun or counted.

Twelve runtime test records cover H01-H10; H03 includes seven input variants,
not seven independent obligations. H04b is the bounded fanout-detach variant;
H07b concretizes the author's frozen README phrase "first delivered control
origin" (admission). The later RESULTS wording "first control origin" is less
specific; preserve this discrepancy rather than silently choosing array order.
H11 is one strict positive fixture and six separately targeted malformed-signal
diagnostics; H12 runs the same runtime cohort from moved emitted internal ESM.
These counts overlap by design and are not summed.

Undefined is not emitted by native AbortController.abort(undefined): it defaults
to a DOMException. The undefined variant uses a native-branded signal with an own
reason property before event delivery. This is the documented native-brand host
surface, not a claim about ordinary native abort defaults. Other falsy reasons
are native. No mutation of implementation-private symbols or forged reports.

No promise is inferred that automatically failed subscribers release capacity;
only explicit unsubscribe and owned close reuse are checked. Reentrant close
may detach remaining callbacks. H04b instead removes just one callback: remaining
live subscribers are expected to run, consistent with synchronous fanout rather
than an invented promise that removed callbacks execute.

Mutants operate on copies after freeze: public report signal replaced by merged
frame delivery signal, ensureCapacity disabled, close listener removal omitted.
Only candidate-passing relevant assertions can kill a mutant. Initial runner or
compiler errors, if any, remain in numbered attempt logs and are never kills.
