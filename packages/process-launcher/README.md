# process-launcher

Lightweight cross-platform process supervisor for `poe-code`.
Start, monitor, restart, and stop long-running dev tools from JavaScript. It supports host and
Docker runtimes through `@poe-code/process-runner`.

## Usage

```ts
import { startManagedProcess, stopManagedProcess } from "@poe-code/process-launcher";

const record = await startManagedProcess({
  baseDir: ".poe-code/processes",
  spec: {
    id: "dev-server",
    command: "npm",
    args: ["run", "dev"],
    restart: "on-failure",
    readyCheck: { kind: "tcp", port: 3000 }
  }
});

console.log(record.state.status);

await stopManagedProcess({ baseDir: ".poe-code/processes", id: "dev-server" });
```

## Managed process specs

`startManagedProcess()` persists a process spec under the managed process directory and validates it
when the process is started or resumed.

```ts
type ProcessSpec = {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  restart: "never" | "on-failure" | "always";
  maxRestarts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  readyCheck?:
    | { kind: "log-pattern"; pattern: string }
    | { kind: "tcp"; port: number; host?: string; timeoutMs?: number };
  logRetainCount?: number;
  docker?: DockerRunnerOptions;
};
```

Validation rules:

- `id` must be a single path segment with no leading/trailing whitespace, `.`/`..`, or control characters.
- `command` and log-pattern readiness checks must be non-blank strings.
- TCP readiness ports must be safe integers from `1` to `65535`.
- Durations and poll intervals must be finite non-negative numbers; retain counts and restart counts must be safe integers in their documented ranges.
- Persisted state and spec files are rejected if their shape does not match the managed process id.

`followManagedLogs()` emits the bounded initial log window before streaming newly appended output, so callers do not miss recent retained lines when attaching to an active process.

## API

- `startManagedProcess(options)` — start a managed process and write its spec/state.
- `stopManagedProcess(options)` — stop a managed process and update state.
- `restartManagedProcess(options)` — stop and start a managed process.
- `runManagedProcess(options)` — run the supervisor loop for an existing spec.
- `readManagedLogs(options)` / `followManagedLogs(options)` — read or stream retained logs.
- `listManagedProcesses(options)` / `removeManagedProcess(options)` — inspect or remove managed entries.
- `createSupervisor(options)` — lower-level supervisor for one `ProcessSpec`.
- `createStateStore(options)` / `createLogWriter(options)` — state and log persistence helpers.
- `waitForReady(check, options)` — wait for a log-pattern or TCP readiness check.

## Environment variables

This package exposes no environment variables. Pass per-process variables through `ProcessSpec.env`.

## Configuration

There are no package-level config files. Configure each process through `ProcessSpec` and each API
call through its options (`baseDir`, `startupTimeoutMs`, `stopTimeoutMs`, `pollIntervalMs`, `fs`,
`runner`, and `signal` where supported).
