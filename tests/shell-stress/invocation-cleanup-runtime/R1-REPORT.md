# R1: admitted plugin setup survives disposal admission closure

August 27, 2026. Frozen correction:
`1b133a8662a32ee84524794842074c9c98d5f6c3`.
Only `src/shell/shell.ts` changes product behavior. The commit also adds the
author regression file `tests/shell/invocation-cleanup-setup.test.ts`.

## Baseline and authorized evidence

The pre-edit shell/runtime/cleanup hashes matched candidate `4c16d9c` exactly.
Authorized independent evidence was read from commit
`45051f5a0c6e1fd8042dee0196f37545fb6eee31`: the R1 section at
`ACCEPTANCE.md:44`, `setup-disposal-review.json`, and the actual named fixture
`setup-disposal-control.mjs`. No remaining hidden assertions were inspected.
No independent fixture, contract, grep/rg, command family, root export or
dependency was changed. No work was delegated.

The independent unchanged 22-case result remains separate from its supplementary
R1 finding. The D1 explicit setup-failure catch is not newly broken; D3 completed
plugin disposal failure behavior is also preserved. R1 is the narrower D2 timing
regression: immediately disposing a Shell closes the public guard before an
already-accepted setup calls `host.use`, causing its lease-acquiring setup to
reject before successful installation and skipping its disposal callback.

The author captured **4/10 passing, 6/10 failing** on unchanged `4c16d9c` before
writing source. `r1-red.tap` retains the full original failures. These ten are a
new author cohort; six failures are multiple manifestations/adjacent controls,
not six independently found resource leaks or additional holdout failures.
The lease markers in these tests are explicit cooperative host-resource markers,
not a measurement of newly leaked native workers.

## Narrow correction

Public `Shell.use` still rejects synchronously after disposal begins. Its existing
installation logic now has a private entry point, also used by a per-setup
`PluginHost` facade. Each accepted setup has its own active capability, including
across awaits; no ambient/current/global setup flag is used. Only possession of
that particular facade permits its accepted setup's middleware and filesystem
registration while the Shell's public admission is closed. The capability ends
in `finally` on both setup success and failure.

The facade implements the existing `PluginHost` contract, not a new public API.
It is not the original `Shell` object; casting a PluginHost to an entire Shell
or depending on Shell object identity is not covered by the published PluginHost
surface or these controls. The original shared `CommandRegistry` object is
preserved, including identity and live reads used by existing plugin commands.
This fix does not globally revoke direct registry authority: a registry can be
shared with another Shell. Public `Shell.register` remains closed during disposal.

The admitted host can install middleware or filesystem factories after acquiring
a lease and awaiting asynchronous work. An unrelated caller using the Shell, or
a saved host from a completed setup, cannot borrow that privilege during another
setup's await. Saved hosts retain ordinary pre-disposal behavior while the Shell
is open, then their guarded operations reject after disposal begins.

The existing runtime acceptance of `host.use(plugin)` is retained without
widening the typed `PluginHost.use(Middleware)` contract. Nested accepted setup
can append to readiness after disposal starts, so disposal follows the readiness
chain until its identity is stable. It then reverse-disposes all successfully
installed plugins. Author coverage includes an asynchronous child and grandchild;
disposal cannot snapshot the plugin list before they finish. External plugin
admission stays closed throughout.

Explicit setup failure still rejects exec with the original reason, including
undefined/null; unsuccessful setup is not pushed into installed plugins, later
queued setup remains skipped by the rejected chain, and disposal catches that
readiness rejection as before while disposing successful earlier plugins. This
does not invent automatic failed-setup cleanup; failed plugins retain their
existing responsibility for cleanup on explicit failure.

Invocation scope/drain/runtime code, caller/error selection, public exec/invoke
admission, active-exec cancellation, and idempotent disposal promise are unchanged.
Only accepted plugin setup work is awaited; there is no added join of opaque
command/middleware/input promises. Uncooperative nonsettling plugin setup can
still hold disposal, as in its pre-existing setup lifecycle. No timeout abandonment
or arbitrary host-promise joining is added.

## Actual validation

| Run | Actual result | Evidence |
| --- | --- | --- |
| Untouched `4c16d9c` author red | 4/10 pass, 6 fail | `r1-red.tap` |
| Corrected R1 author cases | 10/10 pass | `r1-focused.tap` |
| Current-source scoped controls | 96/96 pass | `r1-controls.tap` |
| One final `npm run build` | exit 0 | exact stdout/hash in `r1-manifest.json` |
| One final `npm run typecheck` | exit 2, six foreign errors | `r1-types.txt` |

The 96-case run contains ten R1 cases, 43 prior cooperative author cases and 43
existing lifecycle/streaming/invoke/pipeline controls. It imports current source
via tsx and uses actual Shell/registry behavior. It runs no pinned public-worker
fixture, independent holdout, Arch suite, packing or broad feature/kernel gate.
Both passing test runs have zero failures, cancellations, skips and TODOs, with
natural child exit 0. Process deadlines are 15 seconds for focused/red runs and
60 seconds for the 96-case run; each new author test has a two-second deadline.
No deadline kill or caller rescue occurs on the passing runs.

The build and global typecheck each ran once after final source commit. The
typecheck retains only TS2304 `Cannot find name 'hit'` in the six foreign native
fixtures under `tests/commands/regex-execution/continuation/artifacts/native/`:
`dialect-bFUsLx/{alpha,beta}.ts`, `dialect-uhGVu3/{ab,🙂}.ts`, and
`dialect-xj7h8F/{a,d}.ts`. No owned source/test diagnostic appears and no foreign
file is repaired or removed. This is the shared live-tree check at that time;
earlier public-follow-up twenty-error results remain unchanged historical facts.

## Source identity and handoff limits

| Source | SHA-256 |
| --- | --- |
| Corrected `src/shell/shell.ts` | `538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c` |
| Unchanged `src/shell/runtime.ts` | `2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b` |
| Unchanged `src/shell/cleanup.ts` | `134f55641d6437681cd185960a2923d68086096921758717c5b8059595304385` |

The exact contract remains `07acb1a4d30b7592cf247a0220250317be4e2038`.
The original frozen source, red evidence and all earlier reports remain intact.
`r1-manifest.json` records old/new source hashes, tested file hashes, exact test
arguments, tool versions, raw transcript hashes and build stdout.

The public real-worker harness at `85e6d56` explicitly pins `4c16d9c`; it was
**not rerun or relabeled for this candidate**. Its 10/10 result remains historical
only. ROOT must route the changed `1b133a8` source/hash to Arch and a separate
verifier. No new packed, real-worker, independent-22, full-gate, native parity or
overall acceptance claim is made. The separate pre-first-read requirements and
Arch legacy-close counts remain untouched.

No source snapshot, worker, server or native fixture was created for R1. Test and
build processes have completed; only owned `/tmp` transcripts/hand-off files are
retained as evidence. Source is frozen and its author lease is relinquished for
separate verification. Future changes require ROOT authorization.
