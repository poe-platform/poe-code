# Process Launcher

Note: the original `ProcessRuntime` abstraction is superseded by `Runner`
from `@poe-code/process-runner` (see `docs/plans/process-runner.md`, phase 5
step 17). This plan uses `Runner` as the execution seam.

Lightweight cross-platform process supervisor for poe-code.
Start, monitor, restart, and stop long-running dev tools (e.g. `openclaw`) from the CLI.
Supports both native (host) and Docker runtimes via `@poe-code/process-runner`.

## Package: `packages/process-launcher`

New package. Depends on `@poe-code/process-runner` for all process execution.
No additional runtime dependencies are required.

### File structure

```
packages/process-launcher/
  src/
    types.ts
    index.ts
    supervisor/
    state/
    logs/
    health/
    testing/
```

## Types

Injectable `fs` for testing (same pattern as experiment-loop / ralph).

```typescript
interface LauncherFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number }>;
  readdir(path: string): Promise<string[]>;
  appendFile(path: string, content: string): Promise<void>;
}
```

### Ready checks

Optional mechanism to determine when a process is actually ready.

```typescript
type ReadyCheck =
  | { kind: "log-pattern"; pattern: string }
  | { kind: "tcp"; port: number; host?: string; timeoutMs?: number };
```

For Docker runtime with TCP checks: probe the host port exposed by the runner.

### Process specification

```typescript
type RestartPolicy = "never" | "on-failure" | "always";

interface ProcessSpec {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  restart: RestartPolicy;
  maxRestarts?: number;    // default: 5, 0 = unlimited
  backoffMs?: number;      // default: 1000
  maxBackoffMs?: number;   // default: 30000
  readyCheck?: ReadyCheck;
  logRetainCount?: number; // default: 5
  docker?: DockerRunnerOptions;
}
```

When `spec.docker` is set, the default runner should be created with
`createDockerRunner(spec.docker)`. Otherwise the default runner should be
`createHostRunner()`.

### Process state

Persistent state per managed process.

```typescript
type ProcessStatus = "running" | "stopped" | "crashed" | "restarting";

interface ProcessState {
  id: string;
  pid: number | null;
  status: ProcessStatus;
  runtime: "host" | "docker";
  restartCount: number;
  lastExitCode: number | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  command: string;
  args: string[];
}
```

## Supervisor

Core loop that owns process lifecycle. Runner-agnostic.

```typescript
interface SupervisorOptions {
  spec: ProcessSpec;
  stateDir: string;
  runner?: Runner;
  fs?: LauncherFileSystem;
  signal?: AbortSignal;
  onStatusChange?: (state: ProcessState) => void;
  onLog?: (line: string, stream: "stdout" | "stderr") => void;
}

interface Supervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getState(): ProcessState;
}

function createSupervisor(options: SupervisorOptions): Supervisor;
```

Supervisor behaviour:
- Calls `runner.exec(...)` to start the process
- Pipes stdout/stderr to log files and optional `onLog` callback
- On process exit: applies restart policy with exponential backoff
- Backoff: `min(backoffMs * 2^restartCount, maxBackoffMs)`
- Resets restart count after process has been running for 60s (stable)
- Stops retrying after `maxRestarts` consecutive failures
- Writes state to `stateDir/{id}/state.json` on every status change

## State store

Reads and writes process state to disk. One directory per managed process.

```typescript
interface StateStore {
  read(id: string): Promise<ProcessState | null>;
  write(id: string, state: ProcessState): Promise<void>;
  list(): Promise<ProcessState[]>;
  remove(id: string): Promise<void>;
}
```

## Log writer

```typescript
interface LogWriter {
  write(line: string, stream: "stdout" | "stderr"): Promise<void>;
  rotate(): Promise<void>;
  tail(stream: "stdout" | "stderr", lines?: number): Promise<string[]>;
  close(): void;
}
```
