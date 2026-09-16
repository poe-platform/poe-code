# Optional Python worker commands

`poe-code/safe-bash/commands/python` exports `pythonCommands`,
`createPythonCommands`, and their TypeScript contracts. Registration adds
`python` and `python3` explicitly; it does not modify `agentCommands()`.

```ts
import { Shell, agentCommands } from 'poe-code/safe-bash';
import { pythonCommands } from 'poe-code/safe-bash/commands/python';

const shell = new Shell({ fs, cwd: '/work' })
  .use(agentCommands())
  .use(pythonCommands({ createWorker }));
const result = await shell.exec('python "document café.py"');
```

`createWorker()` synchronously creates a fresh dedicated interpreter worker and
returns a `PythonWorkerEndpoint`: `postMessage(value)`,
`subscribe(onMessage, onError)` returning an unsubscribe function, and
`terminate()` returning either void or a completion promise. Wire these to the
host's worker messaging, error and termination APIs. `onError` must report
unexpected worker failure or exit; otherwise a worker that disappears without a
completion message cannot settle its invocation.

The worker receives a `PythonWorkerStart` message. In that worker, import
`runPythonWorker` from `poe-code/safe-bash/commands/python/worker` and call:

```ts
await runPythonWorker({
  start,
  loadRuntime: configuration => loadPyodide({ ...runtimeAssetOptions, ...configuration }),
  postMessage: message => workerPort.postMessage(message),
});
```

The host supplies `loadPyodide` and its runtime assets. Explicit package
provisioning uses the configured installer transport and artifact cache; see
[package environments](../../docs/python-packages.md). The command does not
download an interpreter. The current runner requires Pyodide **314.0.6** and its measured
private filesystem/native-loader ABI. Supplying another version fails startup.
Each invocation owns and terminates its worker; runtime reuse is not implemented.

Supported entry forms are `python FILE [ARGS...]`, `python3 FILE [ARGS...]`,
`python -c CODE [ARGS...]`, `python -m MODULE [ARGS...]`, and `python -` (or no
operand) for source from stdin. File and inline-code entry leave stdin for program
data. Unsupported interpreter flags and missing `-c`/`-m` operands fail with
status 2. Python exceptions and `SystemExit` use Python exit status behavior;
stream flush failure selects status 120. This is not an interactive REPL.
`sys.orig_argv` retains the invoked command alias and original interpreter
arguments, independently of the execution mode's `sys.argv`. Custom worker
start messages may supply `invocation.command`; omission uses `python`.

## Configuration and ownership

- `createWorker` is required. It must place the synchronous interpreter on a
  different event loop from filesystem and shell stream service work.
- `runtimeMount` defaults to `/.pyodide-runtime`. It must be an absolute
  top-level path. Bootstrap stdlib/site-packages storage is mounted separately
  there. An existing caller entry at that path prevents startup. Runtime storage
  is read-only to application filesystem operations.
- `maxTransferBytes` defaults to 65536; `maxOpenFiles` defaults to 256. Both must
  be positive safe integers no greater than 1048576. Transfers are incremental;
  these limits are not total interpreter memory or instruction budgets.
- `maxConcurrentWorkers` defaults to 4 and accepts integers 1–64. Both aliases
  share this per-plugin limit. Capacity exhaustion returns status 1 immediately;
  workers are never queued behind running pipeline stages.
- `maxInputChunkBytes` defaults to 1 MiB and accepts integers 1–16 MiB. An
  oversized upstream stdin fragment returns status 1 before the bridge retains
  a copy. This bounds bridge retention, not allocation already made by its producer.
- `replace` defaults to false and controls command-registration collisions.
- `packages`, `requirements`, `packageProfile` and `provisioning` configure
  explicit package installation, canonical input files, the opt-in document
  profile, and installer transport/cache policy. The complete configuration and
  supported `python -m pip install` options are documented in
  [package environments](../../docs/python-packages.md).

All application filesystem requests use the invocation's scoped caller
filesystem. Retained acquisitions use `openCommandFile` for shell file-output
accounting. The service is registered for invocation cleanup before acquisition
and owns descriptor retirement, including late acquisitions. Backend errors and
caller cancellation remain observable; cancellation does not undo completed
mutations. An uncooperative backend promise can delay cleanup indefinitely.

The interpreter alone may block in `Atomics.wait`. The host services bounded
stdin pulls, awaited stdout/stderr writes and asynchronous filesystem requests
without blocking its event loop. Browser use requires worker support and a
secure cross-origin-isolated environment permitting `SharedArrayBuffer`, with
appropriate COOP/COEP, CSP and runtime-asset loading configuration. A browser
main thread cannot serve as this interpreter worker. Workerd is not a qualified
shared-memory deployment.

## Streaming, cancellation and lifetime

Each accepted invocation has a separate worker and fresh interpreter, including
module globals, cwd, environment and bootstrap filesystem. A custom worker
factory must preserve this independence; sharing one interpreter or blocking the
host service loop violates the integration contract. Two accepted pipeline
stages can therefore make progress concurrently. A pipeline requiring more
workers than the configured capacity fails a stage explicitly. Separate plugin
instances have separate admission counters; the host must bound their number.

Stdin, stdout, stderr and filesystem RPC share one synchronous request/reply
slot per worker. The interpreter waits while its host services the request.
Stdin is pulled on demand; its retained upstream fragment is an owned copy and
is bounded independently of wire transfers. Output is byte-oriented, split at
`maxTransferBytes`, and acknowledged only after the destination write resolves.
No text decoding/reencoding is used for binary program output. Shell pipe and
collected-output limits remain separate. The bridge does not eagerly collect
whole streams; guest calls such as `sys.stdin.read()` can still allocate a large
Python object.

Cancellation closes service admission and terminates the dedicated worker. It
does not require a Python `await`, `KeyboardInterrupt` handler, signal polling
or interpreter initialization to finish. This same mechanism covers CPU loops,
imports, initialization and blocked RPC. Cleanup suppresses new/late requests,
retires canonical handles including cooperative late acquisitions, drains
admitted output/backend work and awaits worker termination. A worker is never
reused after success, error or abort. A slot is released only after successful
cleanup; cleanup failure conservatively retains it, so a failed endpoint cannot
silently exceed the configured limit. Repair the host integration before
replacing its exhausted plugin.

Already admitted host effects cannot be undone. Uncooperative filesystem,
transport or sink promises may delay cleanup indefinitely; worker termination
cannot preempt arbitrary host JavaScript. There is no enforced Python instruction
quota, per-command CPU budget, WebAssembly heap cap or RSS cap. Host deadline
cancellation can terminate execution while the host event loop is responsive;
it is not a hard CPU-time guarantee. Worker count, bounded bridge buffers and
cache limits reduce retained host resources without bounding guest allocations,
installed package expansion or total process memory.

## Preserved refusals and qualification limits

The bridge does not mirror application trees into MEMFS or write them back on
exit. It preserves backend refusal of retained descriptors, strong unlink and
empty-directory removal, synchronization and other optional operations. It does
not infer support from a backend name or unwrap quota/read-only/mounted views.
An unsupported backend operation can therefore prevent a Python library from
working even when the same library works in runtime bootstrap storage.

Canonical stat identity is translated through a bounded invocation-local mapping
of complete scope/device identities. Opaque scopes never cross the wire. Runtime devices occupy a separately
bounded high-half uint32 namespace so matching application/runtime inode
numbers do not become false aliases.
Python `os.stat`, `os.lstat`, `os.fstat` and the corresponding `pathlib`
operations project known canonical metadata into `os.stat_result`; unavailable
optional observations remain `None`. Unknown required identity fails with
`EOVERFLOW`. Descriptor-relative stat is unsupported. Native C-library stat
calls use a stricter ABI conversion and fail `EOVERFLOW` when required numeric
fields are unknown or unrepresentable. Neither route fabricates zero identity,
allocation or block-size observations. Internal node routing and import
discovery consume their known type, mode, size and timestamp fields separately.
Native metadata-dependent extension libraries can therefore remain unsupported
on backends lacking the full numeric observations. Native directory descriptors
are unsupported (`ENOTSUP`), because canonical storage has no retained directory
descriptor contract. Python `os.listdir` and context-managed `os.scandir` use a
bounded canonical directory listing; `DirEntry` metadata is obtained lazily from
canonical paths. This also supports `os.walk` and `Path.iterdir` without claiming
retained-directory identity.

Stock Python/JavaScript interoperability and a worker are not a guest security
boundary. `createWorker` and `loadRuntime` are trusted host integrations. The
runner supplies a null-prototype empty `jsglobals` to the loader: ordinary
`import js` does not receive ambient `process`, `fetch`, `globalThis` or host
objects. The loader must honor that configuration. This is exposure reduction,
not confinement: Python/JS proxy reflection, runtime internals, supplied
callbacks and extension packages have not been proven capability-safe. The
loader also refuses public native filesystem/socket mount APIs, removes the
exposed NODEFS backend and replaces the pinned libc system/socket imports with
`ENOSYS` before WebAssembly instantiation. It refuses startup when those required
ABI hooks are unavailable. This closes ordinary native/API routes; it is not a
proof against deliberate JavaScript recovery of host authority.

The Node endpoint requires `trustedPython: true` before creating a worker.
Use it only with trusted Python, its imports and package code. A hostile program
must be isolated by an independently enforced host filesystem/network policy;
the plugin's canonical filesystem and installer authorizer govern their own
bridges, not every possible JavaScript access path. No restriction on arbitrary
guest networking or host access is claimed. The runtime asset loader also has
its own host authority outside installer authorization. There is no automatic
host process or host-filesystem fallback for Python APIs.

Real-runtime qualification and remaining preservation gaps are tracked in
[`packages/safe-bash/docs/pyodide.md`](../../docs/pyodide.md). The maintained opt-in
`tests/integration/pyodide-runtime/product-worker.test.mjs` exercises the actual
runner with the isolated pinned runtime; unit worker doubles alone do not
establish Python compatibility. A passing scoped workflow does not establish
complete filesystem or extension-library coverage.

An earlier product-worker integration reported twelve passing tests against the
pinned Node worker runtime: delayed canonical requests and temporary files;
Unicode script filenames and arguments; local imports; binary retained file I/O
across the transfer boundary; seek, append, exclusive creation, truncate and
rename/unlink; Python metadata and timestamps; symlinks and terminal directory
syntax; directory enumeration; runtime read-only and identity separation; the
`python3 -c` alias; piped source; piped `python -m json.tool`; ordinary-open
`EISDIR`; and exclusive-create `EEXIST` for existing files, directories and
regular, dangling and self-loop final symlinks. These are
scoped runtime observations, not qualification of every extension package,
remote backend or browser deployment.

Additional actual-plugin stream tests exchange binary bytes bidirectionally
through one-byte shell pipes and cancel while stdin, stdout or stderr is
blocked. Each cancellation test retains an application descriptor before
blocking, then verifies zero remaining descriptors and completed worker
termination before command settlement. These checks cover cooperative pipes,
not forced cancellation of an arbitrary backend promise that never settles.

## Command launcher and host configuration

`pythonCommands({ createWorker, runtimeMount?, maxTransferBytes?, maxOpenFiles?,
maxConcurrentWorkers?, maxInputChunkBytes?,
onProgress?, packages?, requirements?, packageProfile?, provisioning?, replace? })` registers both `python` and `python3`. Registration
creates no interpreter. Each command creates and terminates its own dedicated
worker; interpreter instances are not pooled. `onProgress` reports `initializing`,
`ready`, and `finished` for the host UI, separately from guest output streams.
The default runtime mount is `/.pyodide-runtime`, transfer limit is 65,536 bytes,
and open-file limit is 256. The injected loader must honor the startup
configuration passed to `loadRuntime`; accepting it and loading an unconfigured
interpreter would not satisfy native flag semantics.

The Node endpoint is available from `poe-code/safe-bash/commands/python/node`:
`createNodePythonWorker({ trustedPython: true, runtimeModuleURL, indexURL? })`. It loads the explicitly
selected Pyodide module lazily inside a fresh worker. The adapter verifies the
qualified Pyodide ABI version (314.0.6); it does not install an interpreter or run
host Python. Runtime assets default to the module's containing directory.

The `runBash` SDK accepts `source`, an explicit `fs` or host `root`, shell execution
options, and optional `python` configuration. An injected `createWorker` needs no
runtime URL. The CLI `poe-code bash -c SOURCE --root DIRECTORY` uses this SDK.
Python is enabled with `--python-runtime URL --python-trusted`; corresponding configuration flags
are `--python-index-url`, `--python-runtime-mount`,
`--python-max-transfer-bytes`, `--python-max-open-files`,
`--python-max-concurrent-workers`, and `--python-max-input-chunk-bytes`. Package options are
`--python-package`, `--python-requirements`, `--python-package-profile`,
`--python-package-cache`, `--python-package-max-cache-bytes`,
`--python-package-offline` and
`--python-package-allow-origin`. `--cwd` is a virtual
path within the configured root. CLI initialization progress goes to stderr.

The launcher supports file, directory/ZIP `__main__`, `-c`, `-m`, explicit `-`,
and noninteractive implicit stdin source. CPython compiles raw source bytes,
including encoding declarations, and its runpy/import machinery executes module
and directory/ZIP entrypoints. Script operands retain their original argv form
while `__file__` uses the resolved absolute entrypoint path. Canonical shell
script resolution also dispatches registered `/bin` and `/usr/bin` interpreters
and `/usr/bin/env` shebangs without decoding the Python body as shell source.

Native startup options include `-B`, `-E`, `-P`, `-O`/`-OO`, `-u`, `-s`, `-S`,
`-I`, `-b`/`-bb`, `-d`, `-v`, `-q`, and `-R`. `-X` supports `utf8[=0|1]`,
`dev`, `warn_default_encoding`, and `int_max_str_digits=N` (zero or a native
integer at least 640). `-W` warning filters are applied after Pyodide bootstrap
so an error filter does not prevent the runtime's own startup. Help/version
options are handled explicitly. `--` terminates interpreter options; arguments
after the entrypoint are guest arguments. Remaining flags fail with status 2;
they are not silently ignored.

The guest receives the invocation environment. Canonical `PYTHONPATH` and
`PYTHONIOENCODING` are applied after filesystem setup, and warning configuration
after bootstrap. `-E`/`-I` suppress Python environment settings. Nonempty
`PYTHONHOME` and `PYTHONINSPECT` are explicit unsupported-configuration errors
unless ignored by those flags or the invocation only requests help/version.
The reserved runtime namespace and runtime
bootstrap site behavior are not equivalent to a host CPython installation.

There is no terminal identity/session contract in `CommandContext` or
`ShellExecOptions`. All three Python streams report non-TTY, no-argument Python
reads source until EOF, and `input()` reads the supplied noninteractive stream.
No-argument interactive use, `-i`, line editing, terminal signal handling, and
terminal window behavior remain compatibility gaps. Rejection of these modes is
not evidence of interactive support.

Current launcher validation is tracked separately in
[`docs/plans/python-command-integration.md`](../../../../docs/plans/python-command-integration.md).
