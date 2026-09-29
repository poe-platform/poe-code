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
CPU-only Python. Coroutine/task-cancellation behavior needs separate qualification;
this API does not claim an async Python calling convention.

`run` supports literal argv or explicit `shell=True` script parsing, input bytes
or text, cwd, environment overlays, UTF-8 text output, `check` and a positive
`timeout` in seconds. It returns `args`, `returncode`, `stdout` and `stderr`.
`check_output` checks the status and returns captured stdout. Nonzero checked
results raise `CalledProcessError` with `returncode`, `cmd`, `output` and `stderr`.
This executes configured Safe Bash commands, not OS processes. There is no
Popen, PTY, fork, process signaling or arbitrary-binary support.

Shell execution uses the parent's invoker and canonical filesystem, with the
same execution budget and cancellation/deadline authority. cwd/env are child
state. Python must close or flush its ordinary file handles before shell commands
read their contents; no workspace copies or automatic guest-buffer flushes occur.
Nested Python calls in the same execution scope fail with a diagnostic and status
1 while a Python-originated shell call is active. They never queue for the occupied
interpreter or increase pool capacity. This conservative rule also covers other
Python stages sharing that execution scope.

Default capability limits are one pending call, four retained streams and 64 KiB
of serialized data per request/result, with a maximum data depth of 32. Configure
`capabilityLimits` explicitly when installing the plugin. Streams pull one event
per guest request and copy binary events into owned byte arrays. `with stream(...)`
or explicit `close()` releases an iterator on early exit. Invocation teardown
aborts pending operations, awaits their settlement and closes retained iterators.
Uncooperative host operations retain admission until they settle; cancellation is
cooperative and does not undo effects already committed.

The shell adapter additionally defaults to 8 KiB input and 8 KiB combined captured
stdout/stderr per call. Configure `maxInputBytes` and `maxOutputBytes` when creating
the adapter. Capture overflow fails rather than returning silently truncated data.
Native JSON transport is bounded separately; do not configure capability messages
above 64 KiB. Application-specific host failures become sanitized `HostError`s in
the guest; detailed host errors must stay in host-owned diagnostics.

The asynchronous Node worker protocol is unchanged and does not install these
capabilities. Use an explicit asynchronous executor supporting `start.host`.
Static module source ships with the package and uses the authenticated JSPI asset
recipe; it requires no pip downloads or runtime JS/Wasm compilation.

Qualification of this API in the existing deployed Cloudflare tool Worker and
hosted CI is still required. A local workerd test does not establish that delivery.
