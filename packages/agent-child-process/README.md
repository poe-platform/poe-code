# @poe-code/agent-child-process

Isolated child process helpers with optional agent follow-up support.

## Exports

- `exec(command, options?)`
- `execFile(file, args?, options?)`
- `spawn(file, args?, options?)`

The package exports only its root entrypoint.

## Options

- `spawnProcess`: custom `node:child_process.spawn` implementation. Defaults to Node's `spawn`.
- `runAgent`: custom agent runner. Defaults to `@poe-code/agent-spawn`.
- `cwd`: working directory passed to the child process and agent follow-up.
- `env`: environment passed exactly to the child process.
- `signal`: abort signal passed to the child process and agent follow-up.
- `rejectOnNonZeroExit`: reject with `AgentChildProcessError` when the command exits non-zero.
- `context`: caller context included in the agent follow-up prompt.
- `onExit`: optional follow-up policy with `agent`, optional `model`, `prompt`, and optional `when` predicate.

## Environment Variables

This package exposes no environment variables.

## Configuration

This package currently exposes no package-level configuration options.
