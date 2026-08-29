# Future static asset and loader authority — NOT GRANTED

Exact emitted-byte graph is in LOADER.json, derived by reading authenticated
TYPE-02 JavaScript as data, never importing it. The root-side static import
graph reaches seven JavaScript assets; the Worker entry graph reaches nine;
the union is eleven. The twelfth emitted JavaScript file, types.js, is an empty
type-erasure artifact outside these runtime edges. All twelve declarations
remain part of the retained 24-emission census. No loaded-module count exists.

## Required exact edges

- transport/owner.js -> node:worker_threads
- transport/worker-entry.js -> node:worker_threads
- transport/validation.js -> node:util
- limits.js -> node:timers/promises

LOADER.json binds each importer hash and each relative source-defined import.
The parent creates new URL('./worker-entry.js', import.meta.url); there is no
.ts loader, legacy dist fallback, arbitrary worker URL, Worker factory injection
or public/private options object for bootstrap flags in this source API.

Owner options are exactly workerData {operation:'shell-ere',version:1}, env:{},
execArgv:[], stdout:true, stderr:true, old-generation128MiB/stack4MiB. Startup and
request timers are3000/1000ms. Those V8 limits are not RSS/process-wide caps.
The entry admits exactly operation/version, sends an exact ready frame and
allows one request at a time. No extra observation fields/messages/ports may
be silently added: the present owner/entry schemas reject them.

## Why the present harness does not qualify runtime

The retained typecheck-v2 harness only invokes the pinned Node binary with
tsc.js and compiler flags. It has no Worker loader/permission preseal, package
installation/move dispatch or actual load recorder. Its successful compiler
children are not Worker startup, permission inheritance, output-warning or
resource-limit evidence. Existing Expr/Node/SafeJS grants do not transfer.

execArgv:[] omits parent CLI loader/bootstrap arguments; env:{} omits parent
NODE_OPTIONS. A parent-only loader witness therefore cannot be called an ERE
Worker load witness. The behavior of a selected Node permission model, its
worker-thread authorization and inherited/explicit per-worker rules must be
pinned and qualified separately. Do not assume empty execArgv grants or denies
particular OS capabilities. No permission behavior was probed here.

## Smallest future recipe to preseal after repair

1. Select the repaired source/full emission manifest; bind the exact Node22.22.2
   executable or explicitly reviewed successor, source/emission tools, approved
   parent launcher and exact allowed importer-to-builtin edges. No new runtime
   dependency or engine source replacement. Engine R01 remains outside the gate.
2. Materialize only regular owned assets and explicit ESM package.json metadata
   at three separately bound layouts: source-built (compiled adjacent .js, not
   running raw .ts), offline-installed, and physically moved package. Name/read
   authorize exact canonical roots. Do not inherit a mutable ancestor package
   context, source checkout, NODE_PATH or original installation after move.
3. Keep the unmodified owner options literal. If a loader/bootstrap or controlled
   Worker factory is needed, request a precisely hashed instrumented overlay and
   importer authority; its results are instrumented, not unmodified acceptance.
   Do not add stderr telemetry (it is a protocol refusal) or undocumented ready
   keys merely to make the harness convenient.
4. For the unmodified route, bind the actual Worker entry URL and immutable
   asset bytes before/after and execute path-discriminating entry/import-negative
   controls. Label manifest/path inference separately from any actual in-Worker
   loader trace. A complete trace needs its own reviewed mechanism; none is
   implemented here. Unknown loads or warnings are retained/refused, not stripped.
5. Preseal actual case-to-Worker/start counts, all parent/child resource and raw
   capture ownership, Node flags/permission decisions, timeout/abort/stream
   retirement and explicit result judges. The author's proposed24-Worker ceiling
   is not a supplied complete32/60 execution map or execution authorization.

The existing private API also has no async publication hook. Any future test
instrumentation returning host promises must own/join them; passing async
callbacks into a void onFailure/visit slot is not an ownership mechanism.

All future package/permission/bootstrap/load controls are UNRUN. No compiler,
Worker or engine execution, source edits, runtime integration or new loader
capability is authorized by this review.
