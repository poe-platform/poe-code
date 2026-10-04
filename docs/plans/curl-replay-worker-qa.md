# Curl retained replay Worker QA

This is a manual qualification plan, not a claim of measured Worker performance.
The deterministic tests establish bounded engine storage requests and byte
identity; a Node heap measurement does not qualify workerd or Cloudflare Workers.

1. Record the exact commit, workerd version/Cloudflare compatibility date and
   deployment settings. Inject an authorized external safe-fs backend with retained
   staging cleanup/writes and retained reads. Record its range/write chunk limits,
   buffering and identity guarantees. Do not use MemoryFileSystem for the memory
   qualification. Include a separate memory-backed control to demonstrate its
   expected payload-proportional storage cost.
2. Use a controlled HTTP endpoint that hashes streamed upload bytes, sends 307 and
   308 redirects, returns a retryable 503 once, and can delay consuming chunks.
   Stream generated/reused binary chunks through curl `-T -`, `--data-binary @-`,
   URL-encoded data and multipart stdin. Compare resulting bytes/hashes and status
   with native curl against the same endpoint. Include empty and ragged chunks,
   NUL/CR/LF/high bytes, and denial of the second origin before any upload there.
3. Run 1, 16, 64 and 256 MiB inputs, with concurrency 1, 4 and 8. Keep control
   limits fixed and payload quotas sufficient. Observe both initial upload and
   replay separately, using a slow storage writer and slow network consumer.
   Record actual isolate peak memory from workerd inspector/Worker telemetry,
   CPU time, wall time, endpoint time to first byte, storage requests/bytes,
   maximum in-flight read/write bytes, status and final hash. Record baseline
   idle isolate memory and sampling resolution. Mark unavailable metrics unknown;
   never substitute Node heap-only numbers for Worker measurements.
4. Confirm replay memory plateaus as payload size grows (allowing per-request
   fixed costs), engine read/write requests never exceed 16 KiB, awaited writes
   have at most one chunk outstanding per body, and original upload first-byte
   delivery does not wait for the complete input. Instrument the external backend
   to prove it does not concatenate or cache the full payload. Account separately
   for the producer's own chunk and materialized URL/header/config control state.
5. Abort during staging acquisition, a delayed write, a replay read, and a network
   sink wait. Inject storage exhaustion, finish/read failures, and replaced or
   mutated staging objects. Confirm caller cancellation identity, curl replay
   status 65, no unauthorized requests, no retries from partial stdin, and cleanup
   of owned objects/handles. Changed foreign objects must survive failed cleanup.
6. Check concurrent commands sharing the same working directory; verify distinct
   staging names, per-hop authorization, byte identity and cleanup. Repeat ordinary
   upload files with streaming reads disabled but retained range reads enabled;
   forbid payload-wide readFile. Check downloads still stream and honor output
   publication and cancellation. Exercise wget input lists and curl config/header
   inputs at explicit control limits; these are materialized control state.

Store temporary run evidence in /out, report actual measurements and environmental
limits, and purge temporary evidence after recording the qualification result.
