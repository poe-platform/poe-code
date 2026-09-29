# Call host services from Python

The explicit JSPI executor accepts invocation-owned capabilities. Register them
when installing `pythonCommands`; do not put user authority in the shared executor
pool or expose host objects through `jsglobals`.

```js
import { pythonCommands, createPythonShellCapability } from '@poe-platform/safe-bash/commands/python';
import { createLlmService } from '@poe-platform/safe-bash/commands/llm';

const service = createLlmService({ providers, defaultModel });
shell.use(pythonCommands({
  createExecutor: pool.createExecutor,
  maxConcurrentWorkers: 1,
  createCapabilities(context) {
    return {
      llm: {
        stream(value, { signal }) {
          return service.complete({
            prompt: value.prompt, options: {}, attachments: [], signal,
          });
        },
      },
      shell: createPythonShellCapability(context),
    };
  },
}));
```

Host closures retain credentials, billed-user identity and service bindings. The
registry is created separately for each invocation. Factories must bind the
caller's authorized service and validate their application-specific requests.
The bridge grants no authority beyond the explicitly registered names.

An ordinary Python file uses the statically installed `safe_host` module:

```python
from safe_host import stream, run, check_output

with stream('llm', {'prompt': 'Hello'}) as chunks:
    for chunk in chunks:
        print(chunk, end='')

result = run(['rg', 'needle', '/work/input.txt'], text=True)
print(result.returncode, result.stdout, result.stderr)
print(check_output('llm hello | rg hello', shell=True, text=True))
```

These synchronous functions suspend at the existing native JSPI boundary while
JavaScript awaits the operation. They require neither top-level await nor nested
`asyncio.run`, and do not use busy polling or `Atomics.wait`. They do not preempt
CPU-only Python. The bundled `poe_llm` and `poe_shell` libraries also support coroutine calls.
Their adapter starts bounded host jobs and yields between readiness checks with
a 1–16 ms backoff; cancelling a guest task aborts its specific host job. It does
not poll synchronously or reenter a suspended interpreter. Use
`pyodide.ffi.run_sync(main())` from an ordinary Python file; this suspension
boundary and exception translation are exercised in real workerd.

`run` supports literal argv or explicit `shell=True` script parsing, input bytes
or text, cwd, explicit child environments, UTF-8 text output, `check` and a positive
`timeout` in seconds. It returns `args`, `returncode`, `stdout` and `stderr`.
`check_output` checks the status and returns captured stdout. Nonzero checked
results raise `CalledProcessError` with `returncode`, `cmd`, `output` and `stderr`.
This executes configured Safe Bash commands, not OS processes. The runtime also adapts stdlib `subprocess.run` and `subprocess.check_output`
to the same shell capability. `poe_shell.Client` supports coroutine execution and
incremental stream events with backpressure. The shell adapter splits stdout and
stderr writes into 16 KiB chunks by default; configure `maxStreamChunkBytes`
with JSON-envelope headroom below the invocation message budget. There is no Popen, PTY, fork, process
signaling or arbitrary-binary support.

Shell execution uses the parent's invoker and canonical filesystem, with the
same execution budget and cancellation/deadline authority. cwd/env are child
state: omitted env inherits; supplied env replaces the child environment. Python must close or flush its ordinary file handles before shell commands
read their contents; no workspace copies or automatic guest-buffer flushes occur.
Nested Python calls in the same execution scope fail with a diagnostic and status
1 while a Python-originated shell call is active. They never queue for the occupied
interpreter or increase pool capacity. This conservative rule also covers other
Python stages sharing that execution scope.

Capability limits default to disabled (`Infinity`), including call concurrency,
retained streams, serialized message bytes, cumulative stream bytes and message
depth. Set positive safe integers in `capabilityLimits` to enforce host budgets;
`maxMessageBytes` can exceed 64 KiB and `maxMessageDepth` controls nesting. Cyclic
messages are invalid data. Nested shell input, output and concurrency limits also
default to `Infinity`; configure them in `createPythonShellCapability`.
Python `poe_shell` output and `poe_llm.Client` response limits default to `None`
(disabled), and accept `float("inf")`. Finite byte limits remain enforced. LLM
operations inherit the client limit when omitted; explicit `None` disables it. Streams pull one event
per guest request and copy binary events into owned byte arrays. `with stream(...)`
or explicit `close()` releases an iterator on early exit. Invocation teardown
aborts pending operations, awaits their settlement and closes retained iterators.
Uncooperative host operations retain admission until they settle; cancellation is
cooperative and does not undo effects already committed.

For `poe_llm.Client`, register `llm.call({ operation, payload }, { signal })`
for `models`, `complete` and `embed`, and `llm.stream(payload, { signal })`.
The host validates its application-specific payload and reuses its authorized
LLM service. Stream callbacks can yield text/bytes directly or typed event data
including final response metadata. Typed scalar options remain structured data;
no CLI source serialization occurs. Custom request/response transforms and
custom Python bridges from the saved library remain supported.

The LLM adapter accepts host-owned `maxBufferedResponseBytes`,
`maxBufferedEvents` and `maxMetadataBytes`. Buffered completion clamps the shared
service's output limit and admits the serialized result before retaining payload;
JSON escaping, byte-array expansion, model identity, usage and metadata all count.
Empty text events are counted but are not retained. The event and metadata ceilings
default to the buffered ceiling; all three default to disabled (`Infinity`) when
no host limits are configured. Guest limits may lower the host ceiling and cannot
raise or omit it. `maxMetadataBytes` measures the complete terminal response data.
Choose ceilings with headroom below the invocation's serialized-message budget.
These buffered ceilings do not cap stream payload totals: large streams can write
incrementally to canonical files. Text and binary stream events are fragmented
using `maxStreamChunkBytes` (16 KiB by default); text preserves Unicode scalars.
A text scalar larger than the configured chunk ceiling fails explicitly; select
at least four bytes to accommodate every valid Unicode scalar. Parent bridge
stream/message limits and cancellation remain in force.

Configure finite input/output limits explicitly with `maxInputBytes` and
`maxOutputBytes` when creating the shell adapter. Capture overflow fails rather
than returning silently truncated data. Native serialized-message budgets are
configured separately with `capabilityLimits.maxMessageBytes`; there is no
implicit 64 KiB ceiling or separate 128 KiB native decoder ceiling. The native
transport decodes the complete allocated request before applying the configured
capability budget. Application-specific host failures become sanitized
`HostError`s in the guest; detailed errors stay in host-owned diagnostics.

Customizable [Python LLM workflows](python-llm.md) and
[Python shell/subprocess calls](python-shell.md) use this same invocation bridge.

The asynchronous Node worker protocol is unchanged and does not install these
capabilities. Use an explicit asynchronous executor supporting `start.host`.
Static module source ships with the package and uses the authenticated JSPI asset
recipe; it requires no pip downloads or runtime JS/Wasm compilation.

Qualification of this API in the existing deployed Cloudflare tool Worker and
hosted CI is still required. A local workerd test does not establish that delivery.
