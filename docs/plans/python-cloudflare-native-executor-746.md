# Issue 746: native asynchronous Python in Cloudflare

## Acceptance and current evidence

Work only in the issue-746 detached worktree. Parent owns cherry-pick, main,
publication and issue closure. No Docker-backed interpreter is a Cloudflare
implementation. Do not copy the canonical workspace into the interpreter.

On September 18, 2026, the current source exposes an asynchronous executor
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

Full executor delivery is blocked, not complete. A maintained characterization
reproduces the pinned runtime's asynchronous finalization error: atexit native
I/O reaches the backend but fails to suspend because raw `_Py_FinalizeEx` has no
Pyodide handback thread state. Calling `createPromising` on the export does not
establish that state. Catching the Python error can still produce exit status
zero, so success cannot be inferred from the exit code. The incomplete executor
has deliberately been moved to test fixtures, not exported as a product host.

Next work must qualify interpreter finalization and background-task retirement
without bypassing the runtime's thread-state guard, then exercise cancellation
and sibling lifetime through actual Shell instances and the packed public
artifact. Managed-child import integration and a disposable Cloudflare
deployment remain separate outstanding gates. No push, remote-main delivery,
release, issue closure or deployment is claimed by this worktree.

## Validation handoff

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
- `packages/safe-bash/tests/integration/python-jspi-executor.fixture.ts`
- `packages/safe-bash/tests/integration/python-jspi.test.mjs`
- `packages/safe-bash/tests/integration/python-jspi.worker.mjs`
- `packages/safe-bash/scripts/integration-inputs.test.mjs`
- `docs/plans/python-cloudflare-native-executor-746.md`
