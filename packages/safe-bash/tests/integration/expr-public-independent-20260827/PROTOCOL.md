# Later execution protocol — all product work NOT EXECUTED at freeze

## PRE-run binding (mandatory, not a post-hoc label)

Before any candidate import/build/install, write a unique evidence record binding
this freeze commit/tree, each fixture SHA-256, candidate full Git commit/tree,
accepted DU75 baseline commit and exact names, source/test/consumer inventory,
Node/TypeScript/npm versions, platform, effective Node flags, compiler options,
loader implementation and worker observer/control hashes. Record root's acceptance
and whether the candidate is strictly committed or dirty. Never mix live product
files into a committed candidate. Candidate hash must not be derived from success.
Verify complete input trees including added entries before/after; original-path
hash comparisons alone do not prove an append-proof tree. Store every failed
attempt without overwriting earlier evidence. No baseline acceptance is implied.

The future host must emit per-case start/end/failure, commands, environment,
signals, exact bytes/status, loader/worker receipts, and its own errors. A failing
harness self-check remains a harness failure, not a product pass or product defect.
No synthetic observation arrays, unresolved tests as pass, source-stub consumers,
or newly invented module/type names. Run each type/runtime package context against
the same candidate artifact. Installed/moved positives require the **full pack**,
not a hand-picked dist directory.

## Package/control matrix (8 IDs)

| ID | Concrete later action and required evidence |
| --- | --- |
| P01 | Build/pack the bound whole candidate in isolation using its real package configuration. Preserve full tarball bytes/hash, file inventory and manifest. Verify package name virtual-bash, real root and expr export types/import targets, zero runtime dependencies, physical expr declarations and the actual regex worker dependency layout. Do not replace missing files with fixture stubs. |
| P02 | Install that full tarball in an isolated ESM consumer, without symlinks to the repository. Import only `virtual-bash` and `virtual-bash/commands/expr`. Run all 26 runtime IDs after future R25/R26 binding and both strict fixtures; authenticate every resolved product JS/declaration path under that installed package. |
| P03 | Move the whole installed consumer/package to a different absolute path. Make the original consumer, build tree, and source checkout inaccessible to the child. Re-run the same complete cohort, including real worker matches and types. Hash the installed package before/after; loader or worker attempts at original paths fail. |
| P04 | Separate control copy: remove only the root expr factory export used by a dedicated public consumer. Require loader proof that the installed root entry loaded and the intended missing-export assertion fired. Missing package, parse errors or wrong candidate import do not qualify this control. Leave all unrelated root exports intact. |
| P05 | Separate control copy: deny/remove only the expr package export. Dedicated dynamic import of the exact subpath must reach export resolution and reject with ERR_PACKAGE_PATH_NOT_EXPORTED; an unrelated dependency/type failure is not the intended boundary. Positive control restores the real full manifest and imports successfully. |
| P06 | Source-fallback poison: in a separate control copy, make a real installed entry attempt a known, present source-path module whose body throws a unique sentinel. Loader must record the attempted forbidden source resolution and deny it before body evaluation. Prove the poison would actually execute in a separate control without that denial. A nonexistent path or never-imported poisoned file does not qualify. Positive installed/moved loads stay under package dist; compiler traces stay under installed declarations, not src/workspace paths. |
| P07 | Worker-layout poison: first match successfully using the installed expr public API, recording real Worker constructor URL and shipped worker imports. In a new isolated control copy, remove that exact bound worker entry (or required worker-side module) and repeat the match. Constructor/load boundary must be reached, normal result must be absent, status must be 3 with expr diagnostic, and owned workers must retire before result/dispose settlement. Import-time unrelated failure is insufficient. Restore bytes for a separate positive. |
| P08 | Run the two TS fixtures as real .ts consumers with strict + NodeNext/moduleResolution NodeNext, noEmit, skipLibCheck false, installed declarations and authenticated Node types/toolchain. Positive and expect-error fixtures compile. Strip each N01–N06 directive separately in an isolated control and require its targeted type error at that call/property, not a missing module/library error. A complete directive-stripped control has all six intended diagnostics. Broken-declaration control reaches the installed expr .d.ts and fails its positive import/type assertion. Do not count masked @ts-expect-error failures as proof of intended diagnostics. |

## Observer binding and runtime qualification

Install loader and Worker instrumentation before the first product ESM import;
use the existing repository public-consumer approach, not private executor APIs.
Record actual worker URL/hash, constructor resourceLimits, online/exit events,
request admission and retirement, and their order relative to API settlement.
Bind any inspected protocol layout at candidate time openly; freeze does not
invent a ready/request message shape or a public worker-inspection API.
`observe.begin(id)`/`end(token)` are **harness interfaces**, not product APIs.
They return actual case-local `workerCreations`, `workerRequests`, arrays of
`workerOldGenerationMb`/`workerStackMb`, plus underlying event receipts. R23's
global 48/3 and direct 64/3 settings must be observed at their specific invocation
boundaries, not merely anywhere in a combined array. Verify default aggregate
policy when top-level regex is absent and invalid nested regex is present.

R17/R20 require no worker creation/request at the exact expr invocation boundary.
R24 additionally requires cleanup registration before resource admission; a
rejected registration must admit none. Repeated concurrent calls to registered
cleanup must share completion. Await natural command settlement and cleanup;
do not manufacture cleanup success by killing the child or terminating a worker
from the observer. A wrapped output sink does not create ownership by itself.

### R25 — bounded startup (future binding, not an implemented pass)

Use real `agentCommands({regex:{startupTimeoutMs:50,requestTimeoutMs:1000,
maxWorkers:1}})` and `Shell.exec("expr abc : a")`. In a qualified control only,
interpose at the actual Node Worker constructor and substitute an authenticated
live worker that never provides the real ready handshake. Keep it naturally alive
without CPU spinning. Preserve Worker/event/termination semantics. Prove the
constructor URL was the shipped worker entry, the replacement worker actually
came online, and readiness was withheld; no main-thread fake result or early
throw can qualify. Expect status 3, empty stdout, one expr diagnostic, actual
worker exit/retirement before exec/dispose settlement. An unmodified-worker
paired control returns `1\n`, status 0. If candidate protocol/observation cannot
support this boundary, report UNBOUND, never fabricate a request shape.

### R26 — cancellation, cleanup and sibling isolation (future binding)

Use one real `createExprCommand({regex:{maxWorkers:2}})` definition, two direct
CommandContexts with separate signals/registered cleanup and two invocations
`["abc",":","a"]`. Observe an admitted request for the first, then abort its
controller with a unique errno-shaped Error reason (code EACCES). Coordinate a
qualified delayed-reply boundary so this is cancellation of admitted work, not
an already completed request. First promise rejects with the identical reason;
its cleanup/retirement finishes without cancelling the sibling, which naturally
returns status 0, exact `1\n`, empty stderr. Invoke the same registered cleanup
concurrently twice and await both. Qualification must show the sibling was live
at cancellation; sequential success after both finish is insufficient.

Repeat the ownership ordering through real `Shell`/`agentCommands`, using
`shell.exec("expr abc : a", {signal})` and `shell.dispose()`. Capture actual shell
abort behavior separately from direct reason-identity assertion; retain failures
against the existing shell contract, do not impose an invented shell error shape.
Observe exec/dispose settlement only after their cooperative invocation-owned
worker cleanup, not after arbitrary host work. No helper may manually close the
product worker and call that product cleanup. Opaque host work has no forced-stop
guarantee. Candidate-bound transport interception must be disclosed and qualified
against unmodified-worker positives before the affected test runs.

## Bounds and settlement

Future supervisor limits: each case process 15 seconds, combined context 120
seconds, captured stdout/stderr at most 1 MiB per process. Inputs here are tiny;
no stress corpus or performance inference. A supervisory timeout/output cap is
**failure/indeterminate**, with receipts retained, not successful cancellation.
Require natural child exit after awaited public APIs; forced process termination
only cleans failed experiments. Do not use Promise.race and abandon product work
to claim lifecycle completion. Product startup/request timers are policy guards,
not exact wall-clock SLAs; host load may delay observation. Missing worker timing
or observation binding remains UNBOUND before actual candidate execution.
