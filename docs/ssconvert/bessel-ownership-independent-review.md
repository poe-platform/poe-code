# Independent Bessel kernel ownership and budget review

This bounded read-only review covers `captured-bessel.ts`, `captured-bessel-i.ts`, and `captured-bessel-k.ts`. The scientific implementation remains owned by its author; no runtime files were edited. This is executed engine/ownership evidence, not a procedure or a claim of complete numerical parity.

## Source assertions

Every recurrence, continued-fraction, backward-normalization, steepest-descent range-shrinking, series, and quadrature loop in these kernels calls the injected host tick before advancing state. Convergence-only loops therefore remain bounded by the invocation's workbook-work budget and cancellation checks. Fixed-length scalar polynomial evaluations are bounded. The top-level tables contain rational approximation coefficients, not captured formula-to-output fixtures. Mathematical range/order dispatch selects approximations and recurrences; no exact-input native-output lookup was found in the reviewed files.

All recurrence counters, accumulators, dynamic rescaling state, per-call DataViews, integral sample closures, and integration bounds are local to a kernel invocation. Shared arrays contain constant approximation facts and are only read. No exported mutable cache, native process access, host filesystem access, LLM access, replay state, or fallback capability was found in the reviewed files. The actual function dispatch uses the same host passed from the shared formula engine.

## Executed original in-memory engine observations

An injected original codec produces a single numeric formula cell and exports its value as injected bytes. This exercises `createEngine.convert` through the normal formula evaluator and conversion export path, using no native utility or unit disk fixture. Each formula ran twice successfully under a100000 workbook-work budget, producing identical output bytes. Each then ran with budget15 and failed with `SsconvertError` code `resource-limit` before serialization or output. Finally, an injected signal check aborted on the third observed tick inside the captured kernel: each conversion rejected with the exact supplied reason object and reached neither serialization nor byte publication.

| Formula | Selected kernel path | Repeated successes | Work-limit result | In-kernel cancellation result |
| --- | --- | --- | --- | --- |
| `=BESSELJ(10,0)` | Zero-order Hankel steepest-descent integral | 2, identical bytes | resource-limit; 0 serialization/output calls | exact reason identity; 0 serialization/output calls |
| `=BESSELJ(17,0)` | Zero-order finite Hankel expansion | 2, identical bytes | resource-limit; 0 serialization/output calls | exact reason identity; 0 serialization/output calls |
| `=BESSELI(12,0)` | I0 P-sequence/backward normalization | 2, identical bytes | resource-limit; 0 serialization/output calls | exact reason identity; 0 serialization/output calls |
| `=BESSELK(0.2,0.3)` | K small-x series/start values | 2, identical bytes | resource-limit; 0 serialization/output calls | exact reason identity; 0 serialization/output calls |
| `=BESSELK(2,0.3)` | K middle-x continued fraction/normalization | 2, identical bytes | resource-limit; 0 serialization/output calls | exact reason identity; 0 serialization/output calls |
| `=BESSELK(20,7.3)` | K large-x starting value/order recurrence | 2, identical bytes | resource-limit; 0 serialization/output calls | exact reason identity; 0 serialization/output calls |

All24 conversion observations completed with the stated assertions. No concrete ownership, cancellation, or budget defect was reproduced, so no speculative repair or failing regression was added. Native numerical accuracy, all argument extremes, nonzero J/Y orders, degenerate direct base-function branches, concurrent disposal, and full error/diagnostic formatting remain outside this focused review. The temporary isolated replay artifact was purged after recording evidence.
