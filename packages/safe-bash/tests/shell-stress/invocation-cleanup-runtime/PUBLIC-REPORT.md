# Registered grep/rg public runtime author follow-up

August 27, 2026. **10/10 actual public real-worker author cases pass.** This is
new author evidence, separate from the prior 43 custom cooperative cases and
Arch/independent cohorts. Runtime remains frozen; no product source was edited.

## Pins and execution profile

- Runtime: `4c16d9c5a0e8661bc326a754205559a3e7ea6a32`.
- Registered grep/rg callbacks and session client:
  `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
- Invocation contract: `07acb1a4d30b7592cf247a0220250317be4e2038`.
- Test: `tests/shell/invocation-cleanup-public.test.ts`.
- Observer: `public-worker.mjs`. Detailed input/import/source/emitted hashes,
  boundary snapshots, native events and child statuses: `public-summary.json`.

Before acquisition, the test verifies live runtime, shell, cleanup, grep, rg and
regex-client SHA-256 against the frozen pins. It archives the **complete tracked
source plus package/build configuration** from runtime commit `4c16d9c` into a
unique canonical temporary directory outside the repository. That commit already
contains callback revision `01aa1bf`. The snapshot source is not rewritten.
TypeScript development tooling is linked explicitly; fresh compilation succeeds.
No existing `dist`, private engine or copied command implementation is used.

Each case runs in its own Node process and imports the snapshot package's actual
public root `dist/index.js`, resolved from its unchanged package export. Public
`Shell`, `CommandRegistry`, `MemoryFileSystem`, `createStandardCommands` and
`createSearchCommands` register the real, unwrapped grep/rg/head definitions.
The main-thread loader checks all 157 loaded product modules against the emitted
census. Native regex worker entry URLs and emitted hashes are also checked.
Worker-thread dependency imports are not separately instrumented; their complete
freshly compiled snapshot is recorded in the emitted census.

Node v22.22.2, Darwin arm64. The first exploratory execution passed the same ten
cases using explicit 3000ms startup/request, two-worker and 5000ms idle policy.
The final execution uses **product defaults for normal/early-pipe/caller-abort**.
Only sibling cases set `idleTimeoutMs: 5000`, keeping the shared session available
while inputs are deliberately gated. The policy change is explicit; these are
ten unique final cases, not twenty independent tests or unchanged-policy repeats.
Both raw executions are retained, with their distinct observer hashes.

## Native observation, not a telemetry API

The isolated host installs an observational subclass of Node's actual Worker
before loading product modules. Construction and `postMessage` delegate to the
native implementation. `terminate()` calls the native method and returns **that
same promise**, while observing its completion. It adds no delay, replacement
result, worker stub, command wrapper, cleanup hook, timeout abandonment, global
executor disposal or manual termination. Worker `exit` is independently recorded.
These observations are harness instrumentation, not a new product API contract.

Every asserted owned boundary requires both the native exit event and completed
native termination promise. Caller-abort cases deliberately abort immediately
after a real nonempty matching request is sent; the exact object reason must
survive, with empty external stdout/stderr. This is the scenario's caller abort,
not a fallback cancellation used to rescue incomplete cleanup.

## Results

| Real registered command | Normal | Early pipe | Caller abort | Same-Shell sibling | Other-Shell sibling |
| --- | --- | --- | --- | --- | --- |
| grep | pass | pass | pass | pass | pass |
| rg | pass | pass | pass | pass | pass |

The exact user script `grep -E '^a' | head -n 1`, with stdin consisting of 200
`ab\n` records, returns status 0, exact `ab\n` stdout bytes and empty stderr.
Its own worker has exited and native termination is DONE **at exec settlement
and again after awaited dispose**. The rg equivalent has the same assertions.
Normal executions return all 200 records and also await retirement at both
boundaries. There is no post-exec waiting to make these assertions pass.

Sibling controls share the same actual command definitions/executor across
concurrent invocations, either in one Shell or in two Shells. One session remains
open on gated input while another matching request is caller-aborted. The aborted
invocation awaits its own worker retirement without cancelling the sibling signal.
For two Shells, disposing the cancelled Shell must also leave the sibling open.
The sibling then performs another real worker request and returns `bb\nbb\n`
successfully. This detects executor-wide cancellation and does not equate an
individual invocation's cleanup with global worker-zero ownership.

The final run observes 14 actual worker instances and 30 boundary snapshots;
these are resource/observation counts within **10 cases**, not additional passes.
All native retirements complete, all ten children exit 0 naturally, no child is
killed by its deadline, and no late unhandled rejection is reported. Test process
deadlines are 10 seconds per child, 15 seconds per test and 150 seconds outside
the complete run; snapshot build is bounded at 45 seconds. Production cleanup
has no added deadline. Snapshot directories are removed and verified absent.

## Typecheck and scope limits

Global `npm run typecheck` ran **once** after focused real-worker tests. It exits
2 with **20 foreign diagnostics**, not merely the earlier six:

- One `src/commands/tree/tree.ts:77` ES2023 `isWellFormed` library mismatch.
- The original six native-fixture TS2304 `hit` diagnostics.
- Thirteen unrelated WebDAV atomic-extension capability-test diagnostics for
  missing exports/options and implicit-any callback parameters.

No owned test diagnostic appears. The shared live tree continues to change under
other owners; this is the result at that single check, not a claim about later
foreign fixes. No foreign source/test/configuration file was edited or removed,
and global typecheck was not rerun. The final JS observer changes only the regex
policy and evidence flag; the TypeScript test remains the checked version.

This follow-up is a compiled-public-root **author** run, not a packed-package
run, not the independent unchanged 22-case holdout, and not Arch's frozen five
premature observations per compiled/packed format. Those counts, original red
evidence and the separate 99/100 legacy-close result remain untouched and are
not pooled or reinterpreted. No independent holdout or Arch fixture was inspected
or edited. Five custom pre-first-read failures remain separate/open; they were
not rerun. No runtime defect was observed, so no source authorization was sought.

Reproduce with `node --import tsx --test tests/shell/invocation-cleanup-public.test.ts`.
The test itself bounds and isolates each real-worker process and snapshot build.
Raw `public-first.tap`, `public-final.tap` and `public-types.txt` are retained
beside the structured summary; previous evidence files are unchanged.
