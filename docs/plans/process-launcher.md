# Process Launcher

Lightweight cross-platform process supervisor for poe-code.
Start, monitor, restart, and stop long-running dev tools (e.g. `openclaw`) from the CLI.
Supports both native (host) and Docker runtimes via a `ProcessRuntime` abstraction.

## Package: `packages/process-launcher`

New package. No external dependencies beyond Node builtins — uses `node:child_process` directly (consistent with `agent-spawn`).

### File structure

```
packages/process-launcher/
  src/
    types.ts
    index.ts
    runtime/
      runtime.ts              # ProcessRuntime interface
      host-runtime.ts         # native child_process implementation
      host-runtime.test.ts
      docker-runtime.ts       # Docker implementation
      docker-runtime.test.ts
    supervisor/
      supervisor.ts
      supervisor.test.ts
    state/
      state-store.ts
      state-store.test.ts
    logs/
      log-writer.ts
      log-writer.test.ts
    health/
      health-check.ts
      health-check.test.ts
    testing/
      index.ts
      simulation.ts
      simulation.test.ts
```

## Runtime abstraction

The supervisor never spawns processes directly. It delegates to a `ProcessRuntime`,
which hides whether the process runs on the host or inside a container.

This aligns with the `ProcessLauncher` seam in the `spawn-docker-runtime-package` plan —
same architectural idea, applied to long-running supervised processes.

```typescript
/** Opaque handle to a running process, returned by the runtime. */
interface ManagedProcess {
  readonly pid: number | null;         // null when runtime doesn't expose PIDs (e.g. Docker)
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  /** Resolves when the process exits. */
  readonly exitPromise: Promise<{ exitCode: number }>;
  /** Attempt graceful shutdown. */
  kill(signal?: NodeJS.Signals): void;
}

interface ProcessRuntime {
  /** Start a process according to the spec. */
  start(spec: ProcessSpec): Promise<ManagedProcess>;
  /** Force-kill a previously started process (cleanup). */
  forceKill(handle: ManagedProcess): Promise<void>;
  /** Runtime identifier for display/logging. */
  readonly name: string;
}
```

### Host runtime

Default. Thin wrapper around `node:child_process.spawn()`.

```typescript
function createHostRuntime(): ProcessRuntime;
```

- Spawns with `detached: true` on Unix for process-group cleanup
- `kill()` sends signal to process group (`-pid`) on Unix, direct kill on Windows
- `forceKill()` sends SIGKILL, falls back to `taskkill /pid /t /f` on Windows

### Docker runtime

Runs the process inside a Docker container.

```typescript
interface DockerRuntimeOptions {
  image: string;                       // required, e.g. "node:22-slim"
  engine?: "docker" | "podman";        // auto-detected if omitted
  context?: string;                    // e.g. "colima"
  mounts?: DockerMount[];
  ports?: DockerPortMapping[];
  network?: string;
  extraArgs?: string[];                // passthrough to docker run
}

interface DockerMount {
  source: string;                      // host path
  target: string;                      // container path
  readonly?: boolean;
}

interface DockerPortMapping {
  host: number;
  container: number;
  protocol?: "tcp" | "udp";
}

function createDockerRuntime(options: DockerRuntimeOptions): ProcessRuntime;
```

Implementation:
- `start()` runs `docker run -d --name <id>` with the spec's command/args/env/cwd
- Attaches to stdout/stderr via `docker logs -f <name>` in a sidecar child process
- `pid` is `null` (Docker manages the PID namespace)
- `kill()` runs `docker stop <name>` (sends SIGTERM inside container, default 10s timeout)
- `forceKill()` runs `docker kill <name>`
- `exitPromise` resolves when `docker wait <name>` completes, parses exit code
- Container is removed on stop (`--rm` flag or explicit `docker rm`)

Engine detection reuses the pattern from `e2e-docker-test-runner`:
- Check `docker` availability, then `podman`
- Support `--context` for colima users

### Runtime selection in ProcessSpec

```typescript
interface ProcessSpec {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  restart: RestartPolicy;
  maxRestarts?: number;                // default: 5, 0 = unlimited
  backoffMs?: number;                  // initial backoff, default: 1000
  maxBackoffMs?: number;               // cap, default: 30000
  readyCheck?: ReadyCheck;
  logRetainCount?: number;             // number of log files to keep, default: 5
  docker?: DockerRuntimeOptions;       // if present, use Docker runtime
}

type RestartPolicy = "never" | "on-failure" | "always";
```

When `spec.docker` is set, the supervisor creates a Docker runtime.
Otherwise it uses the host runtime. The supervisor code is identical either way.

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
  | { kind: "log-pattern"; pattern: string }   // substring match on stdout/stderr
  | { kind: "tcp"; port: number; host?: string; timeoutMs?: number };
```

For Docker runtime with TCP checks: probes the _host_ port (from `ports` mapping).

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
  lastStartedAt: string | null;        // ISO timestamp
  lastStoppedAt: string | null;
  command: string;
  args: string[];
}
```

## Supervisor

Core loop that owns process lifecycle. Runtime-agnostic.

```typescript
interface SupervisorOptions {
  spec: ProcessSpec;
  stateDir: string;                    // e.g. ~/.poe-code/launcher/
  runtime?: ProcessRuntime;            // injected for testing; defaults based on spec.docker
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
- Calls `runtime.start(spec)` to get a `ManagedProcess`
- Pipes stdout/stderr to log files and optional `onLog` callback
- On process exit: applies restart policy with exponential backoff
- Backoff: `min(backoffMs * 2^restartCount, maxBackoffMs)`
- Resets restart count after process has been running for 60s (stable)
- Stops retrying after `maxRestarts` consecutive failures
- On `stop()`: calls `handle.kill()`, waits 5s, then `runtime.forceKill(handle)`
- Writes state to `stateDir/{id}/state.json` on every status change

### State store

Reads/writes process state to disk. One directory per managed process.

```
~/.poe-code/launcher/
  openclaw/
    state.json       # ProcessState
    logs/
      stdout.log     # current run
      stderr.log
      stdout.1.log   # previous run (rotated)
      stderr.1.log
```

```typescript
interface StateStore {
  read(id: string): Promise<ProcessState | null>;
  write(id: string, state: ProcessState): Promise<void>;
  list(): Promise<ProcessState[]>;
  remove(id: string): Promise<void>;
}

function createStateStore(stateDir: string, fs?: LauncherFileSystem): StateStore;
```

### Log writer

Handles log rotation and tailing.

```typescript
interface LogWriter {
  write(line: string, stream: "stdout" | "stderr"): Promise<void>;
  rotate(): Promise<void>;           // called on process restart
  tail(stream: "stdout" | "stderr", lines?: number): Promise<string[]>;
  close(): void;
}

function createLogWriter(
  logDir: string,
  retainCount: number,
  fs?: LauncherFileSystem
): LogWriter;
```

### Health check

Implements ready-check evaluation.

```typescript
function waitForReady(
  check: ReadyCheck,
  options: {
    signal?: AbortSignal;
    onLog?: (line: string, stream: "stdout" | "stderr") => void;
    timeoutMs?: number;   // default: 30000
  }
): Promise<boolean>;
```

- `log-pattern`: subscribes to `onLog` and resolves when pattern found
- `tcp`: polls `net.connect()` until success or timeout

## CLI

```text
poe-code launch start <id> -- <command> [args...]
  --restart <policy>         never | on-failure | always (default: on-failure)
  --max-restarts <n>         max consecutive restarts (default: 5)
  --ready-pattern <string>   log substring to wait for before reporting "running"
  --ready-port <port>        TCP port to probe for readiness
  --cwd <dir>                working directory for the process
  --env KEY=VALUE            environment variable (repeatable)

  Docker options (presence of --image triggers Docker runtime):
  --image <image>            Docker image, e.g. "node:22-slim"
  --mount <src:target[:ro]>  bind mount (repeatable)
  --port <host:container>    port mapping (repeatable)
  --network <name>           Docker network
  --engine <docker|podman>   container engine (auto-detected)

poe-code launch stop <id>
  --force                    SIGKILL / docker kill immediately

poe-code launch restart <id>

poe-code launch status
  lists all managed processes as a table:
  ID         RUNTIME   STATUS     PID    RESTARTS   UPTIME       LAST EXIT
  openclaw   docker    running    —      0          2h 15m       —
  myserver   host      crashed    —      5          —            1 (SIGTERM)

poe-code launch logs <id>
  --follow                   tail -f style
  --lines <n>                number of lines (default: 50)
  --stderr                   show stderr instead of stdout

poe-code launch rm <id>
  removes state, logs, and container (if Docker) for a stopped process
```

### Interactive mode

`poe-code launch start` without `--` prompts for:
1. Process ID
2. Command to run
3. Runtime (host / docker) — if docker, prompts for image
4. Restart policy

With `--yes`, uses defaults (runtime: host, restart: on-failure).

## SDK

Expose the same capabilities programmatically:

```typescript
import { createSupervisor, createStateStore } from "poe-code";

// Host runtime (default)
const hostSupervisor = createSupervisor({
  spec: {
    id: "myserver",
    command: "node",
    args: ["server.js"],
    restart: "on-failure",
    readyCheck: { kind: "tcp", port: 3000 },
  },
  stateDir: "~/.poe-code/launcher/",
});

// Docker runtime
const dockerSupervisor = createSupervisor({
  spec: {
    id: "openclaw",
    command: "openclaw",
    args: ["serve"],
    restart: "on-failure",
    readyCheck: { kind: "tcp", port: 8080 },
    docker: {
      image: "openclaw:latest",
      ports: [{ host: 8080, container: 8080 }],
      mounts: [{ source: "./data", target: "/app/data" }],
    },
  },
  stateDir: "~/.poe-code/launcher/",
});

await dockerSupervisor.start();
```

## Cross-platform considerations

### Host runtime
- Use `node:child_process.spawn()` directly
- SIGTERM on Unix, `child.kill()` on Windows (Node handles translation)
- Process group cleanup: `process.kill(-pid)` on Unix via `detached: true`
- Windows fallback: `taskkill /pid /t /f`
- Paths: use `node:path` consistently

### Docker runtime
- Engine auto-detection: `docker` then `podman`
- Context support for colima (reuses `e2e-docker-test-runner` pattern)
- Container naming: `poe-launch-<id>` to avoid collisions
- Logs via `docker logs -f` sidecar — no PTY assumptions
- Port mappings must be explicit (no automatic host port allocation)
- Mounts use absolute paths, resolved via `node:path.resolve()` before passing to Docker

## Testing

Simulation harness with memfs + mock runtime (same pattern as ralph/experiment-loop).

### Mock runtime

```typescript
interface MockProcessBehavior {
  pid: number | null;
  exitCode: number;
  exitAfterMs: number;
  stdout?: string[];
  stderr?: string[];
}

function createMockRuntime(behaviors: MockProcessBehavior[]): ProcessRuntime;
```

The mock runtime returns pre-programmed `ManagedProcess` handles.
Same mock works for testing both host and Docker code paths — the supervisor doesn't care.

### Key test scenarios

**Supervisor (runtime-agnostic):**
1. Start process — state transitions to "running"
2. Process exits 0 with `restart: never` — stays "stopped"
3. Process exits 1 with `restart: on-failure` — restarts with backoff
4. Process exits 0 with `restart: always` — restarts
5. Max restarts exceeded — transitions to "crashed", stops retrying
6. Backoff timing — exponential with cap
7. Stable reset — restart count resets after 60s uptime
8. Stop — calls kill(), waits, then forceKill()
9. Force stop — calls forceKill() immediately
10. Ready check (log pattern) — status only becomes "running" after match
11. Ready check (TCP) — polls until port responds
12. Log rotation — old logs rotated on restart, capped at retainCount
13. State persistence — state.json survives process restarts
14. State listing — list() returns all managed processes
15. Abort signal — supervisor shuts down cleanly

**Host runtime:**
16. Spawns child_process with correct args/env/cwd
17. Sends SIGTERM on kill
18. Sends SIGKILL on forceKill

**Docker runtime:**
19. Builds correct `docker run` args from DockerRuntimeOptions
20. Attaches log sidecar via `docker logs -f`
21. `kill()` runs `docker stop`
22. `forceKill()` runs `docker kill`
23. Exit code parsed from `docker wait`
24. Container removed on stop
25. Engine auto-detection (docker vs podman)

## Example: OpenClaw

OpenClaw is a self-hosted AI assistant platform. Its core is a gateway process
(`openclaw gateway`) — a WebSocket control plane that manages sessions, channels,
agents, and device nodes. It needs to be installed, configured, and kept running.

### Provider definition

OpenClaw is a provider like any other (`claude-code`, `opencode`, `kimi`).
It uses the existing `ServiceInstallDefinition` for installation and
`createProvider()` manifest for configuration. The only new piece is a
`process` block that tells the launcher what to supervise.

```typescript
// src/providers/openclaw.ts
import { createBinaryExistsCheck } from "../utils/command-checks.js";
import { configMutation, fileMutation } from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
import { openClawAgent } from "@poe-code/agent-defs";
import type { ServiceInstallDefinition } from "../services/service-install.js";

export const OPENCLAW_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "openclaw",
  summary: "OpenClaw",
  check: createBinaryExistsCheck(
    "openclaw",
    "openclaw-binary",
    "OpenClaw binary must exist"
  ),
  steps: [
    {
      id: "install-openclaw-unix",
      command: "bash",
      args: ["-c", "curl -fsSL https://get.openclaw.dev | sh"],
      platforms: ["darwin", "linux"],
    },
  ],
  successMessage: "Installed OpenClaw.",
};

export const openClawService = createProvider({
  ...openClawAgent,
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.openclaw" }),
      configMutation.merge({
        target: "~/.openclaw/openclaw.json",
        value: (ctx) => {
          const { apiKey, model } = ctx as { apiKey?: string; model?: string };
          return {
            gateway: { mode: "local", port: 18789 },
            models: {
              providers: {
                poe: {
                  baseUrl: "${POE_BASE_URL}",
                  apiKey: apiKey ?? "",
                  api: "openai-completions",
                  models: [{ id: model ?? "gpt-4o", contextWindow: 128000 }],
                },
              },
            },
          };
        },
      }),
    ],
    unconfigure: [
      configMutation.prune({
        target: "~/.openclaw/openclaw.json",
        shape: { models: { providers: { poe: true } } },
      }),
    ],
  },
  install: OPENCLAW_INSTALL_DEFINITION,
  // NEW: declares a long-running process for the launcher
  process: {
    command: "openclaw",
    args: ["gateway", "--port", "18789"],
    restart: "on-failure",
    maxRestarts: 5,
    readyCheck: { kind: "tcp", port: 18789 },
  },
});
```

The key insight: **no new setup/install mechanism**. The existing `install()` and
`configure()` from `ProviderService` handle everything. The only addition is the
`process` field on `CreateProviderOptions` — a `ProcessSpec` that the launcher picks up.

### CLI flow

`poe-code launch start` leverages the existing provider operations:

```text
# First time: install → configure → start process
poe-code launch start openclaw
  → poe-code install openclaw        # existing install command
  → poe-code configure openclaw      # existing configure command
  → starting openclaw... ready on :18789

# Already installed and configured — just starts
poe-code launch start openclaw
  → OpenClaw already installed.
  → OpenClaw already configured.
  → starting openclaw... ready on :18789

# Lifecycle (no install/configure needed)
poe-code launch stop openclaw
poe-code launch restart openclaw

# Status
poe-code launch status
  ID         RUNTIME   STATUS     PID     RESTARTS   UPTIME       LAST EXIT
  openclaw   host      running    48291   0          2h 15m       —

# Logs
poe-code launch logs openclaw --follow

# Update binary (just re-runs existing install)
poe-code install openclaw
```

### SDK usage

```typescript
import { createSupervisor } from "poe-code";

const openclaw = createSupervisor({
  spec: {
    id: "openclaw",
    command: "openclaw",
    args: ["gateway", "--port", "18789"],
    restart: "on-failure",
    readyCheck: { kind: "tcp", port: 18789 },
  },
  stateDir: "~/.poe-code/launcher/",
  onStatusChange(state) {
    console.log(`openclaw: ${state.status}`);
  },
});

await openclaw.start();
// OpenClaw is healthy and accepting connections on :18789

await openclaw.stop();
```

### Docker variant

Same provider, containerized — only the spec changes:

```typescript
const openclaw = createSupervisor({
  spec: {
    id: "openclaw",
    command: "openclaw",
    args: ["gateway", "--port", "18789"],
    restart: "on-failure",
    readyCheck: { kind: "tcp", port: 18789 },
    docker: {
      image: "cherryhq/openclaw:latest",
      ports: [{ host: 18789, container: 18789 }],
      mounts: [
        { source: "~/.openclaw", target: "/root/.openclaw" },
      ],
    },
  },
  stateDir: "~/.poe-code/launcher/",
});
```

### Design notes

- **No parallel install/setup system.** The launcher delegates to the existing
  `ProviderService.install()` and `ProviderService.configure()`. No new types
  like `SetupStep` or `SkipCondition` — those concepts already exist as
  `ServiceInstallDefinition` with `CommandCheck` and platform-filtered `InstallCommand[]`.
- **`process` is the only new field** on `CreateProviderOptions`. Providers that
  don't need a long-running process simply omit it (claude-code, codex, etc.).
- **`poe-code launch start`** orchestrates: check install → run install if needed →
  check configure → run configure if needed → start supervised process.
- **Updates** use the existing `poe-code install openclaw` command — no separate
  update mechanism needed.

## Implementation order

1. Types + package scaffolding
2. `ProcessRuntime` interface + host runtime
3. State store (read/write/list/remove)
4. Log writer (write/rotate/tail)
5. Health check (log-pattern + TCP)
6. Supervisor (core lifecycle loop, uses mock runtime in tests)
7. Docker runtime
8. Simulation harness + integration tests
9. CLI commands (start/stop/restart/status/logs/rm)
10. SDK exports
11. Verification via screenshots
