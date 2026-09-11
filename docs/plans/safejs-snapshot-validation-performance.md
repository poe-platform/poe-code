# Snapshot descriptor-validation cost

The unchanged 96-case snapshot mutation corpus exceeded its 750 ms cap in the
full suite and focused verification (1067 ms and 975 ms). An unmodified profile
also reproduced 824 ms. An idle focused run passes, so the margin is insufficient
rather than every invocation being slow.

CPU samples show substantial structured-clone and garbage-collection work plus
generic validation and property-path construction. The local snapshot is 668508
bytes / 641 nodes; the isolated committed baseline is 648371 bytes / 623 nodes.
Do not shrink the fixture, reduce cases, relax limits or skip validation.

Test a lower-allocation descriptor walk and avoid constructing each property
path twice. Preserve rejection of getters without invocation, proxies without
traps, symbols, custom prototypes, sparse arrays and named array properties.
Retain non-enumerable data-property validation. Compare the unchanged corpus
and full snapshot regressions before deciding whether to keep the optimization.

All 11 new descriptor safety controls pass before and after the change. The
unchanged mutation corpus plus those controls passes. Full snapshot coverage
passes 1,491 tests in 93 files; an isolated committed-source candidate passes
122 focused restoration/validation tests and TypeScript checking.

A paired five-run comparison of the complete unchanged corpus measured total
invocation times of 1043, 527, 466, 585 and 686 ms before, versus 615, 487, 447,
470 and 476 ms after. All ten runs satisfied the corpus's internal 750 ms cap;
total times also include its initial capture/roundtrip setup. Earlier concurrent
verification still exceeded the cap once after optimization, so this is a
measured reduction in overhead, not a claim that all timing failures are fixed.
The temporary baseline comparison was undone and the optimized file's original
Git blob hash was verified identical afterwards.
