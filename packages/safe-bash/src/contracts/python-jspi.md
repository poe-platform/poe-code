# Python JSPI qualification components

There is currently **no supported Cloudflare Python executor exported by this
package**. The asynchronous executor seam is public, but the candidate runtime
adapter remains under `tests/integration/python-jspi-executor.fixture.ts`.
Do not deploy that fixture or treat its passing characterization test as full
Python executor qualification.

## Native and static-asset mechanism

`jspi-trampoline.ts` builds deterministic Wasm import-adapter bytes for the pinned
Pyodide 314.0.6 native syscall signatures. Generate those bytes at application
build time and supply a statically imported/precompiled Wasm module to workerd.
The adapter passes bootstrap calls through unchanged; during guest execution it
returns an asynchronous canonical request to the Wasm `syscall_syncify` export.
Suspension occurs in Wasm, with no intervening synchronous JS filesystem frame.

During exclusive interpreter shutdown, a separate standard JSPI import calls
the asynchronous dispatcher directly. `_Py_FinalizeEx` is entered with
`WebAssembly.promising`; it does not impersonate a live Pyodide task or modify
the `syscall_syncify` thread-state guard. This boundary requires the host to
prevent concurrent Python callbacks while finalization is in progress.

Two additional small precompiled C-API modules serve metadata without a
`pyodide.ffi.run_sync` Python callback: one converts a request/result through
`PyUnicode_AsUTF8`/`PyUnicode_FromString`, and the other constructs real
`os.stat_result` objects with `PyStructSequence_New` and owned field references.
The latter avoids the Python constructor's import lookup after `sys.modules`
is cleared. Field order is discovered from the pinned type before shutdown;
missing canonical fields are not fabricated. Metadata requests are capped at
16 KiB and encoded responses at 1 MiB; this does not bound a backend's own
directory enumeration allocation.

`jspi-assets.ts` supplies lexical loader bindings, not global monkey patches.
It maps exact admitted helper bytes to precompiled Wasm modules, serves bundled
stdlib bytes, and recognizes only its own main-module response. Equal-length
different bytes, foreign responses, unlisted assets and streaming compilation
are rejected. This requires trusted build-time association of each module with
its authenticated bytes; compiled modules are not byte-authenticated at runtime.

The maintained build recipe is `tests/integration/python-jspi.test.mjs`:

- Authenticate the exact npm 314.0.6 loader, Emscripten glue, main Wasm, lockfile
  and stdlib using the committed sizes and SHA-256 digests before parsing.
- Extract the loader's pinned error helper and C-call trampoline from parsed
  source, and statically supply those modules, the empty capability-check module,
  the native syscall adapter, main Wasm and stdlib.
- Bundle the loader with lexical `WebAssembly`, `fetch` and `location` bindings.
  Disable its Node environment branch at build time. Do not grant `unsafeEval`.
- Keep package/native assets explicitly allowlisted. The recipe does not qualify
  downloading wheels or arbitrarily compiling extension modules at runtime.

With the owned Pyodide dependency installed, run the focused source qualification
using `node --import tsx --test packages/safe-bash/tests/integration/python-jspi.test.mjs`.
Set `SAFE_BASH_CF_RUNTIME_ROOT` to pinned Miniflare 5.20260917.0-alpha /
workerd 1.20260917.1 tooling and `TMPDIR` to an existing worktree `out/` directory.
The test uses actual workerd, no Node interpreter substitute, and needs a host
with compatible glibc. A container used only to launch workerd is test tooling,
not the Cloudflare Python executor.

## Observed blocker and remaining gates

On September 18, 2026 the source test passed ordinary native file I/O, canonical
source imports, `_csv` reading a canonical file, zlib, binary streams and delayed
serial backend requests. A sample run used 31457280 bytes of linear memory and
took 1233 ms including initialization and the script. Neither number is a
production memory guarantee or benchmark. Exact asset sizes are emitted by the
test; the main Wasm is 9598218 bytes and stdlib is 2545564 bytes.

The original red test reproduced a finalization failure. Calling raw
`_Py_FinalizeEx` through `WebAssembly.promising` / Pyodide `createPromising` does
not establish the thread-state bookkeeping needed by `syscall_syncify`.
An atexit handler's native open reaches canonical storage, but suspension raises
`Cannot stack switch: no thread state to hand control back to` and the expected
file contents are not written. Python can catch that error, so an exit status of
zero does not prove successful interpreter retirement. The current test now
requires the actual finalizer bytes: delayed native atexit I/O, unclosed buffered
file flushing, destructor writes and metadata, atexit directory enumeration,
and binary stdout flushing pass through the new native shutdown boundary.
The native syscall adapter is still not a complete public executor.

Do not bypass Pyodide's thread-state guard, replay syscalls, copy the workspace,
or replace only `builtins.open` to hide lifecycle defects. Background-task
retirement and exclusion of reentry during finalization still need qualification.
Cancellation and sibling ownership tests of the lower-level adapter do not
establish that full runtime guarantee.

Managed Python child imports remain instantiated before application code, with
no supported replacement hook qualified here. Packed-public-consumer and managed
Python gates are outstanding. Cloudflare credentials were unavailable, so no
disposable deployment or publication is claimed. JSPI never preempts CPU-only
guest loops and never establishes guest confinement; obtaining JSPI alone does
not require a separate Worker deployment.
