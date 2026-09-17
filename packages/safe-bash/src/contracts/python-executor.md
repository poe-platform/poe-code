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

This seam does not by itself qualify Cloudflare managed Python or a custom JSPI
build. Those hosts still need real native-syscall/import/stdio and artifact tests.
JSPI suspension does not preempt CPU-only loops, and a cooperative AbortSignal
does not establish the untrusted-execution profile tracked separately in issue 750.
