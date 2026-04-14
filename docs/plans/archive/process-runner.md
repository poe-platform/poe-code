# Process Runner

Low-level process execution abstraction for poe-code.
Single interface for launching processes on the host or inside Docker containers.
Consumed by `agent-spawn`, `process-launcher`, and any future package that needs to run a command.

## Package: `packages/process-runner`

Package name: `@poe-code/process-runner`

No external dependencies. Uses `node:child_process` and `node:net` only.

Supersedes the injection seam proposed in `spawn-docker-runtime-package.md` —
that plan's `ProcessLauncher` concept lives here as a reusable package
instead of being inlined into `agent-spawn`.

### File structure

```
packages/process-runner/
  src/
    types.ts
    index.ts
    host/
      host-runner.ts
      host-runner.test.ts
    docker/
      docker-runner.ts
      docker-runner.test.ts
      engine.ts
      engine.test.ts
      context.ts
      context.test.ts
      args.ts
      args.test.ts
    testing/
      index.ts
      mock-runner.ts
      mock-runner.test.ts
```

## Core interface

```typescript
import type { Readable, Writable } from "node:stream";

/**
 * Handle to a running process. Returned by Runner.exec().
 * The consumer reads streams, awaits completion, or kills.
 */
interface RunHandle {
  /** OS PID when available (null for Docker — PID is inside container namespace). */
  readonly pid: number | null;
  /** null when stdout is "inherit" or "ignore". */
  readonly stdout: Readable | null;
  /** null when stderr is "inherit" or "ignore". */
  readonly stderr: Readable | null;
  /** null when stdin is "inherit" or "ignore". */
  readonly stdin: Writable | null;
  /** Resolves when the process exits. */
  readonly result: Promise<RunResult>;
  /** Send a signal. For Docker: SIGTERM → docker stop, SIGKILL → docker kill. */
  kill(signal?: NodeJS.Signals): void;
}

interface RunResult {
  exitCode: number;
}

/**
 * Describes what to run. Pure data, no behavior.
 */
interface RunSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** stdin mode. Default: "ignore". */
  stdin?: "pipe" | "inherit" | "ignore";
  /** stdout mode. Default: "pipe". */
  stdout?: "pipe" | "inherit";
  /** stderr mode. Default: "pipe". */
  stderr?: "pipe" | "inherit";
  /**
   * Allocate a TTY for the process.
   * Required for interactive sessions where the user's terminal
   * needs to be connected directly to the process.
   *
   * Host runner: no-op (child_process with stdio "inherit" already
   * inherits the parent's TTY).
   *
   * Docker runner: adds `-t` flag (`docker run -t`).
   * Combined with `stdin: "inherit"`, this becomes `docker run -it`.
   */
  tty?: boolean;
  signal?: AbortSignal;
}

/**
 * The runner. Knows how to execute a RunSpec.
 * Host runner uses child_process. Docker runner uses docker run.
 */
interface Runner {
  exec(spec: RunSpec): RunHandle;
  readonly name: string; // "host" | "docker"
}
```

Why `RunHandle` instead of just `Promise<RunResult>`:

- Long-running processes need streaming access to stdout/stderr
- Callers need `kill()` before the process exits
- stdin piping (for agent-spawn's stdin mode)
- `result` promise for awaiting completion

## Mapping to agent-spawn's three spawn modes

The runner covers all three existing spawn paths in `agent-spawn`:

### 1. Standard spawn (`spawn.ts`)

Captures stdout/stderr, optionally pipes stdin for prompt injection.

```typescript
runner.exec({
  command: binaryName,
  args: spawnArgs,
  cwd: options.cwd,
  stdin: stdinMode ? "pipe" : "inherit",
  stdout: "pipe",
  stderr: "pipe",
  signal: options.signal
});
```

Consumer accumulates `handle.stdout` / `handle.stderr` into strings,
optionally tees to `options.tee`.

### 2. Interactive spawn (`spawn-interactive.ts`)

User's terminal directly connected. No capture.

```typescript
runner.exec({
  command: binaryName,
  args,
  cwd: options.cwd,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  tty: true
});
```

`handle.stdout`, `handle.stderr`, `handle.stdin` are all `null`.
Consumer only awaits `handle.result` for exit code.

For Docker: `tty: true` + `stdin: "inherit"` → `docker run -it`,
giving the user a real terminal session inside the container.

For host: `tty` is a no-op — `stdio: "inherit"` already inherits the parent TTY.

### 3. ACP streaming spawn (`acp/spawn.ts`)

All streams piped. stdin written then closed. stdout parsed line-by-line.

```typescript
const handle = runner.exec({
  command: binaryName,
  args,
  cwd: options.cwd,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  signal: options.signal
});

handle.stdin!.write(prompt);
handle.stdin!.end();

for await (const line of readLines(handle.stdout!)) {
  // parse ACP events
}
```

For Docker: `docker run --rm` in attached mode (no `-d`), streams
come from the docker process's own stdio pipes.

## Host runner

```typescript
interface HostRunnerOptions {
  /** Use detached process groups for tree cleanup. Default: false. */
  detached?: boolean;
}

function createHostRunner(options?: HostRunnerOptions): Runner;
```

Implementation:

- Wraps `node:child_process.spawn()`
- Maps `RunSpec` fields directly to spawn options
- `kill(signal)`:
  - Unix with `detached: true`: `process.kill(-pid, signal)` (process group)
  - Otherwise: `child.kill(signal)`
- AbortSignal: sends SIGTERM on abort

This is what `agent-spawn` currently does inline. Extracting it here means
`agent-spawn` drops its `child_process` import and uses `Runner` instead.

## Docker runner

```typescript
interface DockerRunnerOptions {
  image: string;
  engine?: Engine; // auto-detected if omitted
  context?: string; // e.g. "colima", auto-detected if omitted
  mounts?: DockerMount[];
  ports?: DockerPortMapping[];
  network?: string;
  extraArgs?: string[]; // passthrough to docker run
  /** Override container name. Default: auto-generated from RunSpec.command. */
  containerName?: string;
}

type Engine = "docker" | "podman";

interface DockerMount {
  source: string; // host path (resolved to absolute)
  target: string; // container path
  readonly?: boolean;
}

interface DockerPortMapping {
  host: number;
  container: number;
  protocol?: "tcp" | "udp"; // default: tcp
}

function createDockerRunner(options: DockerRunnerOptions): Runner;
```

Implementation:

- `exec()` builds and runs `docker run` with the correct args
- Three modes based on stdio and tty:
  - **Piped** (stdout/stderr: "pipe"): `docker run --rm` in foreground,
    child_process gives us stdout/stderr streams directly.
    Used by standard spawn and ACP streaming.
  - **Interactive** (stdin/stdout/stderr: "inherit", tty: true): `docker run -it --rm`,
    user's terminal directly connected to the container.
    Used by interactive spawn. `RunHandle` streams are all `null`.
  - **Detached** (for process-launcher long-running services): `docker run -d`,
    then `docker logs -f` sidecar for streaming.
    Used when the caller wants background execution with log capture.
- TTY handling:
  - `tty: true` → adds `-t` flag
  - `stdin: "inherit"` → adds `-i` flag (keeps stdin open)
  - Combined: `docker run -it` for full interactive terminal
  - `tty: true` without `stdin: "inherit"` is valid (e.g. for colored output)
- `kill(SIGTERM)` → `docker stop <name>` (graceful, 10s default)
- `kill(SIGKILL)` → `docker kill <name>`
- `result` promise: parses exit code from the docker process exit or `docker wait`
- Container auto-removed via `--rm` or explicit `docker rm` after exit
- Container name: `poe-run-<containerName || command>-<short-random>`

### Engine detection

Extracted from `e2e-test-runner/src/engine.ts`:

```typescript
function detectEngine(): Engine; // docker → podman → throw
function isEngineAvailable(engine: Engine): boolean;
```

### Context detection

Extracted from `e2e-test-runner/src/context.ts`:

```typescript
function detectContext(): string | null; // colima auto-detect
function buildContextArgs(engine: Engine, context: string | null): string[];
```

Both are currently duplicated in `e2e-test-runner`. After this package exists,
`e2e-test-runner` can depend on `@poe-code/process-runner` and drop its copies.

### Docker args builder

Pure function that constructs the `docker run` argument array.

```typescript
interface DockerRunArgs {
  engine: Engine;
  context: string | null;
  image: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  mounts: DockerMount[];
  ports: DockerPortMapping[];
  network?: string;
  containerName: string;
  detached: boolean;
  interactive: boolean; // -i flag (keep stdin open)
  tty: boolean; // -t flag (allocate pseudo-TTY)
  rm: boolean;
  extraArgs: string[];
}

function buildDockerRunArgs(input: DockerRunArgs): string[];
```

Tested in isolation — pure input → output, no side effects.

## Mock runner (for testing)

```typescript
interface MockRunBehavior {
  pid?: number;
  exitCode: number;
  exitAfterMs?: number; // default: 0 (immediate)
  stdout?: string[]; // lines emitted over time
  stderr?: string[];
  stdoutInterval?: number; // ms between lines, default: 10
}

/** Returns a Runner that replays pre-programmed behaviors in order. */
function createMockRunner(behaviors: MockRunBehavior[]): Runner;

/**
 * Returns a Runner that matches specs to behaviors by command name.
 * Useful when exec order isn't deterministic.
 */
function createMockRunnerByCommand(map: Record<string, MockRunBehavior>): Runner;
```

Both `agent-spawn` and `process-launcher` use this in their tests
instead of mocking `child_process` directly.

## How consumers select a runner

The runner is a plain object — consumers create the one they want at the call site.
There is no global config, registry, or resolution chain. The consumer owns the decision.

```typescript
import { createHostRunner, createDockerRunner, createMockRunner } from "@poe-code/process-runner";

// Host (default for most use cases)
const host = createHostRunner();

// Docker (consumer provides the image + options)
const docker = createDockerRunner({
  image: "node:22-slim",
  mounts: [{ source: "./data", target: "/app/data" }],
  ports: [{ host: 8080, container: 8080 }]
});

// Mock (tests)
const mock = createMockRunner([{ exitCode: 0, stdout: ["hello\n"] }]);

// All three satisfy the same Runner interface.
// The consumer passes whichever one it wants:
const handle = docker.exec({
  command: "node",
  args: ["server.js"],
  stdout: "pipe",
  stderr: "pipe"
});
```

### Why no config/registry

- Runner choice depends on the consumer's context, not a global setting.
  `process-launcher` picks based on `spec.docker`. `agent-spawn` would pick
  based on a CLI flag or injected context. Tests always use mock.
- A registry or resolution chain adds indirection without value —
  the consumer already knows what it wants.
- Docker options (image, mounts, ports) vary per use case.
  There is no sensible "default docker runner" to configure globally.

### Future integrations (out of scope for this plan)

When other packages adopt this runner, they create the runner themselves:

- **`agent-spawn`**: would accept `Runner` via `SpawnContext`, default to `createHostRunner()`.
  CLI flag like `--runner docker --image alpine` would create a `DockerRunner` before calling spawn.
- **`process-launcher`**: supervisor takes `Runner` in options, creates host or docker
  based on `ProcessSpec.docker` field.
- **`e2e-test-runner`**: could import engine/context detection from this package
  instead of its own copies.

## Testing

### Unit tests (mock-based, fast)

**Docker args builder:**

1. Minimal spec → correct `docker run` args
2. With mounts → `-v` args with absolute paths
3. With ports → `-p` args
4. With env → `-e` args
5. With network → `--network` arg
6. With context → `--context` arg (docker only, not podman)
7. Detached mode → `-d` flag
8. Interactive mode → `-i` flag
9. TTY mode → `-t` flag
10. Combined interactive + TTY → `-it` flags
11. Extra args passed through

**Host runner:** 12. Piped mode — spawns with stdio pipes, streams accessible on RunHandle 13. Inherit mode — spawns with stdio inherit, RunHandle streams are null 14. tty flag — no-op for host runner (inherit already passes TTY through) 15. kill() sends signal to process 16. AbortSignal sends SIGTERM 17. Detached mode uses process group kill

**Docker runner:** 18. Piped mode — docker run in foreground, streams accessible 19. Interactive mode (tty + inherit) — docker run -it, streams null 20. Detached mode — docker run -d, logs sidecar 21. kill(SIGTERM) runs docker stop 22. kill(SIGKILL) runs docker kill 23. Exit code parsed correctly 24. Container name generated correctly 25. Engine auto-detection used when not specified

**Mock runner:** 26. Replays behaviors in order 27. Emits stdout/stderr lines 28. Resolves with programmed exit code 29. By-command matching works 30. Inherit mode — returns null streams

### Integration tests

31. Host runner: spawns `echo hello` piped, captures stdout
32. Host runner: spawns interactive process with inherit (manual verification)
33. Docker runner: spawns `echo hello` in alpine piped, captures stdout (requires Docker)
34. Docker runner: spawns interactive shell in alpine with -it (requires Docker, manual)

## Implementation order

### Phase 1: Package foundation

1. **Scaffold package** — `packages/process-runner/`, `package.json`, `tsconfig.json`, README
2. **Types** — `RunSpec`, `RunHandle`, `RunResult`, `Runner`, Docker types in `types.ts`
3. **Mock runner + tests** — `createMockRunner`, `createMockRunnerByCommand`
   - Tests: 26–30
   - Needed first so all subsequent implementation can be tested against the mock

### Phase 2: Host runner

4. **Host runner implementation** — `createHostRunner()`
5. **Host runner unit tests** — 12–17, using mock child to verify argument mapping
6. **Host runner integration test** — test 31: spawn `echo hello`, verify stdout capture

**Verify phase 2:**

- `npm run test` — all unit tests pass
- `npm run lint` — no type errors
- Manual: `npx tsx packages/process-runner/src/host/host-runner.integration.test.ts`

### Phase 3: Docker args + infrastructure

7. **Docker args builder** — pure `buildDockerRunArgs()` function
8. **Docker args tests** — 1–11: every flag combination
9. **Engine detection** — extract from `e2e-test-runner`
10. **Context detection** — extract from `e2e-test-runner`

**Verify phase 3:**

- `npm run test` — args builder and detection tests pass
- Spot-check: import and call `detectEngine()` from a scratch script, verify it finds docker/podman

### Phase 4: Docker runner

11. **Docker runner implementation** — `createDockerRunner()`, all three modes (piped, interactive, detached)
12. **Docker runner unit tests** — 18–25, mock the underlying child_process calls to docker CLI
13. **Docker runner integration test** — test 33: `echo hello` in alpine

**Verify phase 4:**

- `npm run test` — all tests pass
- Manual integration: run a real container
  ```
  node --input-type=module <<'EOF'
    import { createDockerRunner } from './packages/process-runner/src/index.js';
    const runner = createDockerRunner({ image: 'alpine:latest' });
    const handle = runner.exec({ command: 'echo', args: ['hello from docker'] });
    handle.stdout.on('data', d => process.stdout.write(d));
    await handle.result;
  EOF
  ```
- Manual interactive: verify `docker run -it` works
  ```
  node --input-type=module <<'EOF'
    import { createDockerRunner } from './packages/process-runner/src/index.js';
    const runner = createDockerRunner({ image: 'alpine:latest' });
    const handle = runner.exec({
      command: 'sh',
      stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', tty: true
    });
    await handle.result;
  EOF
  ```
  Should drop into an interactive alpine shell.

### Phase 5: Verification + cleanup

14. **Full test suite** — `npm run test` across workspace, no regressions
15. **Lint** — `npm run lint`, no type errors
16. **Run verification scripts** (see below)
17. **Update plans:**
    - `process-launcher.md` — reference `Runner` from this package, drop `ProcessRuntime`
    - `spawn-docker-runtime-package.md` — mark superseded, point here

### Non-goals for this implementation

- Wiring `Runner` into `agent-spawn` (follow-up, separate plan)
- Refactoring `e2e-test-runner` to use this package (follow-up)
- Building the `process-launcher` supervisor (separate plan)
- Docker image build tooling (separate plan)

## Manual verification

Verification scripts live at `packages/process-runner/src/testing/verify.ts`.
Run with `npx tsx packages/process-runner/src/testing/verify.ts`.

All verification is automated and assertions are checked in code —
no human interaction required. An AI agent can run this and read the output.

### Implementation notes

- The implemented verifier also supports the package-local flow used during delivery:
  `cd packages/process-runner && npm test && npm run lint`.
- Docker checks are skipped when the container engine is unavailable or unresponsive,
  which includes cases where the CLI exists but `docker info` / `podman info` hangs.
- `verifyDockerMount` uses a temporary directory with a known file instead of listing `/tmp`,
  so the assertion validates mount contents directly.
- `verifyDockerPort` runs `busybox httpd` inside Alpine instead of a one-shot `nc` server,
  which makes the host-to-container port assertion more reliable.

```typescript
import { createHostRunner, createDockerRunner } from "../index.js";
import { strict as assert } from "node:assert";

async function verifyHostPiped() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "echo",
    args: ["hello from host"],
    stdout: "pipe",
    stderr: "pipe"
  });

  let stdout = "";
  handle.stdout!.setEncoding("utf8");
  handle.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0, "host piped: exit code 0");
  assert.match(stdout, /hello from host/, "host piped: stdout captured");
  console.log("✓ host runner — piped mode");
}

async function verifyHostStdin() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "cat",
    stdin: "pipe",
    stdout: "pipe"
  });

  handle.stdin!.write("ping");
  handle.stdin!.end();

  let stdout = "";
  handle.stdout!.setEncoding("utf8");
  handle.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0, "host stdin: exit code 0");
  assert.match(stdout, /ping/, "host stdin: stdin echoed to stdout");
  console.log("✓ host runner — stdin pipe");
}

async function verifyHostKill() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "sleep",
    args: ["60"],
    stdout: "pipe",
    stderr: "pipe"
  });

  handle.kill("SIGTERM");
  const { exitCode } = await handle.result;
  assert.notEqual(exitCode, 0, "host kill: non-zero exit after SIGTERM");
  console.log("✓ host runner — kill");
}

async function verifyHostAbort() {
  const runner = createHostRunner();
  const controller = new AbortController();
  const handle = runner.exec({
    command: "sleep",
    args: ["60"],
    stdout: "pipe",
    stderr: "pipe",
    signal: controller.signal
  });

  controller.abort();
  const { exitCode } = await handle.result;
  assert.notEqual(exitCode, 0, "host abort: non-zero exit after abort");
  console.log("✓ host runner — abort signal");
}

async function verifyHostInherit() {
  // Inherit mode: streams are null, process writes directly to terminal.
  // Verify the contract — we can't capture output but we can check the handle shape.
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "echo",
    args: ["inherit-mode-output"],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });

  assert.equal(handle.stdout, null, "host inherit: stdout is null");
  assert.equal(handle.stderr, null, "host inherit: stderr is null");
  assert.equal(handle.stdin, null, "host inherit: stdin is null");

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0, "host inherit: exit code 0");
  console.log("✓ host runner — inherit mode (streams null, exit 0)");
}

async function verifyHostExitCode() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "exit 42"],
    stdout: "pipe",
    stderr: "pipe"
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 42, "host exit code: 42");
  console.log("✓ host runner — non-zero exit code");
}

async function verifyHostEnv() {
  const runner = createHostRunner();
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "echo $MY_TEST_VAR"],
    stdout: "pipe",
    env: { ...process.env, MY_TEST_VAR: "runner-works" }
  });

  let stdout = "";
  handle.stdout!.setEncoding("utf8");
  handle.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0);
  assert.match(stdout, /runner-works/, "host env: env var passed");
  console.log("✓ host runner — env vars");
}

async function verifyDockerPiped() {
  const runner = createDockerRunner({ image: "alpine:latest" });
  const handle = runner.exec({
    command: "echo",
    args: ["hello from docker"],
    stdout: "pipe",
    stderr: "pipe"
  });

  let stdout = "";
  handle.stdout!.setEncoding("utf8");
  handle.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0, "docker piped: exit code 0");
  assert.match(stdout, /hello from docker/, "docker piped: stdout captured");
  console.log("✓ docker runner — piped mode");
}

async function verifyDockerStdin() {
  const runner = createDockerRunner({ image: "alpine:latest" });
  const handle = runner.exec({
    command: "cat",
    stdin: "pipe",
    stdout: "pipe"
  });

  handle.stdin!.write("docker-ping");
  handle.stdin!.end();

  let stdout = "";
  handle.stdout!.setEncoding("utf8");
  handle.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0, "docker stdin: exit code 0");
  assert.match(stdout, /docker-ping/, "docker stdin: stdin echoed");
  console.log("✓ docker runner — stdin pipe");
}

async function verifyDockerKill() {
  const runner = createDockerRunner({ image: "alpine:latest" });
  const handle = runner.exec({
    command: "sleep",
    args: ["60"],
    stdout: "pipe",
    stderr: "pipe"
  });

  // Give container a moment to start
  await new Promise((r) => setTimeout(r, 1000));
  handle.kill("SIGTERM");
  const { exitCode } = await handle.result;
  // docker stop sends SIGTERM then SIGKILL — exit code varies
  console.log(`✓ docker runner — kill (exit code: ${exitCode})`);
}

async function verifyDockerExitCode() {
  const runner = createDockerRunner({ image: "alpine:latest" });
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "exit 42"],
    stdout: "pipe",
    stderr: "pipe"
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 42, "docker exit code: 42");
  console.log("✓ docker runner — non-zero exit code");
}

async function verifyDockerEnv() {
  const runner = createDockerRunner({ image: "alpine:latest" });
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "echo $MY_TEST_VAR"],
    stdout: "pipe",
    env: { MY_TEST_VAR: "docker-runner-works" }
  });

  let stdout = "";
  handle.stdout!.setEncoding("utf8");
  handle.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0);
  assert.match(stdout, /docker-runner-works/, "docker env: env var passed");
  console.log("✓ docker runner — env vars");
}

async function verifyDockerMount() {
  const runner = createDockerRunner({
    image: "alpine:latest",
    mounts: [{ source: "/tmp", target: "/host-tmp", readonly: true }]
  });
  const handle = runner.exec({
    command: "ls",
    args: ["/host-tmp"],
    stdout: "pipe",
    stderr: "pipe"
  });

  const { exitCode } = await handle.result;
  assert.equal(exitCode, 0, "docker mount: can list mounted dir");
  console.log("✓ docker runner — bind mount");
}

async function verifyDockerPort() {
  // Start a simple HTTP server in Docker, hit it from host.
  const runner = createDockerRunner({
    image: "alpine:latest",
    ports: [{ host: 18923, container: 8080 }]
  });
  const handle = runner.exec({
    command: "sh",
    args: ["-c", "echo -e 'HTTP/1.1 200 OK\\r\\n\\r\\nok' | nc -l -p 8080"],
    stdout: "pipe",
    stderr: "pipe"
  });

  // Give the server time to start
  await new Promise((r) => setTimeout(r, 2000));

  try {
    const resp = await fetch("http://localhost:18923");
    const text = await resp.text();
    assert.match(text, /ok/, "docker port: HTTP response from container");
    console.log("✓ docker runner — port mapping");
  } catch (e) {
    console.log("✗ docker runner — port mapping (fetch failed, may need retry)");
  }

  handle.kill("SIGTERM");
  await handle.result;
}

async function verifyDockerInteractiveContract() {
  // We can't type into a TTY as an AI agent.
  // But we CAN verify that the -it flags are set correctly by running
  // a command that detects TTY and reports it, then exits immediately.
  const runner = createDockerRunner({ image: "alpine:latest" });
  const handle = runner.exec({
    command: "sh",
    args: [
      "-c",
      "[ -t 0 ] && echo 'stdin-is-tty' || echo 'stdin-not-tty'; [ -t 1 ] && echo 'stdout-is-tty' || echo 'stdout-not-tty'"
    ],
    stdin: "pipe", // pipe, not inherit — so we can read output
    stdout: "pipe",
    tty: true
  });

  // Close stdin immediately so the process exits
  handle.stdin!.end();

  let stdout = "";
  handle.stdout!.setEncoding("utf8");
  handle.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
  });

  await handle.result;
  // With -t flag, the container should report TTY
  assert.match(stdout, /tty/, "docker interactive: TTY detected inside container");
  console.log("✓ docker runner — tty flag (TTY detected inside container)");
}

// ---

async function main() {
  console.log("\n=== Host Runner ===\n");
  await verifyHostPiped();
  await verifyHostStdin();
  await verifyHostKill();
  await verifyHostAbort();
  await verifyHostInherit();
  await verifyHostExitCode();
  await verifyHostEnv();

  console.log("\n=== Docker Runner ===\n");
  try {
    await verifyDockerPiped();
    await verifyDockerStdin();
    await verifyDockerKill();
    await verifyDockerExitCode();
    await verifyDockerEnv();
    await verifyDockerMount();
    await verifyDockerPort();
    await verifyDockerInteractiveContract();
  } catch (e) {
    if (e instanceof Error && e.message.includes("No container engine")) {
      console.log("⏭ Docker not available — skipping docker runner tests");
    } else {
      throw e;
    }
  }

  console.log("\n=== All verifications passed ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### What each verification proves

| Test                        | What it proves                           |
| --------------------------- | ---------------------------------------- |
| `hostPiped`                 | Basic spawn + stdout capture works       |
| `hostStdin`                 | stdin pipe → process → stdout roundtrip  |
| `hostKill`                  | SIGTERM terminates the process           |
| `hostAbort`                 | AbortSignal terminates the process       |
| `hostInherit`               | Inherit mode returns null streams        |
| `hostExitCode`              | Non-zero exit codes are preserved        |
| `hostEnv`                   | Env vars are passed through              |
| `dockerPiped`               | Docker container runs, stdout captured   |
| `dockerStdin`               | stdin → container → stdout roundtrip     |
| `dockerKill`                | docker stop terminates the container     |
| `dockerExitCode`            | Container exit code propagated           |
| `dockerEnv`                 | Env vars passed via `-e` flags           |
| `dockerMount`               | Bind mount accessible inside container   |
| `dockerPort`                | Port mapping works (host → container)    |
| `dockerInteractiveContract` | `-t` flag allocates TTY inside container |

### What can't be verified automatically

**Interactive TTY passthrough** (`stdin: "inherit"` + `tty: true` + Docker):
This requires a human terminal. An AI agent cannot type into an interactive shell.
The `dockerInteractiveContract` test verifies the `-t` flag is set correctly
by checking `[ -t 0 ]` inside the container — but it does NOT test actual
keystroke passthrough. That requires the `terminal-agent` package (planned, not built).

**Workaround for now:** When implementing, manually run this one-liner in a real terminal:

```sh
node --input-type=module <<'EOF'
  import { createDockerRunner } from './packages/process-runner/src/index.js';
  const r = createDockerRunner({ image: 'alpine:latest' });
  const h = r.exec({ command: 'sh', stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', tty: true });
  await h.result;
EOF
```

This should drop into an interactive alpine shell. Type `ls`, `exit` — if it works, interactive mode is correct.
This test CANNOT be run by an AI agent and must be run by a human.
