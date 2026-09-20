# Issue 746: native asynchronous Python in Cloudflare

## Acceptance and baseline evidence

Work only in the issue-746 detached worktree. Parent owns cherry-pick, main,
publication and issue closure. No Docker-backed interpreter is a Cloudflare
implementation. Do not copy the canonical workspace into the interpreter.

At the September 18, 2026 investigation baseline, source exposed an asynchronous executor
contract but only a synchronous Emscripten filesystem mount. The maintained
workerd consumer uses a transport double, not Python. Previously demonstrated
native `fd_read` import trampolines in Node are not a complete filesystem.

A fresh local workerd 1.20260917.1 probe now starts the pinned npm Pyodide
314.0.6 loader using statically supplied main/helper Wasm and stdlib bytes.
No `unsafeEval` binding is supplied. The helper compilation request is resolved
to a precompiled module; no Wasm bytes are compiled in the Worker. A native
zlib round trip returns `[0, 255, 42]`. One measured startup was 1158 ms and the
linear memory was 31457280 bytes; this is not a benchmark or deployed limit.
The probe's length-only helper selection must become authenticated byte
admission before it is a product asset recipe.

The host glibc cannot run this workerd executable. The local qualification
launcher uses the existing node:22-bookworm-slim image for tooling only, running
the real workerd executable. All generated evidence stays in worktree `out/`.

The checked Cloudflare token/account environment variables and Wrangler default
configuration files are absent. No deployment is claimed. Managed Python
instantiates its imports before the application; no supported replacement hook
has been qualified. A custom static JSPI runtime is an independent route, not
evidence that the managed-child requirement is satisfied.

## Implementation sequence

1. Test native syscall dispatch with delayed caller-owned safe-fs, precise
   errno, transfer limits, retained descriptor identity and binary streams.
2. Install precompiled Wasm import trampolines before interpreter instantiation.
   Suspension must occur in Wasm through the pinned `syscall_syncify` export,
   never inside a synchronous Emscripten JavaScript callback.
3. Add an invocation-local asynchronous executor using the existing invocation
   parser/execution policy, with explicit borrowed loader ownership, admission,
   cooperative cancellation and retirement barriers. Keep native process and
   network access disabled; JSPI itself grants neither confinement nor CPU
   preemption.
4. Authenticate and statically supply the pinned loader, stdlib, main/helper/
   trampoline Wasm and any allowed native modules. Reject unlisted runtime code.
5. Qualify real native open/read/write, importlib source imports, native
   extensions, binary stdin/stdout/stderr, errors, backpressure, cancellation and
   sibling lifetime in workerd; distinguish source from packed public consumers.
6. Qualify the public package in a disposable deployment when deployment access
   is available, record assets/startup/memory, delete the deployment, then return
   atomic commits and exact remaining gates to the parent.

## Current qualification checkpoint (September 18, 2026)

The exported `createPythonJspiExecutor` now replaces the qualification-only
fixture. No workspace snapshot, builtins-only adapter, synchronous JS suspension
frame, Docker interpreter or replacement of the Pyodide thread-state guard is
used. Native shutdown has its own standard JSPI boundary. All changes remain
local for parent integration; no push, deployed release or issue closure is claimed.

Acceptance ledger:

1. **Custom packed consumer passes; managed native mount remains open.** The
   public Python entry exports the executor and static asset helpers. Installed
   public packages execute in real workerd without Node threads or a SAB
   request/reply bridge. The managed child characterization passes ABI, native
   ephemeral I/O/zlib and canonical service RPC, but ordinary native canonical
   `open` still fails. No supported pre-instantiation import hook is qualified.
2. **Pinned custom native path passes.** Ordinary native reads/writes, canonical
   source imports, `_csv`, zlib, binary stdio, metadata and native shutdown I/O
   pass. Native wheel downloads/runtime compilation are not qualified.
3. **Asynchronous backend path passes the maintained matrix.** Delayed serial
   canonical operations, bounded transfer requests, errno, cooperative terminal
   cancellation and release ordering pass. Franklin owns #763 descriptor staging
   and larger native-R2 workloads; those are separate evidence, not inferred here.
4. **Static recipe passes.** Exact size/SHA-256 admission precedes parsing of
   pinned assets. All Wasm modules are statically supplied; no `unsafeEval` or
   runtime Wasm compilation permission is granted.
5. **Invocation ownership passes.** Background tasks and async generators finish
   awaited cleanup before shutdown. Owned scheduler queues cannot reenter freed
   interpreter state. Real Shell disposal waits for retained reads/closes while
   sibling and borrowed pool survive; subsequent interpreters have fresh modules.
   Explicit post-finalization globals-proxy destruction passes, not a forced-GC
   or arbitrary foreign-PyProxy guarantee.
6. **Packed local workerd passes; deployment is unavailable.** Environment
   Cloudflare token/account variables and default Wrangler auth config were absent
   on recheck. Existing Wrangler logs/metrics are not deployment credentials.
   Do not close this acceptance gate until an authorized disposable deployment
   runs and is removed, and parent separately verifies publication.
7. **Limits are documented.** JSPI suspends only at async boundaries; it cannot
   preempt CPU loops or establish confinement. Same-isolate operation does not
   require a separate Worker deployment.

The initial finalization, callback-after-free, canceled native retry and service
close races were reproduced before fixes. Current checks: 66 focused Python
tests, 37 SafeFS native/filesystem/stat tests, SafeFS typecheck, selected Safe
Bash workspace build, selected SafeJS build needed by the public assembler,
input-admission check, source workerd and packed workerd. No root suites or root
ESLint ran. The latest packed sample reports 31457280 linear-memory bytes,
1290 ms initialization plus script, 3161441 bundled-JS bytes, 9598218 main-Wasm
bytes and 2545564 stdlib bytes. These are local observations, not RSS limits or
production benchmarks.

### Reproduce packed qualification

Build the selected `@poe-platform/safe-bash` and `@poe-code/safe-js` workspace
closures with `npm run build:workspaces -- --workspace=<name>`. The latter
generates the Intl data required by the maintained public-package assembler.

```bash
node scripts/package-safe.mjs --out-dir out/issue-746/assembled --version 0.0.0-issue746.2
mkdir -p out/issue-746/tarballs out/issue-746/consumer
for package in safe-fs safe-js safe-bash; do
  npm pack "./out/issue-746/assembled/$package" --pack-destination out/issue-746/tarballs --json
done
npm install --prefix out/issue-746/consumer --workspaces=false --package-lock=true --ignore-scripts --no-audit --no-fund \
  ./out/issue-746/tarballs/poe-platform-safe-fs-0.0.0-issue746.2.tgz \
  ./out/issue-746/tarballs/poe-platform-safe-js-0.0.0-issue746.2.tgz \
  ./out/issue-746/tarballs/poe-platform-safe-bash-0.0.0-issue746.2.tgz
```

Run the local workerd launcher recorded below with the additional container env
`-e SAFE_BASH_PYTHON_CONSUMER_ROOT="$PWD/out/issue-746/consumer"`. This uses the
same test matrix but resolves installed public exports. The test checks there
are no package symlinks or workspace Python/SafeFS sources in the bundle graph.
Build-time Wasm generators also come from the installed public Python entry.
Archive/install operations are local verification, not releases.

### Managed-runtime investigation

Use the same pinned tooling launcher with `python-managed.test.mjs` instead of
the custom test. Add read-only `-v /etc/ssl/certs:/etc/ssl/certs:ro` and container
env `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt`,
`SSL_CERT_DIR=/etc/ssl/certs`, `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt`.
The managed bundle loader uses system trust independently of Miniflare's network
service; setting only `NODE_EXTRA_CA_CERTS` was insufficient. Certificate
verification is never disabled. Python 3.14.2 / Pyodide 314.0.6 starts in ~2 seconds
locally, exposes `syscall_syncify`, and does not expose `wasmImports`.

Pinned workerd source `v1.20260917.1`,
`src/pyodide/internal/pool/emscriptenSetup.ts`, lines 114–147, constructs the
imports and instantiates the managed Wasm internally before application code.
Next managed work requires a documented supported hook or different supported
native mount API; repeating Python-proxy/synchronous-JS suspension failures is
not an implementation. This finding does not prove such integration impossible.
No credential material is written to evidence.

Current evidence lives only in worktree `out/issue-746`, notably
`python-focused-current.log`, `source-workerd-current.log`, `packed-workerd.log`,
`package-assembly.log`, `pack.log`, `consumer-install.log`, and
`managed-system-trust.log`. Preserve the existing read-only
`/tmp/poe-python-workerd-current` dependencies; create no new output there.

### Startup cancellation follow-up

After freezing `8c3dbbc39` for Franklin's #763 staging matrix, an additional real
workerd test reproduced missing atexit when cancellation occurred after the
loader returned but before guest admission (`startup-cancel-red.log`). Qualified
interpreter retirement now runs unconditionally in `finally`, even if task or
scheduler cleanup raises. A pre-admission runtime uses its original bootstrap
filesystem during shutdown; a mounted runtime uses the asynchronous shutdown
boundary. The same assertion now passes (`startup-cancel.log`). This changes no
public loader hook or native syscall signature. Loader failures before returning
a runtime remain the loader's responsibility. The rebuilt/repacked
`0.0.0-issue746.2` consumer is checked separately in `packed-workerd-current.log`.

Remote-main was rechecked at `ba157f661` after Franklin's staging integration.
There are no upstream changes to the Python implementation paths relative to
this worktree base. This worktree does not silently import or claim testing of
those newer SafeFS staging changes; Franklin owns their frozen workerd matrix.

### Disposable deployment handoff

Parent has requested a credential-owning external agent execute the disposable
deployment; no credentials are copied into this worktree. The maintained packed
test accepts `SAFE_BASH_PYTHON_ASSET_DIR`, exporting only after all local runtime
assertions pass, only under worktree `out/`, into a new directory with exclusive
file creation. It writes the exact module bytes and a type/size/SHA-256 manifest.
This is a local artifact, not deployment or consumer-staging acceptance.

The `e0dfa9b1e` runtime handoff is `out/issue-746/deployment-e0dfa9b1e`, generated
from independent `0.0.0-issue746.2` public packages. Deployment must preserve the
manifest's module names/types, main module, date, and empty compatibility flags,
then run all routes/assertions from `python-jspi.test.mjs`, record startup/linear
memory/asset sizes, and delete the disposable Worker. The test fixture uses a
canonical MemoryFileSystem; actual consumer staging authority is a separate gate
owned by the parent/consumer agent. Do not equate the fixture with that hookup.

Managed investigation additionally reviewed the current Dynamic Workers
`WorkerCode` reference and Python Worker startup description. Neither documents
a native import-replacement/filesystem hook; the pinned implementation captures
the imports before the application. A supported managed solution needs a
pre-instantiation host hook or a runtime-provided asynchronous native descriptor
mount. Its acceptance test must use the real canonical service binding for
native open/import/C-extension I/O, not only direct awaited RPC. Arbitrary
pointer/wasm-table mutation, JS-frame suspension, or Python builtins wrappers
are not substitutes. Await upstream/runtime-owner guidance on that interface
while independently qualifying the custom static implementation.

The follow-up managed inventory (`managed-hooks.log`) enumerates exposed ABI
names only, never credentials or binding values. It finds the standard
Emscripten mount helpers, `instantiateWasm`, wasm table/plugin helpers and
`syscall_syncify`; the API hook inventory is empty and `wasmImports` is absent.
The compiled instance is already created when these helpers become visible.
Their existence is not a supported replacement boundary for its captured native
imports. The maintained probe continues to demonstrate canonical RPC success
and native canonical-open failure without copying files or installing a shim.

### Managed static import and native request boundary

Follow-up from frozen `19193f4db` tests concrete public module/FFI boundaries,
not the already-failed synchronous Emscripten filesystem callback design.
The maintained `python-managed.test.mjs` now has three independently asserted
cases. The original ABI/RPC baseline remains explicitly incomplete.

| Boundary | Evidence and limit |
| --- | --- |
| Static Wasm in `WorkerCode.modules` plus `workers.import_from_javascript` | Managed Python imports a supplied precompiled module and calls its native export, returning `42`. A JavaScript-child control uses the same bytes. No runtime compilation/eval permission is added. |
| Compiled Wasm through `WorkerCode.env` | The pinned child rejects it with `Unable to deserialize cloned data`. This does not reject static Wasm modules or ordinary service bindings. |
| Exposed `___syscall_openat` export replacement | The replacement export returns the native PID (`42`), but ordinary `os.open` on a nonexistent file still raises `FileNotFoundError`. Assignment does not change the native caller's captured import. The original export is restored in `finally`. |
| Dynamic-linker symbol merging | `resolveGlobalSymbol('__syscall_openat')` exposes the existing import; attempting to merge a replacement through `mergeLibSymbols` leaves its function identity unchanged. The normal native canonical `open` assertion still fails. This tests existing-symbol merging, not every possible future runtime linker design. |
| Native C-API callable through static Wasm | A real `PyCFunction` enters the existing native-call adapter, obtains canonical SafeFS UTF-8 source through a directly bound service fetch and Promise chain, and suspends through `_syscall_syncify`. The delayed request is observed exactly once and a one-shot Python timer runs while it waits. Native method, module reference, callback-table entry and allocation are released after the call. |
| `mountNativeFS` | Existence is tested. The pinned Pyodide `314.0.6/src/js/nativefs.ts` implementation was inspected separately: its `mount` delegates to MEMFS and `syncfs` reconciles local and remote files. That is an excluded snapshot/synchronization approach, not a tested live canonical mount. |

The direct request fixture imports raw `cloudflare:workers` bindings rather than
the SDK's Python fetch wrapper, uses bound native JavaScript methods (no user JS
helper module or generated JS function), and statically supplies both Wasm
modules through `WorkerCode.modules`. It proves UTF-8 source transport through a
native C-API callable, not a general POSIX descriptor adapter or binary transport.
Neither `builtins.open` nor libc imports are patched by that fixture.

An initial probe's endlessly rescheduled zero-delay heartbeat starved I/O and
timed out. Replacing it with a one-shot 1 ms timer fixes the test. Those timeouts
are not evidence of a runtime or Python-coroutine callback limitation. Only the
final direct-binding native-call result is qualified; no unresolved timeout is
left in the maintained tests.

Next viable managed route, requiring runtime-owner support rather than an
application-side workaround:

1. Add an explicit filesystem capability to the managed runtime setup contract.
   The current `WorkerCode` API does not advertise this option; do not invent or
   ship it as if available. A service binding is the demonstrated capability
   transport, while static Wasm is the demonstrated native-module transport.
2. Install the native import adapter in workerd's
   `src/pyodide/internal/pool/emscriptenSetup.ts:getInstantiateWasm` before the
   main module is instantiated. Bind the real `syscall_syncify` export only after
   instantiation. Preserve private bootstrap/stdlib I/O and keep application
   canonical handles separate. An equivalent runtime-owned native backend would
   also qualify; rewriting exposed exports after startup does not.
3. Bind request authority after snapshot restoration and before guest execution,
   with invocation-scoped descriptor identity, terminal cancellation, exact
   errno, bounded binary transfers, backpressure and release-only cleanup.
   Do not capture a previous request's service binding in a reusable snapshot.
4. Qualify ordinary `open`/`os.read`/`os.write`, canonical source and ZIP imports,
   C-extension paths and binary stdio against delayed canonical storage. The
   direct C-API callable test is a reusable positive control, not a replacement
   for those acceptance cases.
5. Qualify runtime-owned retirement after the response is copied out. An
   application must not finalize the managed interpreter while workerd still
   needs it to marshal its response. Test buffered-file/atexit cleanup,
   cancellation and sibling ownership independently of the custom executor.

The exact current evidence is `out/issue-746/managed-boundaries-current.log`.
All probes run only in this worktree; named probe containers have bounded outer
deadlines and do not restart or interfere with the parent's live `npm test`.
No deployment access is used. Basic custom-JSPI artifacts and README remain
unchanged in this follow-up.

The subsequent native-linker follow-up adds no managed executor or native mount.
`out/issue-746/managed-linker-current.log` records all three maintained cases
passing with `linker_preserves_existing_syscall: true`. Together with the
pre-instantiation source boundary, this rules out the tested application-level
export-reassignment and normal symbol-merge approaches on the pinned runtime.
The next implementation dependency is a runtime-owner-approved native import
adapter/backend, with the explicit service-capability and lifecycle contract
listed above. Do not substitute an application `open` wrapper, syscall replay,
or private table/pointer mutation to label this gate complete. No parent full
test/lint handles are stopped or restarted by these focused runs.

## Boundaries

Do not fabricate absent canonical POSIX metadata. Native stat must reject values
the backend cannot represent; import metadata may use only its actual required
fields. Do not imply retained directory support from a path-based readdir.
Unsupported syscalls and dynamic native loading must fail explicitly instead of
falling back to bootstrap MEMFS or ambient host resources. Cancellation cannot
undo committed effects or preempt a CPU-only guest loop.

## Delivery status

The native syscall component, exact-byte static asset bindings and deterministic
build-time Wasm adapters are implemented with focused tests. Runtime filesystem
Python scripts are shared with the existing Node worker, without changing that
worker's behavior. The real workerd source qualification now includes local
imports, native `_csv` file reads, zlib, binary stdin/stdout/stderr, seek and
canonical output writes; it observes serial deliberately delayed requests.

Full executor delivery remains incomplete. The original characterization exposed
the pinned runtime's asynchronous finalization error: raw `_Py_FinalizeEx` has
no Pyodide handback thread state. Calling `createPromising` did not establish
that state. The native shutdown and C-API bridges described in the follow-up
below now pass positive finalization assertions, including actual file effects.
The executor remains a fixture until background-callback retirement and the
public host lifecycle are qualified; it is not yet an exported product host.

Next work must qualify background-task retirement and exclusive finalization
without bypassing the runtime's thread-state guard, then exercise cancellation
and sibling lifetime through actual Shell instances and the packed public
artifact. Managed-child import integration and a disposable Cloudflare
deployment remain separate outstanding gates. No push, remote-main delivery,
release, issue closure or deployment is claimed by this worktree.

## Validation handoff

### Native finalization follow-up

The acceptance assertion was changed to require atexit output, and reproduced
the original handback-thread-state failure before the implementation changed.
A separate standard-JSPI native import path now enters CPython finalization
without calling Pyodide's task-oriented `syscall_syncify`. This leaves the
runtime's thread-state guard intact. Native atexit writes, unclosed buffers,
destructor writes, and binary finalizer stdout pass in actual pinned workerd.

Adding metadata/listing to atexit and a destructor exposed two further red
cases. A precompiled C-API request module replaces the Python `run_sync`
metadata shim. CPython's `statresult_new` also looks up `posix` through the
already-cleared `sys.modules` during late destruction; a pinned-runtime native
stat oracle succeeded while the Python constructor failed. A second precompiled
C-API module constructs the true struct-sequence directly, with its field order
discovered before shutdown and correct owned element references. The stronger
workerd test now passes, including destructor metadata and atexit listing.

These are source-runtime finalization qualifications, not completion of #746.
Next: own/drain scheduled callbacks before exclusive finalization, test actual
Shell cancellation/sibling lifetime, then qualify the packed consumer and
managed-runtime integration. The latter's pre-instantiated immutable imports
remain a separate blocker. No deployment access or publication is claimed.
Upstream `origin/main` was checked through `c98f1437f`; the ZIP/identity and new
release fixes do not change these Python source paths. Shared SafeFS descriptor
contracts/implementations are left to #763; this follow-up changes no SafeFS files.

Evidence: `out/issue-746/finalization-red.log`,
`out/issue-746/finalization-metadata-red.log`,
`out/issue-746/finalization-metadata-native-oracle.log`,
`out/issue-746/finalization-metadata.log`, and
`out/issue-746/native-stat-unit.log`. The extra Wasm modules are 254 and 241 bytes;
the expanded native syscall trampoline is 4990 bytes.
The focused Python command is unchanged from the original validation below and
now passes 58 tests. The scoped helper typecheck and `git diff --check` pass.

### Original component validation

All commands below run in the issue worktree, never parent main.

- Passed: `npm exec --no -- vitest run packages/safe-fs/tests/python-native.test.ts packages/safe-fs/tests/python-filesystem.test.ts packages/safe-fs/tests/python-stat.test.ts` — 35 tests, including 17 native-adapter tests.
- Passed, from `packages/safe-bash`: `node --import tsx --test tests/commands/python/worker.test.ts tests/commands/python/jspi.test.ts tests/commands/python/jspi-assets.test.ts tests/commands/python/jspi-trampoline.test.ts tests/commands/python/async-executor.test.ts tests/commands/python/executor-pool.test.ts tests/commands/python/executor-pool-review.test.ts` — 53 tests.
- Passed: `npm run typecheck --workspace=@poe-code/safe-fs`.
- Passed: `npm exec --no -- tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --types node packages/safe-bash/src/commands/python/jspi-assets.ts packages/safe-bash/src/commands/python/jspi-trampoline.ts packages/safe-bash/src/commands/python/runtime-scripts.ts` — scoped helper typecheck, not the whole package test-type gate.
- Passed: `npm run build:workspaces -- --workspace=@poe-platform/safe-bash` — nine declared workspace builds and native postbuild. The existing optional-CLI postbuild first needed the separately built `@poe-code/package-lint` helper; no build declarations were changed in this issue.
- Passed: `node --test --test-name-pattern='Python native JSPI qualification' packages/safe-bash/scripts/integration-inputs.test.mjs` — one selected admission test.
- Passed characterization: `node --import tsx --test packages/safe-bash/tests/integration/python-jspi.test.mjs` under the pinned workerd launcher — one test verifies native I/O and explicitly verifies the shutdown failure. This is **not** a passing full-executor acceptance gate.
- Passed: `git diff --check`. Root ESLint and full root suites were not run, per assignment.

The workerd command used the already-installed, read-only tooling at
`/tmp/poe-python-workerd-current` through `SAFE_BASH_CF_RUNTIME_ROOT` and the
already-present `node:22-bookworm-slim` image solely for compatible glibc.
The repository, Pyodide installation, workspace dependencies, sources and all
output remained in this home worktree. `TMPDIR` pointed at worktree
`out/issue-746`; no parent workspace dependencies were symlinked or imported.

Exact local workerd launcher, from the worktree root:

```bash
SAFE_BASH_CF_RUNTIME_ROOT=/tmp/poe-python-workerd-current docker run --rm \
  --user "$(id -u):$(id -g)" -v "$PWD:$PWD" \
  -v /tmp/poe-python-workerd-current:/tmp/poe-python-workerd-current:ro \
  -w "$PWD" -e TMPDIR="$PWD/out/issue-746" -e SAFE_BASH_CF_RUNTIME_ROOT \
  node:22-bookworm-slim node --import tsx --test \
  packages/safe-bash/tests/integration/python-jspi.test.mjs
```

Current evidence is under `out/issue-746`: `safe-fs-tests.log`,
`safe-bash-python-tests.log`, `safe-fs-typecheck.log`, `jspi-typecheck.log`,
`safe-bash-build.log`, `input-admission.log`, and `workerd-maintained.log`.
Obsolete exploratory output is removed. The Node executor's original focused
worker tests also passed independently before and after script extraction.

## Owned change manifest

- `packages/safe-bash/src/commands/python/worker.ts`
- `packages/safe-bash/src/commands/python/runtime-scripts.ts`
- `packages/safe-fs/src/python/native.ts`
- `packages/safe-fs/src/python/index.ts`
- `packages/safe-fs/src/contracts/python-native.md`
- `packages/safe-fs/tests/python-native.test.ts`
- `packages/safe-bash/src/commands/python/jspi-assets.ts`
- `packages/safe-bash/src/commands/python/jspi-trampoline.ts`
- `packages/safe-bash/src/contracts/python-jspi.md`
- `packages/safe-bash/tests/commands/python/jspi-assets.test.ts`
- `packages/safe-bash/tests/commands/python/jspi-trampoline.test.ts`
- `packages/safe-bash/tests/commands/python/jspi.test.ts`
- `packages/safe-bash/src/commands/python/jspi.ts`
- `packages/safe-bash/src/commands/python/jspi-scheduler.ts`
- `packages/safe-bash/tests/commands/python/jspi-scheduler.test.ts`
- `packages/safe-bash/tests/integration/python-managed.test.mjs`
- `packages/safe-bash/tests/integration/python-jspi.test.mjs`
- `packages/safe-bash/tests/integration/python-jspi.worker.mjs`
- `packages/safe-bash/scripts/integration-inputs.test.mjs`
- `docs/plans/python-cloudflare-native-executor-746.md`
