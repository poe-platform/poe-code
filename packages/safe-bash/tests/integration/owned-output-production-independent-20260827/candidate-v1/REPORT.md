# Independent owned-output production review — 2026-08-27

## Verdict and exact input

**Scoped acceptance of the nine-path cooperative owned-output implementation.**
No new product defect was demonstrated by this review. This is not production
promotion, a whole-product gate, universal host preemption, complete first-read
cancellation, or acceptance of the other features present in the package.

- Product: `eba049535d154f4e028f57ffd8efd7622b2239ca`.
- Tree: `62d75ef09e89d4d3b6afc032c518d2846dcd03b7`.
- Baseline: `a03b9288a6f4b652387be9fefa8faf17ef58b9e7`.
- Scoped nine-path binary diff SHA256:
  `83b339002970df881efb56cc50fa0e0e74f1f832edb6c8706287827a3dc5e4ad`.
- Complete moved npm tarball SHA256:
  `280b76a2a3577176716534e13d2e10475eb8a13e423190a24d25555a050f72e1`.
- 260 archived source/script/root inputs authenticated to candidate Git blobs;
  826 installed package files unchanged. All 36 child runs authenticated the
  same 184 actually loaded package modules; no archive/live source fallback.

The candidate **commit** changes nine production paths and five author fixtures.
The full baseline-to-candidate source diff additionally contains four intervening
expr paths: `src/commands/expr/{README.md,evaluate.ts,index.ts,internal.ts}`.
They were not removed from the archive or silently overlaid, and are **not approved
by this lifecycle review**. The nine owned parent blobs equal their baseline
blobs. `streams.ts` changes only its import and cat implementation; all other
stream-command bytes match. `src/shell/input.ts` and
`src/commands/network/shared.ts` match the baseline exactly.

## Independently executed cohorts

| Cohort | Result | Qualification |
| --- | --- | --- |
| Unchanged `07bb6a79` expectations | 36/36, no skips | Two complete passing runs; final `execution-1787862355851` includes the stronger admitted-acquisition pending assertion and protected-tree inventory checks. |
| Strict moved-package public consumers | 1 positive, 8 rejected negative types, 1 factory-identity check | Root, contracts, contracts/output, network types; legacy optional-member compatibility retained. |
| Binding/availability/permission controls | 11/11 | Exact package and copied engine positives; tamper, missing root/package/engine, source/symlink fallback, unexported runtime and forbidden private read negatives. |
| Behavioral mutations | 7/7 detected | Each original package control passes; each one-site compiled mutant parses, runs, naturally fails the intended assertion. No loader rejection or supervisor kill counted as detection. |
| Unchanged core/contracts/shell/cat/network regressions | 505/505, no skips | Exact candidate source plus its built worker output; 27 entrypoints, concurrency 2. Separate from moved-package results. |
| Actual current SafeJS profiles | 25/25, no skips | 8 surface + 11 lifecycle + 6 zero-cap profiles; two surface rows are dialect/rejection observations, not successful guest capability or membrane proofs. |
| Original first-read cohort | **2/6 pass, 4 fail**, no skips | Unchanged assertions; not merged into the 36-case verdict. See below. |

The 36 literal expectations and scorer were frozen before the candidate at
`07bb6a79ef46bb121d02261bdc5f9072b7491049`. Executable bindings and additional
controls were implemented **after** the candidate; this is not a pre-source
hidden-driver claim. The original freeze's `0/36` preparation record remains
unchanged. None of its expected values/order relations was revised.

The seven mutations remove late-acquisition waiting, child tracking, accounted
writes, closed-scope admission rejection, falsy execution-rejection preservation,
zero-redirect enforcement, and cross-origin credential stripping respectively.
Some controls protect pre-existing behavior as well as the new implementation;
they are not seven newly fixed product bugs.

## API and behavior checked

The actual public shape is optional `ByteSink.ownedOutput` with
`consumerClosed: AbortSignal` and `write(Uint8Array): Promise<void>`, not an
invented `accountedWrite` property. `createOutputOperation(context, destination)`
returns `signal`, `output`, `registerCleanup`, generic `acquire`, `child`, and
idempotent `close`. `HttpRequest.registerCleanup` is optional and typed.

Controls exercise synchronous cleanup registration before acquisition, admission
closure, late acquisitions, release failures and falsy rejections, drain-all,
explicit children, sibling leases, parent/child normal close, caller-reason
precedence, abandoned rejection observation, bounded/accounted output, borrowed
bytes, transient awaited writes and legacy unenrolled behavior. A fulfilled
nonzero command result is not an execution rejection. Ordinary command throws
converted by the shell into status/diagnostics are also not public rejections.

Actual curl/cat controls include streaming stdin without complete-input staging,
shared-cursor tail retention, late response/request cleanup, zero retry/redirect
caps, per-hop authorization and credential stripping, file/header/stderr work
surviving stdout closure, and task-owned loopback HTTP client-close witnesses.
They do not claim server-side socket-event delivery is synchronous with client
settlement. No network provider credentials or external service were used.

## Current engine and resource isolation

Actual private engine HEAD was
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, package `@poe-code/safejs` version
`0.0.1`. Each family used **264 regular-file copies**, with the current 63-module
engine closure authenticated at load time. The source-hook adapter uses the real
`run`, budget and host-operation code, not a mock or an implicitly installed
private package. No TEMP production overlay or upstream proposal was applied.

The 25 existing guest/scorer inputs are pinned to
`a61e63bc46e8389e59c0d8fdc1d424003f62c769`; binding-only setup changes point them
at this moved package and copied engine. Surface assessment function bytes are
unchanged. Surface reflection/spread cases retain their qualified rejection
profiles; no universal reflection containment conclusion is drawn from them.

Private HEAD, status, staged state/index hash, selected root metadata, and all
264 eligible engine files' hashes/mode/mtime/ctime are equal before execution,
after all 25 profiles, and after the negative controls. Existing private user
changes remain untouched. Loader and permission controls refuse private imports
and filesystem reads; missing runtime is a real failed load, never a success or
silent skip. No private build/install/worktree/symlink was created.

Node **22.22.2** runs the build, package, 36-case and regression cohorts.
Node **24.11.1** runs the explicitly qualified synchronous authenticated-loader
SafeJS profile; its child permission flags and binary hash are recorded. This
does not raise the product minimum or claim a Node22 guarded-engine result.
Trusted TypeScript tooling is separately copied/hashed; its initial compiler load
is not misrepresented as an authenticated engine-module trace.

All successful candidate/control children exited naturally. The final process
receipt finds zero processes referencing this review's unique workspace. N07
awaits owned client closure before public settlement and task-owned server socket
closure before test completion. Protected source/package inventories reject
added, removed, changed, symlink and empty unexpected directory entries; no claim
is made about unrelated global resources or arbitrary concurrent mutation.

## Original first-read requirements remain separate

`tests/shell/remote-close.test.ts`, selected with its unchanged first-read name
pattern, emits these exact results on both review executions:

- `hard-deadline pipeline close: first-read-head-zero`: pass (zero-read control).
- `hard-deadline pipeline close: first-read-s3`: pass.
- `hard-deadline pipeline close: first-read-local`: fails its unchanged 1200ms
  deadline for the **unenrolled custom** `pending-stream` handler.
- `hard-deadline pipeline close: first-read-webdav`: fails the existing
  `observed?.aborted === true` assertion.
- `hard-deadline pipeline close: first-read-curl-body`: same assertion fails.
- `hard-deadline pipeline close: first-read-curl-headers`: same assertion fails.

For HTTP profiles that observation captures whole command-context cancellation,
not the new destination-owned operation signal. Raw events show command/public
progress, but the old stronger assertion still fails and is **not waived**.
Their later source-close assertions are not reached; do not infer their success.
All six child groups report no supervisor timeout, oversized output, or residual
process group. Original child teardown remains failure containment, not acceptance
rescue. Thus only one of the original five additional custom requirements passes
here, alongside the pre-existing head-zero control.

## Retained driver/setup failures

All recorded raw execution attempts remain in the evidence bundle:

- Initial 26-case run: 25/26. E02 incorrectly used an ordinary command throw,
  which is converted to a result. Binding was corrected to actual public input-
  finalization rejection for Error/false/0/undefined. Frozen expectations stayed
  identical; initial driver is retained in `6f2f0abb`.
- Initial 10 network cases: 9/10. N07's host-server witness used one event-loop
  turn rather than awaiting each socket's close promise. Correcting that test
  cleanup required no product change; initial raw result remains.
- Initial legacy replay: 504/505. The capture omitted dynamically launched
  `tests/shell/output-accounting-bounds.ts`. Adding its exact candidate blob
  during setup produces 505/505; no input/assertion/source rewrite occurred.
- Type control calibration encountered correct TS2741 missing-member and
  TS2322 generic-return diagnostics, rather than the driver’s initially guessed
  codes. Final controls bind the exact observed relevant diagnostics.
- Guard preparation first used an incorrect relative engine path, then attempted
  to mutate a read-only **copy**. Both setup failures remain; the final mutation
  changes permissions on its isolated regular copy only.
- Early archive/npm setup and evidence-seal checks failed before acceptance
  capture (buffer size/config-file collision; whole-baseline versus scoped diff;
  combined import spelling). Harness history preserves corrections. These are
  not candidate product failures, passing negatives, or retries of product logic.

## Evidence and reproduction

`CHECKPOINT.json` contains exact bindings and scoped counts. `MANIFEST.json`
authenticates the compressed `EVIDENCE.json.gz.base64` bundle: 659 files including
all successful/failed execution logs, observations, load traces, package/source
maps, mutation output, private guards and public diagnostics. It contains no
vendored engine implementation. `verify-evidence.mjs` checks every evidence hash,
the committed harness, and all 260 candidate Git inputs without rerunning tests.

To make a **new, separately recorded** reproduction, run `prepare.mjs`, then
`execute.mjs`, `public-controls.mjs`, `mutations.mjs`, `safejs-review.mjs`,
`binding-controls.mjs`, and `legacy-review.mjs` using the recorded runtimes/tools.
The versioned binding-control driver intentionally refers to the sealed SafeJS
copy directory; adapt only that external location for a new run and record its
driver hash. `seal.mjs --capture` is a one-time capture of the named runs, not a
canonical test; it refuses to overwrite evidence. No default canonical test
writes these committed artifacts.

Build and strict public types pass within this scope. **No full maintained
typecheck or whole-product gate was rerun or declared green**. Root-reported 13
foreign-test diagnostics (three regex continuation and ten du capture bindings)
remain outside this verdict. Author-only 42/203/9/4 cohorts are not counted as
additional independent results. Root retains the promotion/integration decision.
