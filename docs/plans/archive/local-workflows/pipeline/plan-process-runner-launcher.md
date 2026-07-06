---
kind: pipeline
version: 1
tasks:
  - id: pr-scaffold
    title: Scaffold process-runner package with types
    prompt: >
      Create the `packages/process-runner` package following the same patterns as
      `packages/pipeline`.


      Plan: `docs/plans/process-runner.md`


      1. Create `packages/process-runner/package.json` with:
         - name: `@poe-code/process-runner`
         - Same devDependencies pattern as `packages/pipeline/package.json`
         - No external dependencies — uses `node:child_process` and `node:net` only
      2. Create `packages/process-runner/tsconfig.json` matching pipeline's tsconfig

      3. Create `packages/process-runner/README.md` with a short description:
         "Low-level process execution abstraction. Single interface for launching processes on the host or inside Docker containers."
         Document: no external dependencies, consumed by agent-spawn, process-launcher.
      4. Create `packages/process-runner/src/types.ts` with ALL interfaces from the plan:
         - `RunHandle` — handle to a running process:
           - `readonly pid: number | null` (null for Docker — PID inside container namespace)
           - `readonly stdout: Readable | null` (null when "inherit" or "ignore")
           - `readonly stderr: Readable | null`
           - `readonly stdin: Writable | null`
           - `readonly result: Promise<RunResult>`
           - `kill(signal?: NodeJS.Signals): void`
         - `RunResult` — `{ exitCode: number }`
         - `RunSpec` — describes what to run (pure data, no behavior):
           - `command: string`
           - `args?: string[]`
           - `cwd?: string`
           - `env?: Record<string, string>`
           - `stdin?: "pipe" | "inherit" | "ignore"` (default: "ignore")
           - `stdout?: "pipe" | "inherit"` (default: "pipe")
           - `stderr?: "pipe" | "inherit"` (default: "pipe")
           - `tty?: boolean` — allocate TTY (no-op for host, adds `-t` for Docker)
           - `signal?: AbortSignal`
         - `Runner` — `{ exec(spec: RunSpec): RunHandle; readonly name: string }`
         - `HostRunnerOptions` — `{ detached?: boolean }` (default false)
         - `Engine` — `"docker" | "podman"`
         - `DockerMount` — `{ source: string; target: string; readonly?: boolean }`
         - `DockerPortMapping` — `{ host: number; container: number; protocol?: "tcp" | "udp" }`
         - `DockerRunnerOptions`:
           - `image: string`
           - `engine?: Engine` (auto-detected if omitted)
           - `context?: string` (e.g. "colima", auto-detected if omitted)
           - `mounts?: DockerMount[]`
           - `ports?: DockerPortMapping[]`
           - `network?: string`
           - `extraArgs?: string[]`
           - `containerName?: string` (auto-generated from command if omitted)
         - `DockerRunArgs` — input to the pure args builder:
           - `engine: Engine`
           - `context: string | null`
           - `image: string`
           - `command: string`
           - `args: string[]`
           - `cwd?: string`
           - `env?: Record<string, string>`
           - `mounts: DockerMount[]`
           - `ports: DockerPortMapping[]`
           - `network?: string`
           - `containerName: string`
           - `detached: boolean`
           - `interactive: boolean` (keep stdin open, -i flag)
           - `tty: boolean` (-t flag)
           - `rm: boolean`
           - `extraArgs: string[]`
         - `MockRunBehavior`:
           - `pid?: number`
           - `exitCode: number`
           - `exitAfterMs?: number` (default 0 = immediate)
           - `stdout?: string[]` (lines emitted over time)
           - `stderr?: string[]`
           - `stdoutInterval?: number` (ms between lines, default 10)
      5. Create `packages/process-runner/src/index.ts` that re-exports public API (types only for
      now, implementations will be added as modules are built)

      6. Run `npm install` to link the new package


      Reference `packages/pipeline/package.json` and `packages/pipeline/src/types.ts` for
      conventions.


      File structure to create:

      ```

      packages/process-runner/
        src/
          types.ts
          index.ts
          host/       (empty dir for now)
          docker/     (empty dir for now)
          testing/    (empty dir for now)
      ```
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pr-mock-runner
    title: Implement mock runner for testing
    prompt: >
      Implement the mock runner in `packages/process-runner/src/testing/`.


      Plan: `docs/plans/process-runner.md` (Mock runner section)


      The mock runner is needed FIRST so all subsequent implementations can be tested against it.


      Create `packages/process-runner/src/testing/mock-runner.ts` with:


      1. `createMockRunner(behaviors: MockRunBehavior[]): Runner`
         - Returns a Runner (name: "mock") that replays pre-programmed behaviors in FIFO order
         - Each call to `exec()` pops the next behavior from the array
         - Throws if no behaviors left
         - For each behavior:
           - `pid` from behavior (default null)
           - `stdout`: if behavior.stdout is set AND RunSpec.stdout is "pipe", create a Readable stream that emits lines at `stdoutInterval` ms apart (default 10ms)
           - `stderr`: same pattern with behavior.stderr
           - `stdin`: if RunSpec.stdin is "pipe", create a Writable (sink, no-op)
           - If RunSpec.stdout/stderr/stdin is "inherit" or "ignore", return null for that stream
           - `result`: Promise that resolves after `exitAfterMs` (default 0) with `{ exitCode: behavior.exitCode }`
           - `kill()`: immediately resolves the result promise

      2. `createMockRunnerByCommand(map: Record<string, MockRunBehavior>): Runner`
         - Returns a Runner (name: "mock") that matches RunSpec.command to a key in the map
         - Throws if command not found in map

      Create `packages/process-runner/src/testing/index.ts` re-exporting both functions and
      MockRunBehavior type.


      Create `packages/process-runner/src/testing/mock-runner.test.ts` with TDD tests:

      1. Replays behaviors in order — first exec gets first behavior, second gets second

      2. Emits stdout lines from behavior.stdout array

      3. Emits stderr lines from behavior.stderr array

      4. Resolves result with programmed exitCode

      5. Resolves result after exitAfterMs delay

      6. By-command matching works — exec with command "foo" gets behavior for "foo"

      7. Throws when behaviors exhausted

      8. Throws when command not found in map

      9. Inherit mode — stdout/stderr/stdin are null when RunSpec uses "inherit"

      10. kill() causes result to resolve


      Export mock runner from `packages/process-runner/src/index.ts`.

      Use `memfs` for any file operations in tests. Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pr-host-runner
    title: Implement host runner
    prompt: >
      Implement the host runner in `packages/process-runner/src/host/`.


      Plan: `docs/plans/process-runner.md` (Host runner section)


      Create `packages/process-runner/src/host/host-runner.ts` with:


      `createHostRunner(options?: HostRunnerOptions): Runner`

      - Returns a Runner with name "host"

      - `exec(spec: RunSpec)` implementation:
        - Wraps `node:child_process.spawn()`
        - Maps RunSpec fields directly to spawn options:
          - `command` → first arg to spawn
          - `args` → second arg (default [])
          - `cwd` → options.cwd
          - `env` → options.env (pass through as-is, NOT merged with process.env — let the caller decide)
          - `stdin`: "pipe" → "pipe", "inherit" → "inherit", "ignore" → "ignore" (default "ignore")
          - `stdout`: "pipe" → "pipe", "inherit" → "inherit" (default "pipe")
          - `stderr`: "pipe" → "pipe", "inherit" → "inherit" (default "pipe")
          - `tty` flag is a no-op for host runner (inherit already passes TTY through)
        - If `options.detached` is true, spawn with `detached: true`
        - Returns RunHandle:
          - `pid`: child.pid (number)
          - `stdout`: child.stdout (null when "inherit" or "ignore")
          - `stderr`: child.stderr (null when "inherit" or "ignore")
          - `stdin`: child.stdin (null when "inherit" or "ignore")
          - `result`: Promise that resolves on 'close' event with `{ exitCode: code ?? 1 }`
          - `kill(signal)`:
            - Unix with `detached: true`: `process.kill(-pid, signal)` (kills process group)
            - Otherwise: `child.kill(signal)`
        - AbortSignal handling: if `spec.signal` is provided, listen for 'abort' event and send SIGTERM

      Create `packages/process-runner/src/host/host-runner.test.ts` with TDD tests:

      1. Piped mode — spawns with stdio pipes, stdout/stderr/stdin accessible on RunHandle

      2. Inherit mode — spawns with stdio inherit, RunHandle streams are null

      3. tty flag is a no-op (doesn't change behavior for host runner)

      4. kill() sends signal to process (spawn `sleep 60`, kill, verify non-zero exit)

      5. AbortSignal sends SIGTERM (spawn `sleep 60`, abort controller, verify exit)

      6. Detached mode uses process group kill on Unix

      7. Default stdio: stdin "ignore", stdout "pipe", stderr "pipe"

      8. cwd is passed to child_process.spawn

      9. env is passed to child_process.spawn

      10. Non-zero exit code preserved (run `sh -c "exit 42"`, verify exitCode 42)


      Integration test (real process, not mocked):

      11. Spawn `echo hello` piped, capture stdout, verify "hello" in output


      Export `createHostRunner` from `packages/process-runner/src/index.ts`.

      Follow TDD — write tests first.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pr-docker-args
    title: Implement Docker args builder (pure function)
    prompt: >
      Implement the Docker args builder in `packages/process-runner/src/docker/args.ts`.


      Plan: `docs/plans/process-runner.md` (Docker args builder section)


      This is a PURE function — no side effects, no child_process calls. Just builds the argument
      array.


      Create `packages/process-runner/src/docker/args.ts` with:


      `buildDockerRunArgs(input: DockerRunArgs): string[]`


      The function builds a `docker run` (or `podman run`) argument array:


      Order of args:

      1. Engine binary name: input.engine ("docker" or "podman")

      2. Context args (docker only, not podman): `--context <context>` if context is set

      3. "run"

      4. `--rm` if input.rm is true

      5. `-d` if input.detached is true

      6. `-i` if input.interactive is true

      7. `-t` if input.tty is true

      8. `--name <containerName>`

      9. `-w <cwd>` if cwd is set

      10. `-e KEY=VALUE` for each entry in input.env

      11. `-v <source>:<target>[:ro]` for each mount (resolve source to absolute path)

      12. `-p <host>:<container>[/<protocol>]` for each port mapping (default protocol: tcp, omit
      /tcp)

      13. `--network <network>` if network is set

      14. ...input.extraArgs (passthrough)

      15. input.image

      16. input.command

      17. ...input.args


      Create `packages/process-runner/src/docker/args.test.ts` with TDD tests:

      1. Minimal spec → correct `docker run` args (engine, run, --rm, --name, image, command)

      2. With mounts → `-v` args with absolute paths, readonly adds `:ro`

      3. With ports → `-p` args (e.g. `-p 8080:3000`)

      4. With env → `-e KEY=VALUE` args for each entry

      5. With network → `--network mynet`

      6. With context → `--context colima` (docker engine only)

      7. With context + podman → context args NOT added (podman ignores context)

      8. Detached mode → `-d` flag present

      9. Interactive mode → `-i` flag present

      10. TTY mode → `-t` flag present

      11. Combined interactive + TTY → both `-i` and `-t` flags

      12. Extra args passed through in correct position (before image)

      13. cwd → `-w /some/path`

      14. Command args appended after image and command


      Follow TDD — write tests first. No filesystem access needed, pure logic.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pr-engine-context
    title: Implement engine and context detection
    prompt: >
      Implement engine and context detection in `packages/process-runner/src/docker/`.


      Plan: `docs/plans/process-runner.md` (Engine detection + Context detection sections)


      These are extracted from `packages/e2e-docker-test-runner/src/engine.ts` and

      `packages/e2e-docker-test-runner/src/context.ts`. After this package exists,

      `e2e-docker-test-runner` can later depend on `@poe-code/process-runner` and drop its copies.


      Create `packages/process-runner/src/docker/engine.ts`:

      - `detectEngine(): Engine` — checks `docker --version` first, then `podman --version`. Throws
      descriptive error if neither found.

      - `isEngineAvailable(engine: Engine): boolean` — checks if specific engine CLI is available

      - Uses `node:child_process.execSync` with `stdio: 'ignore'`


      Reference implementation: `packages/e2e-docker-test-runner/src/engine.ts`


      Create `packages/process-runner/src/docker/engine.test.ts` with tests:

      1. detectEngine returns "docker" when docker is available (mock execSync)

      2. detectEngine returns "podman" when only podman is available

      3. detectEngine throws descriptive error when neither is available

      4. isEngineAvailable returns true/false correctly


      Create `packages/process-runner/src/docker/context.ts`:

      - `detectContext(): string | null` — detects running colima Docker context by parsing `colima
      list --json` output. Returns context name ("colima" for default profile, "colima-<name>" for
      named profiles). Returns null if colima not installed or no running Docker runtime.

      - `buildContextArgs(engine: Engine, context: string | null): string[]` — returns
      `["--context", context]` for docker engine with context, empty array otherwise. Podman does
      not use context args.


      Reference implementation: `packages/e2e-docker-test-runner/src/context.ts`


      Create `packages/process-runner/src/docker/context.test.ts` with tests:

      1. detectContext returns "colima" for default running profile

      2. detectContext returns "colima-myprofile" for named profile

      3. detectContext returns null when colima not installed

      4. detectContext returns null when no running Docker runtime

      5. buildContextArgs returns ["--context", "colima"] for docker engine

      6. buildContextArgs returns [] for podman engine (podman ignores context)

      7. buildContextArgs returns [] when context is null


      Export `detectEngine`, `isEngineAvailable`, `detectContext`, `buildContextArgs` from
      `packages/process-runner/src/index.ts`.

      Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pr-docker-runner
    title: Implement Docker runner
    prompt: >
      Implement the Docker runner in `packages/process-runner/src/docker/docker-runner.ts`.


      Plan: `docs/plans/process-runner.md` (Docker runner section)


      Create `packages/process-runner/src/docker/docker-runner.ts` with:


      `createDockerRunner(options: DockerRunnerOptions): Runner`

      - Returns a Runner with name "docker"

      - On creation: auto-detect engine via `detectEngine()` if `options.engine` not provided.
      Auto-detect context via `detectContext()` if `options.context` not provided.

      - `exec(spec: RunSpec)` implementation:
        - Generate container name: `poe-run-<containerName || spec.command>-<short-random>` (6 char hex)
        - Determine mode from RunSpec:
          - **Piped** (stdout or stderr is "pipe"): foreground `docker run --rm`, child_process gives stdout/stderr streams directly
          - **Interactive** (stdin+stdout+stderr all "inherit", tty: true): `docker run -it --rm`, user's terminal connected directly. RunHandle streams are all null.
        - Build args using `buildDockerRunArgs()` with:
          - `interactive`: true when stdin is "pipe" or "inherit" (keeps stdin open via -i flag)
          - `tty`: from spec.tty
          - `rm`: true
          - `detached`: false (foreground mode for both piped and interactive)
          - mounts/ports/network/extraArgs from options
          - env from spec.env
          - cwd from spec.cwd
        - Spawn the docker CLI command via `node:child_process.spawn()`
        - Map child stdio to RunHandle:
          - Piped mode: child.stdout/stderr/stdin map to RunHandle fields
          - Interactive mode: all null (stdio is "inherit")
        - Returns RunHandle:
          - `pid`: null (PID is inside container namespace)
          - `result`: Promise resolving on child 'close' with `{ exitCode: code ?? 1 }`
          - `kill(signal)`:
            - SIGTERM → spawn `docker stop <containerName>` (graceful, 10s default)
            - SIGKILL → spawn `docker kill <containerName>`
            - Other signals → spawn `docker kill --signal=<signal> <containerName>`
        - AbortSignal handling: on abort, run `docker stop <containerName>`

      Create `packages/process-runner/src/docker/docker-runner.test.ts` with TDD tests

      (mock the underlying child_process.spawn to verify correct docker CLI calls):

      1. Piped mode — calls docker run in foreground, streams accessible

      2. Interactive mode (tty + all inherit) — calls docker run -it, streams null

      3. kill(SIGTERM) spawns `docker stop <name>`

      4. kill(SIGKILL) spawns `docker kill <name>`

      5. Exit code parsed correctly from docker process exit

      6. Container name generated correctly (poe-run-<command>-<hex>)

      7. Engine auto-detection used when not specified in options

      8. Context auto-detection used when not specified

      9. Mounts from options passed to buildDockerRunArgs

      10. Ports from options passed to buildDockerRunArgs

      11. Env from RunSpec passed to buildDockerRunArgs

      12. AbortSignal triggers docker stop


      Export `createDockerRunner` from `packages/process-runner/src/index.ts`.

      Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pr-verify
    title: Verify process-runner end-to-end
    prompt: >
      Verify the full process-runner implementation.


      Plan: `docs/plans/process-runner.md` (Manual verification section)


      1. Create `packages/process-runner/src/testing/verify.ts` with the verification script
         from the plan (see `docs/plans/process-runner.md` "Manual verification" section).
         It includes:
         - verifyHostPiped — spawn `echo hello`, capture stdout
         - verifyHostStdin — pipe stdin to `cat`, read back
         - verifyHostKill — spawn `sleep 60`, kill SIGTERM, verify non-zero exit
         - verifyHostAbort — spawn `sleep 60`, AbortController.abort(), verify non-zero exit
         - verifyHostInherit — inherit mode, verify streams are null
         - verifyHostExitCode — `sh -c "exit 42"`, verify exitCode 42
         - verifyHostEnv — pass MY_TEST_VAR env, verify in output
         - Docker tests (skip if no engine available):
           - verifyDockerPiped, verifyDockerStdin, verifyDockerKill, verifyDockerExitCode,
             verifyDockerEnv, verifyDockerMount, verifyDockerPort, verifyDockerInteractiveContract

      2. Run all unit tests: `npm test` in `packages/process-runner`

      3. Run linting: `npm run lint`

      4. Run the verification script: `npx tsx packages/process-runner/src/testing/verify.ts`

      5. Verify all host tests pass (Docker tests may be skipped if Docker unavailable)

      6. Fix any issues found


      7. Update `docs/plans/process-runner.md` — if there are any deviations from the plan, document
      them.

      8. Note in `docs/plans/process-launcher.md` that `ProcessRuntime` is superseded by `Runner`
      from `@poe-code/process-runner` (as stated in process-runner plan phase 5 step 17).
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-scaffold
    title: Scaffold process-launcher package with types
    prompt: >
      Create the `packages/process-launcher` package following the same patterns as
      `packages/pipeline`.


      Plan: `docs/plans/process-launcher.md`


      This package depends on `@poe-code/process-runner` for process execution via the `Runner`
      interface.

      The original plan's `ProcessRuntime` abstraction is superseded by `Runner` from
      `@poe-code/process-runner`

      (see `docs/plans/process-runner.md` phase 5 step 17).


      1. Create `packages/process-launcher/package.json` with:
         - name: `@poe-code/process-launcher`
         - Same devDependencies pattern as `packages/pipeline/package.json`
         - dependency: `@poe-code/process-runner` (workspace:*)
      2. Create `packages/process-launcher/tsconfig.json` matching pipeline's tsconfig

      3. Create `packages/process-launcher/README.md`:
         "Lightweight cross-platform process supervisor for poe-code.
          Start, monitor, restart, and stop long-running dev tools from the CLI.
          Supports both native (host) and Docker runtimes via `@poe-code/process-runner`."
      4. Create `packages/process-launcher/src/types.ts` with all interfaces:
         - `LauncherFileSystem` (injectable fs for testing, same pattern as experiment-loop/ralph):
           - readFile, writeFile, mkdir, rm, stat, readdir, appendFile
         - `ReadyCheck`:
           - `{ kind: "log-pattern"; pattern: string }` — substring match on stdout/stderr
           - `{ kind: "tcp"; port: number; host?: string; timeoutMs?: number }`
         - `RestartPolicy`: `"never" | "on-failure" | "always"`
         - `ProcessSpec`:
           - id: string
           - command: string
           - args?: string[]
           - cwd?: string
           - env?: Record<string, string>
           - restart: RestartPolicy
           - maxRestarts?: number (default 5, 0 = unlimited)
           - backoffMs?: number (initial, default 1000)
           - maxBackoffMs?: number (cap, default 30000)
           - readyCheck?: ReadyCheck
           - logRetainCount?: number (default 5)
           - docker?: DockerRunnerOptions (from @poe-code/process-runner; if present, use Docker runner)
         - `ProcessStatus`: `"running" | "stopped" | "crashed" | "restarting"`
         - `ProcessState`:
           - id, pid (number | null), status: ProcessStatus, runtime: "host" | "docker"
           - restartCount, lastExitCode (number | null)
           - lastStartedAt (ISO string | null), lastStoppedAt (ISO string | null)
           - command, args: string[]
         - `SupervisorOptions`:
           - spec: ProcessSpec
           - stateDir: string (e.g. ~/.poe-code/launcher/)
           - runner?: Runner (from @poe-code/process-runner — injected for testing; default based on spec.docker)
           - fs?: LauncherFileSystem
           - signal?: AbortSignal
           - onStatusChange?: (state: ProcessState) => void
           - onLog?: (line: string, stream: "stdout" | "stderr") => void
         - `Supervisor`:
           - start(): Promise<void>
           - stop(): Promise<void>
           - restart(): Promise<void>
           - getState(): ProcessState
         - `StateStore`:
           - read(id: string): Promise<ProcessState | null>
           - write(id: string, state: ProcessState): Promise<void>
           - list(): Promise<ProcessState[]>
           - remove(id: string): Promise<void>
         - `LogWriter`:
           - write(line: string, stream: "stdout" | "stderr"): Promise<void>
           - rotate(): Promise<void>
           - tail(stream: "stdout" | "stderr", lines?: number): Promise<string[]>
           - close(): void
      5. Create `packages/process-launcher/src/index.ts` re-exporting types (empty implementations
      for now)

      6. Run `npm install` to link the new package


      File structure:

      ```

      packages/process-launcher/
        src/
          types.ts
          index.ts
          supervisor/   (empty dir for now)
          state/        (empty dir for now)
          logs/         (empty dir for now)
          health/       (empty dir for now)
          testing/      (empty dir for now)
      ```
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-state-store
    title: Implement state store
    prompt: >
      Implement the state store in `packages/process-launcher/src/state/`.


      Plan: `docs/plans/process-launcher.md` (State store section)


      The state store reads/writes process state to disk. One directory per managed process.


      Directory layout:

      ```

      <stateDir>/
        <id>/
          state.json       # ProcessState
          logs/
            stdout.log     # current run
            stderr.log
            stdout.1.log   # previous run (rotated)
            stderr.1.log
      ```


      Create `packages/process-launcher/src/state/state-store.ts` with:


      `createStateStore(stateDir: string, fs?: LauncherFileSystem): StateStore`


      Implementation:

      - `read(id)`: reads `<stateDir>/<id>/state.json`, returns parsed ProcessState or null if not
      found

      - `write(id, state)`: creates `<stateDir>/<id>/` dir if needed, writes state.json as formatted
      JSON

      - `list()`: reads all subdirectories of stateDir, reads state.json from each, returns array of
      ProcessState. Skips directories without state.json.

      - `remove(id)`: removes `<stateDir>/<id>/` directory recursively


      If `fs` not provided, use `node:fs/promises` defaults.


      Create `packages/process-launcher/src/state/state-store.test.ts` with TDD tests using `memfs`:

      1. write() creates directory and state.json

      2. read() returns written state

      3. read() returns null for non-existent id

      4. list() returns all written states

      5. list() returns empty array when stateDir is empty

      6. list() skips directories without state.json

      7. remove() deletes the process directory

      8. remove() is safe to call for non-existent id

      9. write() overwrites existing state


      Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-log-writer
    title: Implement log writer with rotation
    prompt: >
      Implement the log writer in `packages/process-launcher/src/logs/`.


      Plan: `docs/plans/process-launcher.md` (Log writer section)


      Create `packages/process-launcher/src/logs/log-writer.ts` with:


      `createLogWriter(logDir: string, retainCount: number, fs?: LauncherFileSystem): LogWriter`


      Log files live in `<logDir>/`:

      - `stdout.log` — current run stdout

      - `stderr.log` — current run stderr

      - `stdout.1.log` — previous run (rotated)

      - `stderr.1.log` — previous run (rotated)

      - `stdout.2.log`, etc. up to retainCount


      Implementation:

      - `write(line, stream)`: appends line + "\n" to `<logDir>/<stream>.log`. Creates file on first
      write.

      - `rotate()`: called on process restart. Shifts existing log files:
        - Delete `<stream>.<retainCount>.log` if it exists (oldest)
        - Rename `<stream>.<N>.log` → `<stream>.<N+1>.log` for N = retainCount-1 down to 1
        - Rename `<stream>.log` → `<stream>.1.log`
        - This preserves the last `retainCount` runs of logs
      - `tail(stream, lines?)`: reads `<logDir>/<stream>.log`, returns last N lines (default 50).
      Returns empty array if file doesn't exist.

      - `close()`: no-op (no open file handles to clean up since we use appendFile)


      Create `packages/process-launcher/src/logs/log-writer.test.ts` with TDD tests using `memfs`:

      1. write() creates log file and appends line

      2. write() appends multiple lines

      3. write() handles stdout and stderr separately

      4. rotate() shifts log files (stdout.log → stdout.1.log)

      5. rotate() shifts numbered files (stdout.1.log → stdout.2.log)

      6. rotate() deletes oldest file beyond retainCount

      7. rotate() is safe when no log files exist

      8. tail() returns last N lines

      9. tail() returns empty array for non-existent file

      10. tail() defaults to 50 lines

      11. Full lifecycle: write, rotate, write more, tail reads only current run


      Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-health-check
    title: Implement health check (ready checks)
    prompt: >
      Implement the health check module in `packages/process-launcher/src/health/`.


      Plan: `docs/plans/process-launcher.md` (Health check section)


      Create `packages/process-launcher/src/health/health-check.ts` with:


      `waitForReady(check: ReadyCheck, options: { signal?: AbortSignal; onLog?: (line: string,
      stream: "stdout" | "stderr") => void; timeoutMs?: number }): Promise<boolean>`


      Implementation based on check.kind:


      **"log-pattern"**:

      - Subscribe to `options.onLog` callback

      - Wait for a log line (from either stdout or stderr) containing `check.pattern` as a substring

      - Resolve `true` when pattern found

      - Resolve `false` if timeout expires (default 30000ms) or signal aborted

      - Must clean up the subscription when done


      **"tcp"**:

      - Poll `net.connect({ port: check.port, host: check.host ?? "127.0.0.1" })` in a loop

      - Resolve `true` when connection succeeds (close connection immediately after)

      - Poll interval: 500ms

      - Resolve `false` if timeout expires (check.timeoutMs ?? 30000ms) or signal aborted

      - Must clean up any pending socket on abort/timeout


      Create `packages/process-launcher/src/health/health-check.test.ts` with TDD tests:

      1. log-pattern: resolves true when matching line arrives

      2. log-pattern: resolves false on timeout (short timeout for test)

      3. log-pattern: resolves false when signal aborted

      4. log-pattern: matches substring (not exact match)

      5. log-pattern: works with stderr lines too

      6. tcp: resolves true when port is open (start a local net.createServer in test)

      7. tcp: resolves false on timeout when port not open

      8. tcp: resolves false when signal aborted

      9. tcp: uses custom host when provided

      10. tcp: polls repeatedly until success


      Follow TDD. For TCP tests, use `node:net` to create a real local server on a random port.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-supervisor
    title: Implement supervisor core lifecycle loop
    prompt: >
      Implement the supervisor in `packages/process-launcher/src/supervisor/`.


      Plan: `docs/plans/process-launcher.md` (Supervisor section)


      The supervisor is runtime-agnostic — it uses the `Runner` interface from
      `@poe-code/process-runner`.


      Create `packages/process-launcher/src/supervisor/supervisor.ts` with:


      `createSupervisor(options: SupervisorOptions): Supervisor`


      Supervisor behavior:

      - **start()**:
        1. Determine runner: if `options.runner` provided, use it. Else if `spec.docker` is set, create `createDockerRunner(spec.docker)`. Else create `createHostRunner()`.
        2. Build a RunSpec from ProcessSpec (command, args, cwd, env, stdout: "pipe", stderr: "pipe")
        3. Call `runner.exec(runSpec)` to get a RunHandle
        4. Set state to "running" (or "restarting" if this is a restart), persist via state store
        5. Pipe stdout/stderr through log writer's `write()` and `options.onLog` callback
        6. If readyCheck is configured, call `waitForReady()` — only transition to "running" after check passes
        7. On process exit (handle.result resolves):
           a. Record lastExitCode, lastStoppedAt
           b. Apply restart policy:
              - `restart: "never"` → set status "stopped"
              - `restart: "on-failure"` + exitCode !== 0 → restart with backoff
              - `restart: "on-failure"` + exitCode === 0 → set status "stopped"
              - `restart: "always"` → restart with backoff regardless of exit code
           c. Backoff: `min(backoffMs * 2^restartCount, maxBackoffMs)` (defaults: initial 1000ms, max 30000ms)
           d. Reset restart count to 0 after process runs stably for 60 seconds
           e. Stop retrying after `maxRestarts` (default 5) consecutive failures → set status "crashed"
           f. On restart: rotate logs, increment restartCount, re-run exec
        8. Call `options.onStatusChange` on every state transition

      - **stop()**:
        1. Call `handle.kill("SIGTERM")`
        2. Wait up to 5 seconds for handle.result
        3. If not exited after 5s, call `handle.kill("SIGKILL")`
        4. Set status "stopped", persist state

      - **restart()**:
        1. Call stop()
        2. Call start()

      - **getState()**: returns current ProcessState snapshot


      - AbortSignal: if `options.signal` aborts, call stop()


      Create `packages/process-launcher/src/supervisor/supervisor.test.ts` with TDD tests

      using `createMockRunner` from `@poe-code/process-runner/testing` and `memfs`:

      1. Start process — state transitions to "running", onStatusChange called

      2. Process exits 0 with `restart: "never"` — stays "stopped"

      3. Process exits 1 with `restart: "on-failure"` — restarts with backoff

      4. Process exits 0 with `restart: "on-failure"` — stays "stopped" (success = no restart)

      5. Process exits 0 with `restart: "always"` — restarts

      6. Max restarts exceeded — transitions to "crashed", stops retrying

      7. Backoff timing — exponential with cap (verify delays: 1000, 2000, 4000, ...)

      8. Stable reset — restart count resets after 60s uptime (use fake timers)

      9. stop() — calls kill, waits, process exits

      10. restart() — stops then starts

      11. Ready check (log pattern) — status becomes "running" only after pattern found

      12. Ready check (TCP) — polls until port responds

      13. Log rotation — rotate() called on each restart

      14. State persistence — state.json written on every status change

      15. Abort signal — supervisor shuts down cleanly, status "stopped"

      16. stdout/stderr piped to log writer and onLog callback


      Export `createSupervisor` from `packages/process-launcher/src/index.ts`.

      Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-simulation
    title: Build simulation test harness and integration tests
    prompt: >
      Build a simulation harness and integration tests for process-launcher.


      Plan: `docs/plans/process-launcher.md` (Testing section)


      Create `packages/process-launcher/src/testing/simulation.ts`:

      - Simulation harness with memfs + createMockRunner from @poe-code/process-runner

      - Helper to create a full supervisor test environment:
        - In-memory filesystem (memfs)
        - Mock runner with configurable behaviors (exit codes, stdout/stderr output, exit delays)
        - State store backed by memfs
        - Log writer backed by memfs
        - Collected status change events
        - Collected log lines
      - Factory function: `createSimulation(spec: ProcessSpec, behaviors: MockRunBehavior[]):
      SimulationEnv`


      Create `packages/process-launcher/src/testing/index.ts` re-exporting harness utilities.


      Create `packages/process-launcher/src/testing/simulation.test.ts` with integration tests:

      1. Happy path — start, process runs, exits 0, status "stopped"

      2. Restart on failure — process exits 1, restarts, second run exits 0

      3. Max restarts — process crashes repeatedly, transitions to "crashed"

      4. Always restart — process exits 0, still restarts

      5. Ready check log pattern — status "running" only after pattern in logs

      6. Log capture — stdout/stderr captured in log files

      7. Log rotation on restart — previous logs shifted

      8. State persisted — read back state.json from memfs

      9. Stop during run — kill called, state "stopped"

      10. Abort signal — supervisor stops cleanly


      These are full lifecycle integration tests using the simulation harness.

      Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-cli
    title: Add process-launcher CLI commands
    prompt: |
      Add process-launcher CLI commands to poe-code.

      Plan: `docs/plans/process-launcher.md` (CLI section)

      Add subcommands under `poe-code launch`:

      `poe-code launch start <id> -- <command> [args...]`
        - `--restart <policy>` — never | on-failure | always (default: on-failure)
        - `--max-restarts <n>` — max consecutive restarts (default: 5)
        - `--ready-pattern <string>` — log substring to wait for before reporting "running"
        - `--ready-port <port>` — TCP port to probe for readiness
        - `--cwd <dir>` — working directory for the process
        - `--env KEY=VALUE` — environment variable (repeatable)
        - Docker options (presence of --image triggers Docker runtime):
          - `--image <image>` — Docker image
          - `--mount <src:target[:ro]>` — bind mount (repeatable)
          - `--port <host:container>` — port mapping (repeatable)
          - `--network <name>` — Docker network
          - `--engine <docker|podman>` — container engine (auto-detected)

      `poe-code launch stop <id>`
        - `--force` — SIGKILL / docker kill immediately

      `poe-code launch restart <id>`

      `poe-code launch status`
        - Lists all managed processes as a table:
          ID, RUNTIME, STATUS, PID, RESTARTS, UPTIME, LAST EXIT

      `poe-code launch logs <id>`
        - `--follow` — tail -f style
        - `--lines <n>` — number of lines (default: 50)
        - `--stderr` — show stderr instead of stdout

      `poe-code launch rm <id>`
        - Removes state, logs, and container (if Docker) for a stopped process

      Interactive mode: `poe-code launch start` without `--` prompts for:
      1. Process ID
      2. Command to run
      3. Runtime (host / docker) — if docker, prompts for image
      4. Restart policy
      With `--yes`, uses defaults (runtime: host, restart: on-failure).

      Use `commander` for arg parsing. Follow the same CLI patterns as existing commands.
      Keep parity with SDK — expose the same options programmatically.
      Use the design_system for interactive prompts and table output.

      Take screenshots of each command's help:
      - `npm run screenshot-poe-code -- launch --help`
      - `npm run screenshot-poe-code -- launch start --help`
      - `npm run screenshot-poe-code -- launch status --help`
      - `npm run screenshot-poe-code -- launch logs --help`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-sdk
    title: Expose process-launcher SDK
    prompt: |
      Expose the process-launcher capabilities programmatically via the SDK.

      Plan: `docs/plans/process-launcher.md` (SDK section)

      Ensure the following are exported from `packages/process-launcher/src/index.ts`
      and available to consumers:

      ```typescript
      export { createSupervisor } from "./supervisor/supervisor.js";
      export { createStateStore } from "./state/state-store.js";
      export { createLogWriter } from "./logs/log-writer.js";
      export { waitForReady } from "./health/health-check.js";
      export type {
        ProcessSpec, ProcessState, ProcessStatus, RestartPolicy,
        ReadyCheck, SupervisorOptions, Supervisor, StateStore,
        LogWriter, LauncherFileSystem
      } from "./types.js";
      ```

      Verify SDK usage works by writing a small inline test:
      ```typescript
      import { createSupervisor, createStateStore } from "@poe-code/process-launcher";
      ```

      Also ensure the SDK is accessible from the main `poe-code` package if that's the pattern
      used by other packages (check how experiment-loop and pipeline are exposed).

      The SDK should support:
      - Host runtime (default when spec.docker is absent)
      - Docker runtime (when spec.docker is present)
      - Custom runner injection (for testing)
      - All supervisor options (restart policy, ready checks, logging callbacks)

      Keep parity with CLI — every CLI option should be configurable via SDK.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: pl-verify
    title: Verify process-launcher end-to-end
    prompt: >
      Verify the full process-launcher implementation works end to end.


      1. Run all unit tests: `npm test` in `packages/process-launcher`

      2. Run all unit tests across workspace: `npm test` — no regressions

      3. Run linting: `npm run lint`

      4. Verify CLI commands register correctly:
         - `npm run dev -- launch --help` shows all subcommands
         - `npm run dev -- launch start --help` shows all options
         - `npm run dev -- launch status --help`
         - `npm run dev -- launch logs --help`
      5. Take screenshots:
         - `npm run screenshot-poe-code -- launch --help`
         - `npm run screenshot-poe-code -- launch start --help`
         - `npm run screenshot-poe-code -- launch status --help`
      6. Manual integration test (host runtime):
         - Start a simple process: `npm run dev -- launch start test-echo -- sh -c "echo ready && sleep 30" --ready-pattern ready`
         - Check status: `npm run dev -- launch status`
         - Check logs: `npm run dev -- launch logs test-echo`
         - Stop: `npm run dev -- launch stop test-echo`
         - Remove: `npm run dev -- launch rm test-echo`
      7. Fix any issues found

      8. Verify both plans are still accurate: `docs/plans/process-runner.md` and
      `docs/plans/process-launcher.md`


      Do NOT test Docker runtime unless Docker is confirmed available.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# process runner launcher

Archived local pipeline plan converted from YAML during docs cleanup.
