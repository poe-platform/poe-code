# Invocation cleanup: investigation checkpoint

**RED baseline; investigation only.** No product source, contracts, existing tests,
types, runtime dependencies or public API were changed. Await ROOT's final
contract hash and runtime writer lease. This is not Bash parity or a full gate.

## Frozen execution

One complete committed-source archive of
`07acb1a4d30b7592cf247a0220250317be4e2038` was built once using the existing
TypeScript development-tool link. All 196 source/config identities matched Git
blobs; all 636 emitted identities remained unchanged. The actual public
`dist/index.js` import and agentCommands aggregate were used, not a narrowed API.
The shell, grep, rg and worker client match reviewed `ef8bbe7`; this archive also
contains Curie's newly committed additive contract, without runtime support.

The bounded child ran exactly three new named controls once, with native Worker
construction/postMessage/terminate observation, no mocked matching or delayed
termination. Every terminate call delegates immediately and returns its original
promise. The input strings/hex and exact status/text/byte/sink results are frozen
in baseline.json. The abort is triggered just after a real nonempty grep request
is posted, before returning from the observational postMessage wrapper.

| Fresh case | Payload/abort control | Cleanup before exec | Cleanup before dispose |
| --- | --- | --- | --- |
| Ordinary grep, one `ab` line | PASS | PASS | PASS |
| `grep -E '^a' \| head -n 1`, 200 `ab` lines | PASS | FAIL | FAIL |
| Caller abort after content request, 200 `ab` lines | PASS | FAIL | FAIL |

Thus payload/abort controls are **3/3**; strict lifecycle cases are **1/3**;
each settlement boundary is **1/3**, with four failed boundary observations total.
The child exits **1**, and the compile exits **0**. The historical independent
review's five observations per compiled/packed run remain a separate unchanged
denominator, not this investigation's count.

Both successful commands return status 0, stdout `ab\n` / hex `61620a`, empty
stderr bytes, and byte-identical external sinks. The caller-abort case rejects
with the exact supplied Error object; it has no returned status/result and both
external sinks are empty. Each case creates one real Worker. The failing cases
still have that worker unexited with termination incomplete at both settlements.
Event sequence numbers are:

- Ordinary: termination start 4, exit 5, done 6, exec 7, dispose 8.
- Early pipe: termination start 13, exec 14, dispose 15, exit 16, done 17.
- Caller abort: termination start 23, exec 24, dispose 25, exit 26, done 27.

All three workers subsequently exit and finish termination without rescue.
A bounded observation-only wait happens **after** immutable settlement snapshots;
it does not repair or relabel the failed boundaries. No late unhandled rejection
was observed in that bounded window. No product worker was terminated by the
harness. The child exited naturally and its exact outside-repository archive was
removed without following the node_modules symlink. No children remain.

## Provenance qualification

The raw lexical `importGuard` is **false** and is preserved: Node resolves the
Darwin `/tmp` alias to `/private/tmp`. The separate provenance-review.json records
the actual `/tmp` symlink and compares all **157 actual main-thread load hashes**
against retained emitted/helper hashes under the canonical archive root. All
157 match, including the real public index. This is filesystem identity proof,
not product-output normalization, source rewriting, or a rerun for green.
The worker's `execArgv: []` means its internal imports were not loader-traced;
constructor URLs and the full frozen emitted worker graph are retained instead.
No packed package was replayed. The only child stderr is Node's experimental
loader warning, recorded separately from virtual command stderr.

Archive source/emitted/helper and the nine inspected live-source endpoint guards
pass. These are scoped guards, not a global clean-worktree claim. The baseline
keeps compiler/child status, stdout/stderr, timeout limits, events, source hashes,
tool hashes and import records. Re-running capture.mjs intentionally refuses to
overwrite baseline.json; this preparation did not rerun it.

## Diagnosis and handoff

INTEGRATION.md maps dispatch/middleware/nested invoke, pipeline races, public exec
and missing active-exec disposal ownership. CONTRACT-NOTES.md records Curie's
arrival and error-conversion/substitution/closed-admission traps. Existing command
finally cleanup is correct to await its session, but an outer interruptible race
can stop awaiting it. A private per-exec invocation tree must drain only explicit
cooperative hooks outside all abort races, preserving caller reason identity,
then selected execution rejection, then cleanup failure. Arch must register
owned-resource callbacks before acquisition; executor-global disposal is not a
substitute for per-invocation cleanup.

Primary platform basis: Node's official Worker documentation states termination
returns a promise fulfilled upon worker exit. The observation records both the
actual exit event and promise completion, not just terminate invocation. Source:
`https://nodejs.org/download/release/v22.19.0/docs/api/worker_threads.html#workerterminate`.

No hidden controls, old lifecycle cohorts, native Bash oracles, full suites,
kernel runs, env-S, first-read APIs or five-custom-command probes were run.
Future callback/admission/concurrency/error-precedence tests in the design are
**unexecuted**, not passes. Stop here; preparation does not grant a source lease.
