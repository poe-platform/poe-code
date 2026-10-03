# Safe Bash noncapturing Worker QA

Run against the exact delivered commit and record workerd/Wrangler versions,
compatibility date/flags, deployment configuration, backend and resource limits.
This is a manual qualification plan, not a claim of deployed Worker measurements.

1. Deploy a Worker using the public portable Shell SDK with an injected external
   safe-fs backend. Stream stdout/stderr through awaited sinks with
   `captureOutput: false`; close response streams only after execution settles.
   Connect request cancellation to exec and await cooperative cleanup. Avoid an
   unconsumed stderr pipe blocking stdout. Record backend stream/readFile/spool
   calls, bytes and object cleanup, and reject private RAM/host-temp substitutes.
2. Generate 1, 8, 32, 128 and 512 MiB inputs externally. Use fixed 16 KiB source
   chunks, a fixed pipe high-water mark, `cat` and `cat | cat`, plus a nested shell
   and a background job followed by wait. Consume response bytes incrementally
   and verify a rolling digest and byte count, including binary/NUL/invalid UTF-8.
   Never collect responses into arrayBuffer/text for this cohort.
3. At each size, measure actual isolate/process peak memory with workerd runtime
   tooling and deployed platform memory diagnostics where available, CPU time
   from Worker invocation telemetry, wall time and first-byte latency at the
   client. Record baseline, warm-up, at least five repeats and measurement
   precision. If deployed memory telemetry is unavailable, mark it unmeasured;
   neither Node heap sampling nor successful requests establish Worker memory.
4. Repeat with fast and throttled clients and 1, 4 and 16 concurrent requests.
   Record in-flight transport bytes and memory per concurrency level. Memory
   should scale with concurrency and fixed buffers, not total input bytes.
   Investigate any payload-proportional increase before qualifying the path.
5. Cancel before start, during reads and during a blocked sink write. Inject
   backend read/write and sink failures. Verify terminal outcome, prompt cleanup,
   no continued admitted reads after cancellation and no leaked backend objects.
   Repeat session jobs whose output continues after the foreground turn returns.
6. Compare small binary/status/effect fixtures against native Bash, keeping
   stdout and stderr separate. Check CLI and SDK produce the same output and
   statuses. Buffered exec is a compatibility control, expected to scale with
   output; do not use it as the Worker production cohort.
7. Separately measure `v=$(cat input)`, arrays, process substitution and buffering
   commands. Report their retained semantic data independently. Exercise explicit
   output/expansion limits; do not advertise these cohorts as constant-memory
   programs or lower file limits to obtain an apparent pass.

Keep temporary measurements in `/out`, then purge after recording the relevant
results in the delivery report. Report runtime correctness, measured scaling and
external-backend interoperability separately; unavailable measurements are not passes.
