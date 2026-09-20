# Managed Python native filesystem: runtime interface request

## Objective and status

Complete issue #746's managed Python option: ordinary Python and native-library
file operations must reach the invocation's asynchronous canonical filesystem,
without copying a workspace or replacing only Python-level file functions.

This is an upstream interface proposal, not an implemented or supported API.
The published `0.1.684` custom static JSPI executor is a separate qualified option.
Managed canonical-native mounting and disposable deployment remain open.

## Reviewed primary interfaces

Review date: September 18, 2026. The latest inspected workerd release is
`v1.20260918.1`, commit `679c09e5eea0af8a04062e1875e99c75af532e3b`.
Current-main source was inspected at
`266d066e8bd1962e2e02cedd9718252f44aa1217`. Runtime experiments remain pinned to
workerd `1.20260917.1` / managed Pyodide `314.0.6`; this review does not claim an
execution test of the newer release.

- [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/)
  describes Python modules and explicit service bindings. The reviewed
  [WorkerCode definition](https://github.com/cloudflare/workerd/blob/266d066e8bd1962e2e02cedd9718252f44aa1217/src/workerd/api/worker-loader.h#L88)
  has no native-filesystem provider or pre-instantiation callback field.
- [Managed instantiation](https://github.com/cloudflare/workerd/blob/266d066e8bd1962e2e02cedd9718252f44aa1217/src/pyodide/internal/pool/emscriptenSetup.ts#L113)
  constructs the main Wasm instance internally. Its import installation is the
  relevant runtime-owned insertion point, before those imports become fixed.
- [Managed bootstrap](https://github.com/cloudflare/workerd/blob/266d066e8bd1962e2e02cedd9718252f44aa1217/src/pyodide/internal/python.ts#L219)
  instantiates the interpreter before installing worker files and returning the
  public Pyodide API. Native-module compilation also retains a trusted read-only
  filesystem check. Preserve that trust boundary.
- [Loader admission](https://github.com/cloudflare/workerd/blob/266d066e8bd1962e2e02cedd9718252f44aa1217/src/workerd/api/worker-loader.c++#L357)
  rejects Python modules beneath a JavaScript main. A JavaScript-first bootstrap
  is therefore not an existing public route to configure managed imports.
- [Python Workers architecture](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)
  documents runtime injection and snapshots. Application filesystem capabilities
  and outstanding operations must not be captured in a reusable baseline.
- The reviewed [WorkerStub surface](https://github.com/cloudflare/workerd/blob/266d066e8bd1962e2e02cedd9718252f44aa1217/src/workerd/api/worker-loader.h#L18)
  exposes entrypoint/class access, not an explicit awaited interpreter-retirement
  method. This observation does not assert that internal cancellation is absent.

No suitable hook was found in these public surfaces. This is a scoped finding,
not a claim that managed integration is inherently impossible. First ask the
maintainers whether an existing supported API satisfies the requirements below,
including its compatibility version and lifecycle guarantees.

## Specific upstream request

Request an **opt-in, runtime-owned asynchronous native filesystem provider for
managed Python Dynamic Workers**, configured by the trusted loader owner.
Prefer a versioned service-binding capability over exposing private Wasm imports,
Python pointers, or uncloneable JavaScript callbacks through `env`.

The public configuration needs to express these concepts; field names and wire
format require maintainer agreement and are deliberately not presented as an
available SDK API:

1. **Provider and scope.** Select an explicitly supplied service binding, supported
   protocol version, application namespace, cwd, and transfer/descriptor limits.
   A native descriptor belongs to one invocation, not a shared global provider.
   Runtime code decodes and bounds native pointers locally; RPC transfers logical
   operands and owned bytes, never pointers into another interpreter's memory.
2. **Native dispatch.** Install a runtime-owned driver before main Wasm
   instantiation, or an equivalent supported native boundary. It must cover
   metadata, open, positioned/sequential I/O, seeking, directory operations,
   mutations, synchronization, descriptor duplication and close. Preserve native
   errno conventions and canonical descriptor identity. All relevant native
   callers must use it, not just patched `builtins.open` or `os.stat`.
3. **Suspension.** Await the provider outside synchronous JavaScript filesystem
   frames. The runtime must define supported CPython/Pyodide ABIs and reject an
   incompatible provider before guest admission. Existing static Wasm imports
   and `syscall_syncify` demonstrate an implementation approach, not a public
   managed hook. A supported filesystem driver is also acceptable; arbitrary
   import mutation need not become a public API.
4. **Bootstrap separation.** Installing dispatch must perform no remote I/O
   during isolate initialization. Keep trusted runtime/package files on their
   existing read-only backend. Activate application I/O only in an owned request
   context, before executing invocation code. Do not snapshot host bindings,
   descriptors, pending promises or cancellation state. Runtime packages retain
   the managed platform's existing authentication and native-module admission.
5. **Awaited completion.** Provide a supported invocation cleanup boundary while
   its I/O context is still valid: stop admission, cancel/drain owned tasks,
   finalize guest buffers/destructors/exit handlers as applicable, await native
   descriptor closure, and detach callbacks before releasing interpreter state.
   Specify whether the runtime or adapter performs each phase. Do not ask an
   application to finalize a shared managed interpreter through private exports.
6. **Cancellation and errors.** Propagate cooperative cancellation to admitted
   backend work, observe late rejections, and prevent callbacks from touching
   retired memory. Preserve errors from writes, metadata and close at their
   appropriate operation/cleanup boundaries. Cancellation cannot undo completed
   effects or preempt an arbitrary CPU loop. Closing one invocation must not
   retire a borrowed provider or affect siblings.
7. **Binary streams.** Route fd 0/1/2 through invocation-owned byte channels with
   bounded chunks, backpressure and explicit close semantics. Filesystem support
   must not implicitly enable general outbound network or native processes.

A first adapter can enforce one invocation per fresh managed child. Reusing one
interpreter across concurrent calls is not required and must not be assumed safe.
Retirement guarantees may be an invocation protocol rather than a new general
WorkerStub disposal method, provided the observable cleanup requirements hold.

## Implementation ownership

- **Cloudflare/workerd owner:** identify the supported hook, or implement and
  document the capability plus bootstrap, snapshot and cleanup integration.
  Likely internal touchpoints are `WorkerLoader::WorkerCode`, managed
  `getInstantiateWasm`, and the managed request/interpreter lifecycle. Those
  upstream files are outside this repository; no upstream patch or deployment
  is claimed by this plan.
- **SafeFS owner:** retain the existing authoritative async `PythonFileSystem`
  service and descriptor contracts. No new copied filesystem, object-store
  staging implementation, or root/identity workaround is needed for this request.
- **Issue #746 owner:** once the hook is supported, adapt it to
  `PythonAsyncExecutor`/`PythonExecutorStart`, reuse existing invocation policy
  and native-operation semantics, and keep it separate from the custom JSPI host.
  Do not publish a managed executor that silently falls back to MEMFS, Node or
  the custom interpreter when hook negotiation fails.
- **Release/deployment owner:** integrate atomic repository changes, publish,
  authorize a disposable Cloudflare deployment, and verify its cleanup. Do not
  request or expose deployment credentials in issue evidence.

## TDD and acceptance sequence

1. Follow the filed [workerd capability/lifecycle request #7432](https://github.com/cloudflare/workerd/issues/7432),
   linking #746 and the maintained public JSPI test as an independent reference.
   Obtain either the documented existing hook or an agreed upstream change.
   Filing the request does not qualify the managed executor or its native mount.
2. In the runtime change's own test suite, first reproduce the ordinary native
   stat/import failure against a delayed authoritative provider. Build the driver
   at the actual pre-instantiation boundary, not through Emscripten callbacks.
3. Qualify real native open/read/write/stat/fstat, source and ZIP imports, native
   extension I/O, binary stdio, exact backend errors and retained identity.
   Include a native caller that does not rely on CPython's EINTR retry loop.
   Every operation must await its own result; no optimistic success for close or
   deferred mutation errors.
4. Exercise small transfer/descriptor budgets, delayed I/O and backpressure,
   async finalization, startup/in-flight cancellation, cleanup failures, late
   completion, callback-after-retirement rejection and sibling ownership. Verify
   application capabilities are absent from baseline/snapshot state.
5. Add the repository adapter only after the runtime contract is usable. Test
   capability/version rejection before acquisition and explicit per-invocation
   ownership. Register any new maintained integration fixture with the parent.
6. Run the managed public-package consumer on the supported workerd version, then
   an authorized disposable deployment. Record package/source/runtime identities,
   startup, linear memory and asset sizes separately from RSS or isolation claims.
   Delete the deployment and close #746 only when both remaining gates pass.

Do not repeat the failed callback, symbol-replacement, EINTR-completion or
return-coercion probes without a materially changed runtime interface. Existing
evidence remains under the issue worktree's `out/issue-746/`; it is not a substitute
for the runtime implementation and acceptance sequence above.
