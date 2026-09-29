# Python shell commands

`poe_shell` runs the parent invocation's configured Safe Bash commands against
its canonical filesystem. It does not create OS processes or copy a workspace.
The host explicitly enables it:

```javascript
import { pythonCommands, createPythonShellCapability } from '@poe-platform/safe-bash/commands/python';

shell.use(pythonCommands({
  createExecutor,
  createCapabilities: context => ({ shell: createPythonShellCapability(context) }),
}));
```

Host capabilities require an asynchronous executor. The shared-memory Worker
transport is rejected for capability calls; there is no Atomics.wait fallback.
Both launchers still bundle the modules, and existing Node filesystem execution
remains available. The qualified suspension boundary is Pyodide/JSPI in workerd.

The native capability carries JSON data, never host credentials or service object
proxies. Its scope ends with the Python invocation. The deterministic shell/subprocess API suites pass. Current installed-package
and hosted qualification are tracked in the issue plan; they are separate from
these API tests. These examples require the capability.

Ordinary `import subprocess` supports this subset through the existing Python
launcher:

```python
import subprocess

result = subprocess.run(["rg", "TODO", "/project"], capture_output=True, text=True)
print(result.returncode, result.stdout, result.stderr)
contents = subprocess.check_output(["cat", "/project/report.txt"])
subprocess.run("printf hello | cat", shell=True, check=True)
```

Literal argv is never interpolated into shell source. `shell=True` explicitly
selects Safe Bash's parser. Only commands enabled by the parent are available;
an unknown command returns the shell's status and diagnostic. Model-library
operations remain a separate structured capability, not command strings.

| API or option | Behavior |
| --- | --- |
| `run`, `check_output` | Standard `CompletedProcess`, `CalledProcessError`, `TimeoutExpired` |
| `capture_output`, `check` | Separate captured stdout/stderr; optional status checking |
| `text`, `encoding`, `errors`, `universal_newlines` | Decode captured bytes; encode text input |
| `input` | Binary bytes or text in text mode |
| `cwd`, `env` | Child-only cwd; supplied environment replaces child environment |
| `timeout` | Host deadline and cancellation; partial captured bytes on expiration |
| `stdin`, `stdout`, `stderr` | Inherited, `PIPE`, or `DEVNULL`; no file descriptors or merging |
| `Popen`, process groups, PTY, executable override, other options | Explicitly unsupported |

Default stdin inherits the parent's stream. `PIPE` without input and `DEVNULL`
produce EOF. Python-buffered data is visible to shell commands after ordinary
flush/close; the library does not flush arbitrary guest files automatically.

For async workflows and incremental output:

```python
from poe_shell import Client
from pyodide.ffi import run_sync

async def main():
    async with Client() as client:
        result = await client.run(["cat", "/project/report.txt"])
        print(result.stdout.decode())
        async with client.stream(["echo", "hello"]) as stream:
            async for event in stream:
                if event.type == "stdout":
                    print(event.data.decode(), end="")

run_sync(main())
```

Use `async with` for streams, especially when breaking early. Stream writes apply
backpressure; closing cancels and awaits the child command. The host fragments
stdout and stderr before serialization, independently of command write sizes.
`maxStreamChunkBytes` defaults to 16384 and requires a positive finite safe
integer. Choose it with JSON-envelope headroom under finite bridge message
limits; byte arrays can require several serialized bytes per output byte.
`maxOutputBytes` still counts total raw stdout plus stderr, while the bridge
`maxStreamBytes` counts serialized stream events. Buffered `run`/`capture_output`
results require their own whole-result message budget. Host input and output limits default to disabled. Configure
`maxInputBytes` and `maxOutputBytes` in `createPythonShellCapability`, or request
`max_output_bytes` in the Python API. Configure serialized-message limits with
`capabilityLimits`. Parent filesystem, command, output and cancellation budgets
remain active. These are cooperative limits, not CPU preemption or adversarial
confinement.

Direct nested `python`/`python3` argv is rejected with `nested_python`.
Capability-enabled Python allows one interpreter per shell execution scope;
reentry through scripts, aliases or pipelines fails admission immediately rather
than waiting for the suspended interpreter. Independent invocation scopes may
run concurrently subject to configured worker/pool limits. Hosted consumer
acceptance remains recorded in the issue's requirement matrix.

Run the bundled [shell-tools.py](examples/shell-tools.py) with `python /work/shell-tools.py` after placing it in the canonical filesystem. It requires the parent to enable `rg`, `/project` to contain a TODO, and a writable `/work`. Current installed-package qualification of this exact file is tracked in the issue plan.
