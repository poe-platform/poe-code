# PPTX bounded streaming and Worker verification

## Current status

The command's in-place conflict check compares the current file incrementally,
using retained reads of at most 64 KiB when available, otherwise a streaming read
with a 64 KiB requested chunk size. Buffered-only filesystems retain their existing
fallback. The original input is still a complete byte array. Metadata identity
checks and conditional publication remain required in addition to byte comparison.

This is not an end-to-end bounded-memory implementation or Worker qualification.
The command still collects input, returns complete stdout/stderr, and publishes
complete output arrays. `safe-bash-presentation-engine` still collects the archive,
retains decompressed members in `readPackage`, copies members in
`writePackageArchive`, and builds embedded chart workbooks in memory.

## Remaining implementation

1. Carry caller-owned retained/range sources, explicit spill-storage authorization,
   output sinks and owned staged publications through both command and engine APIs.
   Keep buffering convenience APIs available without requiring them for Worker use.
2. Replace synchronous package-member access on the streaming execution path with
   asynchronous reads and a bounded cache backed by the caller's safe-fs. Migrate
   mutation state, embedded workbooks, archive indexes and serialization too.
   Do not hide full-payload arrays behind a source interface or a private RAM spool.
3. Keep protected-source identity, in-place conflict checks, force/dry-run behavior,
   byte ownership and conditional atomic publication. Retire retained handles and
   owned staging on success, cancellation and failure without masking primary errors.
4. Test generated/reused input chunks, slow sinks, injected external-storage spies,
   bounded outstanding bytes, errors and cancellation. Fail tests on payload-wide
   reads or hidden in-memory spooling. Compare output semantics with existing
   presentation and native interoperability fixtures across supported operations.

## Manual workerd / Cloudflare QA

Execute these steps after the streaming engine path is implemented. Do not treat
Node heap statistics, this plan, or mocked storage tests as Worker measurements.

1. Record the exact commit, workerd version or deployed Worker identifier, runtime
   limits, backend configuration, cache/window limits and measurement tools. Use
   caller-injected external storage that supports the required retained identity
   and atomic staged publication guarantees. Record backend resident buffers,
   pending reads/writes, staged bytes and cleanup events. A memory filesystem or
   RAM-backed mock is not the large-data backend for this qualification.
2. Prepare equivalent decks at 1, 8, 32, 128 and 512 MiB, staying within the service's
   explicitly configured admission limits. Vary media payload size, archive member
   count, XML part size and embedded chart workbook size separately. Generate and
   upload inputs outside the measured Worker. Reuse fixed-size chunks during data
   generation so the generator does not contaminate memory observations.
3. Run inspect, text extraction, media extraction, text replacement, slide
   import/merge/split, chart editing and in-place mutations through both SDK and CLI
   entry points. Verify an unchanged baseline and intended edited results using a
   native presentation reader; inspect archive members, relationships and embedded
   workbook values. Preserve opaque members and media bytes where applicable.
4. Record actual runtime peak memory, baseline memory, CPU time, elapsed time,
   first stdout byte, first staged write and publication time for every input size.
   Explain how each metric was measured. If the chosen platform cannot expose a
   metric, mark it unavailable and obtain it from an instrumented workerd run;
   never substitute a Node-only measurement. Record output sizes and digests.
5. Repeat with a deliberately slow stdout consumer and a slow external-storage
   writer. Measure outstanding source/sink bytes and cache occupancy. Verify that
   they stay within configured windows as payload size increases; separately
   account for externally stored data and per-request metadata.
6. Repeat at concurrency 1, 4 and 8. Record per-request and isolate-wide memory and
   CPU, latency, first-byte times, backend pressure and publication outcomes.
   Investigate any growth with total payload size or retained completed requests.
7. Cancel during admission, archive decode, workbook mutation, staging and output.
   Inject read/write/close failures; change source contents or identity before
   commit; replace protected inputs with aliases. Verify destination preservation,
   conflict errors, handle closure and owned-staging cleanup. Check force and
   dry-run independently, including missing output directories and multi-output
   operations with their documented partial-publication policy.
8. Keep a results table with one row per size/operation/concurrency and links to
   runtime evidence. Store temporary captures under `/out` and remove them after
   recording the needed evidence. Report failures and missing metrics explicitly;
   qualification requires both functional results and measured bounded execution.
