# Asynchronous Python executor transport (#746)

## Validated gap

The command plugin requires createWorker and allocates SharedArrayBuffer before
starting execution. A host with a supported asynchronous interpreter cannot reuse
its canonical filesystem, package, byte-stream and invocation policy without
reimplementing the command. Cloudflare-compatible transport is a separate concern
from qualifying a particular interpreter's native filesystem suspension.

## Change

Accept an explicit createExecutor factory instead of createWorker. Each factory
result owns one invocation, exposes run and terminate, and receives immutable
invocation settings, a borrowed signal, bounded canonical dispatch and readiness
notification. Common parsing, package preparation, limits and cleanup remain
library-owned. The existing worker transport remains supported and only that
path requires SharedArrayBuffer/Atomics. Never dispose a borrowed shared provider
when retiring one executor session.

## Qualification boundaries

Prove binary I/O, canonical dispatch, cancellation/retirement, invalid factories,
sanitized failures and capacity without shared-memory globals. Preserve the Node
worker regressions and qualify the public portable artifact under workerd.
This transport seam alone does not qualify Cloudflare managed Python native
syscalls, custom JSPI suspension, native-wheel ABI or untrusted-code isolation.
Issue 746 remains open until those runtime acceptance requirements are met.

## Current evidence

- The pre-change tests rejected createExecutor and capability inspection required
  shared-memory transport. The new path performs canonical binary I/O without it.
- Independent lifecycle review covers cancellation, cleanup barriers, late effects,
  concurrent requests, invalid endpoints, admission, borrowed-factory ownership
  and diagnostics. Five parity defects were reproduced and corrected.
- Additional regressions prevent readiness-observer failures from being swallowed
  and preserve sanitized package errors. The current Python unit cohort has 281
  passing tests, including the retained dedicated-worker path.
- A fresh installed public artifact passes real workerd with throwing getters for
  SharedArrayBuffer and Atomics, preserving binary output, readiness and retirement.
  That fixture intentionally uses a host executor stub, not a Python interpreter;
  it proves transport portability and nothing about native Python suspension.
- Final source/test types and all 26 maintained public-consumer groups pass after
  the build completes. Guarded ESLint reports zero errors. The fresh installed
  candidate also passes real Node/Pyodide object-publication acceptance on both
  flat and delayed stores; the original dedicated-worker transport is retained.
