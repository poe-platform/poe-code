# @poe-code/process-launcher

Lightweight process supervisor for poe-code.

Use it to start, monitor, restart, and stop long-running tools from the host or from a configured execution runtime.

## Public API

- `createProcessLauncher(options)`: creates a launcher backed by the selected runtime.
- `launch(spec)`: starts a process and returns a managed handle.
- `list()`: returns known process records.
- `stop(id)`: stops a managed process.
- `restart(id)`: restarts a managed process with its original spec.

## Configuration Options

Options are passed by the caller:

- `runtime`: execution target. Host runtime is the default; container runtimes are delegated through `@poe-code/process-runner`.
- `cwd`: working directory for launched commands.
- `env`: extra environment values for the child process.
- `restart`: restart policy for supervised processes.
- `startSettleMs`: how long a started process must stay alive before it is reported as `running` (default `250`; `0` disables the check). Processes without a `readyCheck` are only reported `running` once they survive this window.
- `stdout` / `stderr`: output sinks.

## Environment Variables

Caller-provided `env` values are passed to child processes.
