# Agent spawn streaming performance QA

Measure throughput separately from the shared unit run. Unit coverage in
`packages/agent-spawn/src/acp/acp.test.ts` verifies ordered, complete delivery across
multiple queue compactions and a final partial batch. CPU contention and module
startup must not turn those correctness checks into timing failures.

1. Use the supported Node version and build the selected agent-spawn workspace
   closure through `npm run build:workspaces -- --workspace=@poe-code/agent-spawn`.
   For Rust measurements, select `@poe-code/agent-spawn-rust` instead. Record the
   commit, Node version, implementation and machine load under `out/`; avoid
   overlapping test or build work while measuring.
2. Exercise the mocked-child `spawnStreaming` setup from the native output burst
   unit test with 60,000 numbered OpenCode text events. Start timing immediately
   before `spawnStreaming`, consume every event, await completion, and verify
   exact order, count and exit code zero. Warm the module imports before measuring.
3. Exercise the held-consumer setup from the adjacent backlog test with 100,000
   numbered events and the mock adapter. Await producer completion before starting
   timing and draining the iterator. Verify every event once and in order.
4. Repeat each case five times after one warm-up, then double its event count and
   repeat. Record median processing time and the scaling ratio. Investigate
   near-quadratic growth, lost events, changed order, or retention after iterator
   closure. Compare with a baseline on the same machine. The former one-second
   burst and 500 ms backlog unit cutoffs are historical reference values, not
   portable limits for a concurrently loaded test runner.
5. Keep correctness assertions active during measurements. Throughput alone does
   not establish terminal rendering latency, cancellation latency, or whole-process
   memory bounds. Store results on the relevant issue and remove owned temporary
   artifacts after use.
