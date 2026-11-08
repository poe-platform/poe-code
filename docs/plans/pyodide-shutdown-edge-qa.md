# Python shutdown edge QA

Continue from [the current acceptance gates](pyodide-safe-bash.md), preserving
the implemented Node worker and all existing work. This qualification does not
close full compatibility, quota, retained-directory, confinement or Cloudflare
requirements.

1. Read applicable instructions, command/I/O/cancellation contracts and
   `packages/safe-bash/docs/pyodide.md`. Verify current implementation before
   proposing fixes; historical missing-adapter reports are not current evidence.
2. Run maintained real product-worker and stdio suites separately from Python
   units. Exercise concurrent binary producer/consumer pipelines, full capacity,
   sibling isolation, early pipe closure, initialization/import/CPU cancellation,
   retained handles, native/API refusals and successful subsequent commands.
3. Extend the already registered public lifecycle suite for CPython shutdown:
   reverse-order atexit callbacks, buffered output, binary canonical files and
   nonzero SystemExit. Check zero retained handles before command settlement.
4. Abort real interpreters during atexit CPU loops and blocked stdin. Confirm
   termination within two seconds after cancellation, persisted pre-abort bytes,
   descriptor cleanup, no late output and successful admission of the next
   interpreter with capacity one. Never depend on cooperative Python awaits.
5. Run `npm run build` to completion before public verification. Provision
   document packages explicitly using
   `provision-public-runtime.mjs`, then use the maintained public integration
   route with offline cache and matched native CPython. Keep failing required
   TODOs separate from passes and unexpected failures.
6. Run Python units, integration inventory and focused ESLint. Inspect a built
   CLI screenshot of an ordinary script's atexit output. Record scoped results;
   preserve readiness draft and finalization pending. Purge owned scratch data.

The host refuses creation of `/out` with a read-only-filesystem error. Use the
ignored checkout-local `out/pyodide-shutdown-qa` fallback for this run's cache,
logs and screenshot, and purge only that owned directory afterward.

## Execution profile

2026-09-16; working-tree baseline HEAD
`06fac91e776c2c56c8a1ad9036ebaca60f55d67a`, including existing edits. Node
22.22.2, isolated Pyodide 314.0.6 and CPython 3.14.2. Source inspection confirms
that the worker already calls `_Py_FinalizeEx` while canonical RPC is live.
The three new shutdown regressions pass against the existing implementation;
no production fix is justified by those cases.

Runtime and package provisioning remain explicit integration operations.
Unit tests neither download Pyodide nor create host fixtures. Node worker
termination bounds guest lifetime; cleanup still requires cooperative canonical
backends. These checks do not demonstrate hard Wasm heap/RSS limits or mediate
arbitrary Python/JS proxy access. Trust includes all imported package code.

An initial public/typecheck attempt overlapped the normal workspace rebuild and
observed temporarily absent SafeJS artifacts (`ERR_MODULE_NOT_FOUND` and
TS2307). That attempt is not a product-runtime qualification. Public verification
and the full maintained typecheck were restarted after the build completed;
the second typecheck passes source/tests, all consumer groups and required
negative profiles. A mistaken Node-runner invocation of Vitest filesystem tests
was also corrected; the maintained Vitest discovery passes all 28 selected
canonical Python tests across four files.

## Reproduction commands

From the repository root, with the isolated pinned runtime already installed:

```sh
npm run build
SAFE_BASH_PYTHON_CACHE="$PWD/out/pyodide-shutdown-qa/cache" \
  node packages/safe-bash/tests/integration/pyodide-runtime/provision-public-runtime.mjs
SAFE_BASH_PYTHON_CACHE="$PWD/out/pyodide-shutdown-qa/cache" \
SAFE_BASH_NATIVE_PYTHON=/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14 \
  npm run test:python:integration --workspace=virtual-bash
node --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/integration/pyodide-runtime/product-worker.test.mjs \
  packages/safe-bash/tests/integration/pyodide-runtime/stdio-proof.test.mjs
node --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/commands/python/*.test.ts
node --test packages/safe-bash/scripts/integration-inputs.test.mjs
npm run typecheck --workspace=virtual-bash
npx vitest run \
  packages/safe-fs/tests/python-filesystem.test.ts \
  packages/safe-fs/tests/python-stat.test.ts \
  packages/safe-fs/tests/python-unlink.test.ts \
  packages/safe-fs/tests/python/emscripten.test.ts
npx eslint packages/safe-bash/tests/integration/pyodide-runtime/public-lifecycle.test.mjs
```

Use an available matched CPython executable; do not substitute a different
patch version and count differential cases as qualified. Capture the built CLI
with `npm run screenshot -- --output out/pyodide-shutdown-qa/shutdown.png
--no-header node dist/bin.cjs bash --root <owned-fixture-directory>
--python-runtime <pinned-module-file-url> --python-trusted -c <shell-source>`.
The shell source is `python -c 'import atexit; atexit.register(print,
"shutdown complete"); print(42)'`. The inspected image shows initialization,
`42`, then `shutdown complete` without an error diagnostic.

## Measured checks

| Check | Result |
| --- | --- |
| Normal maintained build | Pass, including root suffix stages. |
| Complete maintained public integration after build | 127 passes, 3 failing required TODOs; zero unexpected failures, cancellations or skips across 130 entries. |
| New built-public shutdown checks | 3/3 pass against the existing production implementation. |
| Real product-worker and stdio | 45/45 pass; no failures, skips or TODOs. |
| Python command units | 145/145 pass. |
| Selected canonical Python filesystem units | 28/28 pass across four files with Vitest. |
| Maintained integration inventory | 109/109 pass. |
| Maintained virtual-bash typecheck after build | Pass, including source/tests, current consumers and required negative profiles. |
| Focused ESLint and whitespace checks | Pass. |
| Built CLI screenshot | Inspected initialization, command output and atexit output. |

No production Python/filesystem implementation or README was changed by this
qualification. No commit, push, remote-main delivery or release is performed.
Required quota and retained-directory workflows remain unfinished; neither
passing document libraries nor successful interpreter retirement closes them.
The two memory/delayed `TemporaryDirectory` TODOs reproduce ENOTSUP acquiring
directory descriptors; the quota TODO reproduces ENOTSUP opening `/quota/input`.
Ordinary DOCX/XLSX/PDF create/edit/reopen, offline package failure diagnostics,
installation abort/retry and interpreter isolation remain passing. Scratch
cache, logs and screenshot are purged after inspection and recording results.
