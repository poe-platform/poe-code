# Archive streaming on workerd and Cloudflare Workers

This is a manual qualification plan, not an executed benchmark. Unit tests use
mock/memory storage to verify byte ownership, bounded requests, backpressure,
authentication and cleanup. They do not establish a Worker memory ceiling.

## Environment and storage

1. Record the exact commit, workerd version or deployed Worker version, compatibility
   date/flags, CPU/memory limits, filesystem adapter version/configuration and region.
   Use the public Safe Bash command exports with the caller's injected safe-fs.
2. Inject an external backend implementing retained range reads, retained staged
   writes/cleanup and conditional publication. For hardlink-preserving ZIP updates,
   require `atomicStagedFileMutation`. Record which capability profile was exercised.
   Keep scratch data in that same authorized filesystem. Do not mount host temporary
   files, a private memory filesystem, or a mock as qualification storage.
3. Verify that the adapter does not collect complete downloads/uploads, maintain
   an unbounded object cache, or retain historical file versions in the isolate.
   Instrument adapter queues, range responses, unacknowledged writes and retained
   handles independently of external stored bytes. Report backing storage bytes
   separately; a RAM spool is part of isolate memory, never an external spill.
4. Stream stdin and stdout (`captureOutput: false`). Generate deterministic input
   in reused 64 KiB slabs; receive output with a streaming hash/CRC consumer outside
   the measured isolate. Do not allocate the input archive or captured output in
   the Worker. Use an independent archive reader to verify bytes and metadata.

## Increasing workloads

Run each workload with 8, 32, 128 and 512 MiB payloads, then 2 GiB when the configured
service/storage limits permit. Keep policy byte limits above each workload rather
than reducing the workload to historical buffering caps. Separately vary member
count (128, 2,048, 32,768 and 131,072 tiny members), path/extra/comment lengths, and
central-directory order. Mark unavailable runs as unmeasured, never passed.

- ZIP STORE and DEFLATE creation/update, stdout output, retained input and staged
  nonseekable/stdin input; ZIP64 and split-volume input/output.
- Plain, traditional encrypted and AES-128/192/256 archives, including authenticated
  stdout/file extraction, archive integrity testing, password failures, bad CRCs,
  truncated ciphertext and corrupt final authentication tags.
- ZIP grow, delete, copy, repair (`-F`/`-FF`), SFX adjustment/removal, file comments,
  CRLF conversion, move and hardlinked archive updates where the backend supports them.
- TAR append, update, delete and concatenation, including long names/PAX records,
  recursive sources, repeated member names and links. Verify preserved old records
  and replacement atomicity against an independent reader.

For authenticated extraction, explicitly observe the output destination while
input is pending. Neither stdout nor a final file may expose member plaintext
before verification succeeds. Corrupt members must leave no published replacement.

## Measurements and controls

For every cell record total input/output bytes, external scratch high-water bytes,
maximum outstanding read/write bytes, maximum live metadata runs/handles, time to
first accepted output byte, wall time and actual CPU time. Distinguish the first ZIP
header from the first payload byte, and authenticated plaintext latency from archive
read latency. Add a slow sink and delayed external reads to verify bounded queues.

Use actual workerd isolate-memory profiling/heap snapshots and process memory
telemetry with the isolated runtime baseline subtracted and its limitations stated.
For Cloudflare use the available deployed-isolate memory diagnostics and request CPU
telemetry; record sampling intervals, missing samples and measurement API limitations.
If peak isolate memory cannot be measured in an environment, mark its memory result
unmeasured. Node heap/RSS, host process RSS alone, successful completion, or nominal
platform limits are not Worker peak-memory qualification.

Warm up separately, then run at least five measured repetitions per cell in
randomized size order. Report median and maximum CPU/latency and the maximum measured
memory, with raw samples. Fixed-member-count payload growth must not produce
payload-proportional working-memory growth. Tiny-member growth must spill metadata;
report its bounded windows and the run-count bound separately from provider storage.
Do not hide namespace/identity receipts, codec workspace or in-flight network buffers
from the working-memory accounting.

Repeat representative large-payload and many-member cells at concurrency 1, 2, 4
and 8 in the same isolate. Record the actual isolate assignment; separate-isolate
requests do not prove within-isolate concurrency. Account for per-invocation budgets,
shared adapter caches and aggregate live scratch. Stop and diagnose any memory/CPU
limit failure; do not relabel a smaller rerun as qualification of the failed cell.

## Failure and cleanup checks

At input acquisition, a held range read, a held staged write, sealing, authentication
and publication, inject cancellation and storage/sink errors. Include delayed
rejections and falsey cancellation reasons. Observe that settlement waits for
admitted operations to retire, the original destination remains intact before
publication, replacements are not removed by stale cleanup, and owned scratch is
removed. Exercise source replacement, hardlink aliases, renamed staging ancestors
and version changes; retain the provider's documented identity/atomicity limits.

Store temporary telemetry and output hashes under `/out` while running this plan.
Record a concise result with exact versions, workload denominators, unsupported or
unmeasured cells and failure explanations in the authorized tracking system, then
purge temporary output. Report code delivery, Worker qualification and release
publication as separate outcomes.
