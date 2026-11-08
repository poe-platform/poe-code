# Coverage findings frozen before completing the map

This is a post-candidate static coverage addendum, not a reversal of `9925b10d` code-static readiness and not an executed product finding. All observations below refer to composition commit `0e8ee2900e7810b911f1335b0d3f05f23ce740c5`.

## LC-F01 — critical repair observations are absent, not merely unrun

`assembly/core/data/ledger.json` rows WRK-06, WRK-07, WRK-13 and WRK-17 have only `SOURCE-STATIC-REPORT` in `successorJobs`, no runtime projection or declared runtime obligation, and two missing bindings apiece. `assembly/core/data/boundaryProofs.json` explicitly gives each `newRuntimeFixture:false`. Therefore the 149 source-built and 149 physically moved jobs do not contain a designated affected-boundary runtime case for any of these four IDs. Ordinary small-input parser/encoder execution cannot establish their repaired allocation-order/cap obligations.

`assembly/core/source-audit-worker.mjs:17` unconditionally maps all 23 designated records to `UNRUN_SOURCE_ARGUMENT`; line 19 writes `UNRUN_PENDING_DIFFERENT_SOURCE_ARGUMENT`; line 23 returns `INCOMPLETE`. The current worker hashes files and transports qualifications but does not consume or verify a newly supplied repair/source argument. This is missing bound proof, not a future runtime countertrace waiting for GO. Before claiming these repairs accepted, supply exact independent source arguments and applicable observer/case bindings without lowering caps, injecting state or inventing private/public APIs. A limited diagnostic launch can only retain these claims as unfulfilled.

## LC-F02 — UTF-22 observer absence is a concrete prerequisite gap

The frozen natural-language assertion is not executable in `assembly/core/frozen/original-assert-capture.mjs:22`. Its line 32 also retains every frozen missing binding and line 35 refuses unfulfilled obligations. The retained-view negative slots consequently cannot become actual loaded-kill proof merely by running v4. Their required observer remains absent; the proposal is not authorization. Exact loaded-slot joins and the current primitive/incomplete classifier are documented in the final mapping, without modifying expectations.

These are launch-coverage qualifications requiring root routing for any additional implementation. No fix, execution or policy waiver is performed here.

## LC-F03 — historical gap counters omit current unbound assertion fields

Static joining reproduces 135 missing-binding entries across 80 IDs (62 with no runtime job, 18 with partial runtime jobs). Independently inspecting the actual assertion adapter reveals 28 runtime jobs/IDs with unsupported fields or natural-language assertions, including ten IDs outside that 80: CMD-04, CMD-05, CMD-06, NUM-14, ENC-07, QUE-07, UTF-12, UTF-22, FS-01 and FS-05. The union is 90 IDs with explicit inherited missing bindings or current unbound expected fields, not an updated semantic-failure count. The old 31 unfulfilled receipts contain only 28 distinct job IDs: CMD-04/05/06 occur in both original-runtime and deferred-lifecycle evidence.

Exact version/help reference resolution, adopted stdout/stderr/diagnostic/scalar fields and already captured namespace/read assertions are feasible executor assertion bindings, not uncertain future product results. They require targeted owner completion before a launch intended to accept those frozen claims; this audit does not implement them or change their expected values. Frozen 94/17 semantic eligibility is historical metadata, not 94 runnable complete records or passes.
