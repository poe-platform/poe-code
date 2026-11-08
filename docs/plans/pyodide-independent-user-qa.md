# Independent Python user QA — 2026-09-16

## Scope

Read the current acceptance gates in `pyodide-safe-bash.md` and applicable
AGENTS.md before execution. Verify the existing working implementation rather
than treating historical missing-adapter reports as current defects. This is a
fresh working-tree run at HEAD `06fac91e776c2c56c8a1ad9036ebaca60f55d67a`;
pre-existing edits are preserved. No README or production changes are made.

## Manual execution

1. Run the existing browser-document server with a unique capture destination:
   `node packages/safe-bash/tests/integration/pyodide-runtime/browser-documents/server.mjs ../../../../../../../out/pyodide-edge-rerun/browser`.
   The fixture resolves that destination relative to its captures directory.
   Use checkout-local `out` because the host's `/out` is unavailable for writes.
2. Open the fixture in real Chrome, in an owned fresh browser profile. This run
   uses Chrome's headless mode and DevTools protocol; no browser QA script is
   added to the repository. Wait for `window.finished`. Check all four reports,
   exact package versions, priority assertion groups, parent artifact byte
   equality, operation counts, cross-origin isolation and handle census.
3. Capture and inspect the browser summary screenshot and PyMuPDF PNG page.
   Bind evidence to the fixture source hashes and selected runtime index.
4. Run `npm run build` to completion before public integration. Discard early
   attempts made while the build was replacing generated exports: missing build
   files do not diagnose Python runtime or package defects. Rerun after completion.
5. Provision the public document profile with `SAFE_BASH_PYTHON_CACHE` set to
   the absolute checkout-local `out/pyodide-edge-rerun/cache` path, using
   `provision-public-runtime.mjs`. Run `public-documents.test.mjs` and
   `public-lifecycle.test.mjs` offline through `node --test --test-concurrency=1`.
   Keep failing required TODOs separate from successful tests.
6. Run `public-command-parity.test.mjs` with `SAFE_BASH_NATIVE_PYTHON` set to
   `/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14`.
   Run `product-worker.test.mjs` and `stdio-proof.test.mjs` with
   `node --import tsx --test --test-concurrency=1`.
7. Run the ordinary-script `verify.mjs 0` and `verify.mjs 1` probes, blocked
   backend cancellation `cancel-fs.mjs` and Promise callback negative control
   `promise-callback.mjs`, using `node --import tsx`.
8. Run Python command unit files through node:test/tsx, canonical Python and
   retained-resize tests through Vitest, and the maintained integration inventory
   test. Runtime downloads and host artifacts remain outside unit tests.
9. Capture the built CLI with `scripts/screenshot.ts`, invoking
   `node dist/bin.cjs bash` with an explicitly rooted owned scratch directory,
   the pinned Pyodide module URL, `--python-trusted` and
   `-c 'python -c "print(42)"'`. Inspect initialization and output.
10. Record measured results in `packages/safe-bash/docs/pyodide.md`. Stop owned
    browser/server processes and purge this run's scratch captures and cache.
    Leave broader acceptance, readiness and finalization unchanged.

## Confirmed browser and focused results

Chrome 152.0.7977.84, Pyodide 314.0.6, CPython 3.14.2, Node 22.22.2.
All four browser profiles pass: MEMFS/scoped/delayed/root have 11/11/11/12
workflow groups, respectively. Canonical byte comparisons pass 18/18/20;
backend operation counts are 4787/4787/5857; every profile retains zero handles.
PyMuPDF 1.27.2.2 renders and extracts on every profile. Resolved package versions
and fixture hashes match the prior pinned qualification. The browser summary,
rendered PDF page and CLI initialization/42 screenshot are inspected.

Normal build passes. Python command units pass 144/144; canonical Python and
retained-resize units pass 121/121; integration inventory passes 109/109;
product-worker/stdio integration passes 45/45; matched native public parity
passes 56/56. Ordinary-script memory and delayed controls each pass with 166
canonical operations. Public documents/lifecycle report 18 passes and three
failing required TODOs across 21 entries, with zero unexpected failures/skips.
The TODOs reproduce TemporaryDirectory cleanup on both backends and quota reads;
they are not counted as passes. Blocked backend cancellation closes its retained
handle; the Promise callback negative control confirms unsupported suspension.
Offline miss/corrupt-wheel/integrity failure, install cancellation and subsequent
reuse pass. Exact commands and assertions are recorded in the usage guide.

This run does not establish all edge cases, complete canonical backend fidelity,
Cloudflare/browser public command deployment, formula calculation or arbitrary
document conversion. No commit, push or release is performed.
