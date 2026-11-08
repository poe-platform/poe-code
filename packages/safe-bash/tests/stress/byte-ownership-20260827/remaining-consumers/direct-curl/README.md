# Direct registered curl attribution: exactly two cases

Owned scope: this new `direct-curl` subtree only, plus the explicitly requested
`/tmp/byte-remaining-direct-curl-{findings,ready}.txt` handoff files. No product,
filesystem adapter, runtime, dependency, root export, or parent fixture changes.

## Contract and public API admission

- `src/index.ts` exports `CommandRegistry`, `CommandContext`, `createCurlCommand`,
  and `MemoryFileSystem` through inspected public barrels. The test registers
  the actual public curl definition, gets it back from the registry, then calls
  its public `execute(context)`. No private body helper import or invented API.
- `src/contracts/command.ts` declares `stdin: ByteSource` and the public execute
  handler. `src/contracts/io.ts` declares `AsyncIterable<Uint8Array>` and
  `readBytes` forwards chunks without ownership transfer. `AGENTS.md` explicitly
  requires copying retained fragments before producer advancement/finalization;
  Buffer slice/subarray are views. No inspected contract transfers stdin ownership.
- `src/contracts/command.md` permits direct/custom hosts to omit registerCleanup;
  command finally remains required. This is not a Shell cancellation barrier test.
- Network `types.ts`/README accept an explicitly configured trusted transport,
  require encoded byte preservation/backpressure/cancellation, and describe
  bounded stdin caching for 307/308 replay. They grant no request-byte mutation
  or ownership-transfer permission to the transport.

## Frozen design

Two cases only: reused nonzero-offset Buffer and native Uint8Array, with identical
literal input and independently stated first/second expected upload vectors in
`expectations.json`. Payload includes NUL, high bytes, invalid UTF-8, LF and CR.
Four empty views surround/interleave three data views. The producer mutates only
when resumed for the next read and in its finally block; no concurrent mutation.

The trusted transport snapshots each request chunk into numbers before advancing
its iterator. It never mutates or transfers request bytes. First request returns
307 with `/replay`; second returns 200. Both are same-origin, explicitly authorized
synthetic requests with no network I/O. Stdin must finalize before second request
admission, and replay must equal the first literal vector, not finalizer-fill bytes.

The redirect response body is never started, so returning its generator closes it
without entering finally (expected finalization zero). The final response empty
body is consumed and finalized once. Both actual response dispose callbacks run
idempotently; the harness awaits their shared cleanup promises and generator
returns. Upload iterators, active transport counts, source finalizer, errors,
stdout/stderr, request calls, authorization calls and statuses are recorded.

## Freeze, execution and boundary

Commit these fixtures, expectations, runner and `source-pin.json` BEFORE execution.
The pin records inspected-file hashes and a digest over every tracked source path
and its SHA256. The runner verifies frozen tracked content, records before/after
source and fixture hashes, and refuses to overwrite first execution artifacts.

Run from the repository root:

```
node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/run.mjs
```

The child uses existing tsx and strict unhandled rejections, two serial node:test
cases (7-second case watchdog), cooperative 3-second invocation abort, configured
2-second curl deadline, and a 20-second child watchdog followed by bounded kill.
All owned cooperative work is awaited. Child close is recorded, not inferred
from Promise.race. Native processes are harness-only; no native network oracle.

Any genuine Buffer replay failure is preserved as a failing assertion and written
immediately to the requested findings handoff before the native counterpart runs.
Expected bytes are never changed to match actual output. No production fix is
authorized. Harness defects, if any, must be reported separately.

This profile imports the public ROOT SOURCE with tsx. It proves neither packed
package behavior nor Shell/pipeline behavior. The separate parent's 22-case packed
Shell cohort is outside this leaf's ownership and evidence.
