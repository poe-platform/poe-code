# Sort output/comparator regression scope

The fixed224-case benchmark and original sort slowdown are unchanged evidence.
Inspection found an allocated singleton-key loop and repeated flag/fallback
work for every plain byte comparison, then one awaited pipe write per sorted
record. Plain byte ordering now uses its direct comparator. Since sort already
consumes the complete bounded input, its completed records can safely be emitted
in independently owned chunks up to64KiB. Uniq's online emission is deliberately
unchanged; coalescing that producer could delay live pipelines waiting for head.

35 independently captured GNU9.7 observations run at two input chunk widths,
covering seeded byte/numeric/reverse/unique/stable ordering, case/blank/key flags,
NUL records and non-UTF8 bytes. Other tests assert chunk ownership/bounds,
backpressure, blocked-output cancellation and in-place VFS output bytes. Tests
do not assert a timing threshold. Sort remains a bounded in-memory sorter, not
an external sorter; synchronous Array.sort is not preemptible mid-comparison.

Matching-output, alternating-order performance evidence is recorded separately
under benchmarks/reports. No general speed claim follows from this author patch.
