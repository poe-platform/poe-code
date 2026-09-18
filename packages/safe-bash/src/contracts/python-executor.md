# Asynchronous Python executor injection

`pythonCommands` and `createPythonCommands` accept exactly one of `createWorker`
or `createExecutor`. The former retains the existing dedicated-worker/shared-memory
transport. The latter does not allocate SharedArrayBuffer or use Atomics.

`createExecutor()` synchronously returns a new invocation-owned endpoint with:

- `run(start): Promise<number>`: starts the configured interpreter and resolves
  with a validated shell exit status. It must not exit with a dispatch outstanding.
- `terminate(): void | Promise<void>`: closes admission, interrupts owned runtime
  work and awaits retirement, including a pending `run`. No implicit provider
  disposal occurs; a shared host provider belongs to the caller, not this endpoint.

`PythonExecutorStart` contains the same invocation, runtimeMount, package manifest,
installOnly and maxTransferBytes settings used by the worker path, plus:

- `signal`: the invocation cancellation signal, also aborted during cleanup.
- `dispatch({ op, args })`: asynchronous canonical filesystem/package/byte-stream
  requests. Only one request may be active at a time. It enforces the existing
  transfer, descriptor, input and shell output budgets, and awaits backpressure.
- `onReady()`: host-only initialization progress, separate from guest output.

The endpoint must use the supplied dispatch for canonical filesystem operations;
a private workspace copy is not equivalent. The interpreter adapter must translate
filesystem error codes into guest errno without exposing host stack traces or
credentials. Loading a Python runtime and making its native/C-extension syscalls
asynchronous are responsibilities of the selected, independently qualified host.

Command parsing, literal argv/environment snapshots, package preparation, service
ownership, limits and cleanup remain shared. Both python aliases use the same
plugin-local capacity. The legacy option name `maxConcurrentWorkers` also bounds
asynchronous endpoints in that plugin; it is not an application-wide host quota.
Other existing Python options retain their meanings. No environment variables are
introduced by executor selection.

Capability inspection accepts `createExecutor` without requiring worker transport
globals. Configuration validity is not proof that a host supports native Python
I/O, a particular ABI, CPU preemption, heap/RSS limits or guest isolation. Unsupported
hosts must refuse instead of falling back to ambient execution.

Cancellation closes content-operation admission, but an active executor may
still dispatch validated `close` requests to release its retained descriptors.
These are release-only requests, not renewed filesystem authority. Shell waits
for executor termination before retiring the filesystem service; the service
then releases any remaining handles even when executor termination failed.
Already-admitted cooperative I/O must settle before its descriptor is released.

This seam does not by itself qualify Cloudflare managed Python or a custom JSPI
build. Those hosts still need real native-syscall/import/stdio and artifact tests.
JSPI suspension does not preempt CPU-only loops, and a cooperative AbortSignal
does not establish the untrusted-execution profile tracked separately in issue 750.

## Shared host admission

`createPythonExecutorPool({ createExecutor, maxConcurrentExecutors })` supplies a
shared `createExecutor` factory for independent shells and both Python aliases.
Create one pool in the host and pass its factory to every participating plugin.
The capacity must be a positive safe integer; there is no implicit host limit.

Admission is immediate: saturation raises the sanitized Python `capacity` failure
rather than queueing pipeline stages. A reservation starts before factory entry
and survives until execution settles and the endpoint successfully terminates.
Successful run completion alone does not release it. Failed retirement retains
the reservation and remains observable to `dispose`; it is not retried blindly.

`inspect()` reports only `{ active, capacity, closed }`. `dispose()` closes new
admission and awaits all owned endpoint retirements, even when one fails. Calls
are idempotent. Each returned endpoint admits at most one run. Disposing a shell
does not dispose its borrowed pool or sibling endpoints; only the host pool owner
calls `dispose()`. The underlying host provider remains borrowed as well.

This ledger is shared only by users of that pool instance, not across processes
or isolates. Hosts with multiple service instances need authoritative distributed
admission. No environment variables are introduced. Pooling is not a security
boundary and grants no CPU, memory, egress, package-expansion or native isolation
guarantee; those require a qualified host implementation.
