# CSV streaming Worker qualification

This is a manual execution plan. Unit tests and Node heap measurements are not
Worker qualification. Record measured results only after executing these steps
against the exact built revision; leave unavailable measurements unqualified.

## Deployment and storage

1. Build the csvkit workspace and deploy a disposable workerd/Cloudflare harness
   using its public `run` API and the shell `csvkitCommands` integration separately.
   Stream request bodies and responses; do not call `request.text()`, concatenate
   response chunks, or wrap a complete input in a ByteSource.
2. Inject the intended external safe-fs backend and an authorized scratch directory.
   Verify retained reads, retained staging writes, version/identity receipts and
   retained cleanup with its conformance checks. Do not substitute a memory fs,
   overlay with a RAM upper layer, host temp directory or payload-sized byte array.
   For SDK calls bind `fs.createReplayFile` through the exported `createReplayFile`.
   For shell calls set `storageDirectory` on `csvkitCommands`.
3. Instrument backend I/O independently of application memory: record bytes stored,
   staged objects, read/write request sizes, pending bytes, cleanup failures and
   storage requests. The 64 KiB replay cache is per live file, the initial sort run
   target is 256 KiB, and spill I/O requests are at most 16 KiB. Account for the
   largest individual record, selected schema, and requested frequency output.
4. Confirm that shell dispatch reaches asynchronous commands, never eager sync
   evaluators. Confirm that every injected text codec implements `decodeStream`.
   Deliberately fail payload-wide input `readFile` and codec `decode` calls.

## Increasing inputs and interoperability

1. Generate streams of 1, 8, 32, 128 and 512 MiB with fixed-width rows. Reuse producer
   chunks, vary fragmentation down to single bytes, and delay the response consumer.
   Keep fixture generation outside the measured isolate. Use an incremental output
   hash/count instead of retaining output in the client or Worker.
2. Exercise csvcut/csvgrep/csvformat, inferred CSV conversion, csvsort (ascending,
   reverse, case-insensitive, stable ties), csvjoin (inner/left/right/full and three
   inputs), csvjson/GeoJSON, csvlook, csvstat and CSV-to-SQL schema/insertion. Use
   `-y 0`, default sampling and `-y -1`. Include ambiguous quote patterns that force
   repeated full-sample scans, and document their CPU/storage amplification.
3. Include quoted delimiters/newlines, null tokens, short/wide rows, Unicode case
   expansion, all admitted encodings, decimal scale/NaN/infinities, dates, aware and
   naive datetimes, microsecond durations, duplicate join groups larger than cache,
   and late rows that change inferred type. Compare output bytes and diagnostics
   with the frozen native csvkit reference profile and independently generated
   native outputs. For joins assert original left-row/right-match order and the
   final unmatched-right order. Test singleton and empty tables separately.
4. Measure database providers and interpreter guests independently. Default SQLite
   connections and explicitly materialized Python/Agate objects have their own
   memory ownership; a bounded CSV reader does not qualify an eager database or
   guest. Do not use legacy SDK hosts without replay capability or the explicit
   `inferTable`/synchronous convenience APIs as the Worker streaming path.

## Measurements

For each revision, backend, command, size and concurrency, record a row containing:
input/output bytes, peak **isolate memory**, idle baseline, CPU time, wall time,
time to first response byte, read/write/spill bytes, peak outstanding I/O bytes,
peak live staging objects, response hash and cleanup result. Obtain isolate memory
from workerd's inspector/profiler or Cloudflare-supported runtime telemetry; identify
exactly which measurement is available. Process RSS and Node heap are supplemental
and must not be labelled isolate memory. Use Workers CPU telemetry for deployed runs.

Run cold and warm requests, then 1, 4 and 8 concurrent requests with independent
scratch ownership. Sequential commands should publish before input completion and
stop pulling while the sink is blocked. Global inference/sort/join may wait for
complete input; their resident application state should plateau with fixed record
sizes while external storage grows. Compare the curves, not just successful status
codes or a lower input-size cutoff. Record per-request and aggregate peaks.

## Faults and acceptance

Abort during source reads, spill creation, writes, sealing, replay, duplicate-group
expansion and blocked output. Inject short reads, write failures, source mutation,
replacement of staged names, stale version receipts, cleanup failures and backend
quota errors. Check primary error/abort identity, no writes after cancellation,
no leaked owned staging, and preservation of replacements the invocation does not
own. Check stdout bytes and exit status under shell pipelines and redirections.

Accept qualification only when increasing-size/concurrency measurements support
bounded application memory, interoperability cases match, backpressure is visible,
all owned cleanup settles, and the intended external backend passes. Report code
commit, remote-main ancestry and release publication separately from these results.
