# @poe-code/process-launcher

Start, monitor, restart, and stop managed processes through the host or configured execution runtime.

## Usage

```ts
import { startManagedProcess, stopManagedProcess } from "@poe-code/process-launcher";

// The host supplies a launcher for the supervisor process and returns its PID.
declare const spawnDaemon: (id: string) => Promise<number | null>;

const record = await startManagedProcess({
  baseDir: ".poe-code/processes",
  spawnDaemon,
  spec: { id: "dev-server", command: "npm", args: ["run", "dev"], restart: "on-failure" }
});
console.log(record.state?.status);
await stopManagedProcess({ baseDir: ".poe-code/processes", id: "dev-server" });
```

## Public API

- `startManagedProcess`, `stopManagedProcess`, `restartManagedProcess`, and `runManagedProcess` manage persisted processes.
- `listManagedProcesses` and `removeManagedProcess` inspect or remove records.
- `readManagedLogs` and `followManagedLogs` read retained logs; following emits the bounded initial window before appended output.
- `createSupervisor`, `createStateStore`, `createLogWriter`, and `waitForReady` expose lower-level supervision, storage, logging, and readiness helpers.

## Configuration

`ProcessSpec` contains `id`, `command`, optional `args`, `cwd`, and `env`, plus a `restart` policy (`never`, `on-failure`, or `always`). Optional restart settings are `maxRestarts`, `backoffMs`, and `maxBackoffMs`. `readyCheck` accepts a log pattern or TCP port/host/timeout; `logRetainCount` controls retained logs, and `docker` configures the Docker runtime.

Managed API options include `baseDir`, an optional filesystem, and per-operation polling/startup/stop timeouts. Starting requires the host's `spawnDaemon` callback. Stopping supports `force`, process signaling, and runtime-artifact cleanup callbacks. Consult the exported option types for each operation's accepted callbacks.

At the supervisor layer, `startSettleMs` defaults to `250`; `0` disables the survival check. Processes without a readiness check must survive that window before being reported as running. Process ids, non-blank commands, readiness ports, restart counts, durations, and persisted record shapes are validated.

## Environment variables

Pass child environment values through `ProcessSpec.env`. There is no package-level configuration file.
