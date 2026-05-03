---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: config-runtime-scope
    title: Add runtime config scope to poe-code-config
    prompt: |
      In packages/poe-code-config, add `src/runtime.ts` defining a discriminated
      union `RuntimeConfig = HostRuntime | DockerRuntime | E2bRuntime` keyed by
      `type: "host" | "docker" | "e2b"`. Shared fields: `build_args`, `mounts`
      (`{ source, target, readonly? }[]`), `link`. DockerRuntime adds `image?`,
      `dockerfile?`, `build_context?`, `engine?`, `network?`, `extra_args?`.
      E2bRuntime adds `template_id?`, `dockerfile?`, `build_context?`, `cpu?`,
      `memory_mb?`, `timeout_minutes?`, `preserve_after_exit_hours?`
      (default 24, range 0-168 — keeps the sandbox alive after job exit so
      morning sync still finds it), `api_key_env?` (default "E2B_API_KEY").

      Export `parseRuntime(raw: unknown): RuntimeConfig` and
      `resolveRuntime({ cwd, config }): RuntimeResolveResult` where
      RuntimeResolveResult = `{ runtime, runner, dockerfilePath, buildContext }`.
      `dockerfile` defaults to `<cwd>/.poe-code/Dockerfile`; `build_context`
      defaults to `cwd`. Hard-error if `type` is `docker`/`e2b` and neither
      `image`/`template_id` nor a Dockerfile at the resolved path exists.

      Wire the new scope into `src/types.ts` (`ResolvedConfig.runtime`),
      `src/merge.ts` (replace-by-field for scalars; concat for `mounts`,
      global prepended), and `src/schema.ts`. Re-export from `src/index.ts`.

      No regex parsing — deep-merge per the project rule.
    status:
      implement: done
      test: done
      commit: done

  - id: config-runner-scope
    title: Add runner scope (per-invocation behavior) to poe-code-config
    prompt: |
      In packages/poe-code-config/src/runtime.ts (or a sibling `runner.ts`),
      define `RunnerScope = { detach: boolean; upload_max_file_mb: number;
      download_conflict: "refuse" | "overwrite"; workspace?: { exclude?: string[] } }`.
      Defaults: detach=false, upload_max_file_mb=100, download_conflict="refuse",
      workspace.exclude=[".git", "node_modules", "dist", ".turbo", ".next",
      ".poe-code/state.json"].

      `workspace.exclude` and `mounts` are concatenative on merge (global
      prepended to project). Add `RunnerScope` to `ResolvedConfig.runner`,
      schema, and exports.

      Tests: parsing valid/invalid inputs; merge concat semantics; default
      application when scope absent.
    status:
      implement: done
      test: done
      commit: done

  - id: config-state-manager
    title: Add StateManager (templates + jobs) to poe-code-config
    prompt: |
      Create packages/poe-code-config/src/state/index.ts exporting
      `loadStateManager(homeDir?: string): Promise<StateManager>` where
      StateManager exposes `templates: TemplateRegistry` and `jobs: JobRegistry`.

      In src/state/templates.ts:
        - Backing file: `<homeDir>/.poe-code/state/templates.json`
        - Shape: `{ docker: { [hash]: TemplateEntry }, e2b: { [hash]: TemplateEntry } }`
        - TemplateEntry: `{ hash, template_id?, image?, runtime_type, dockerfile_path, built_at }`
        - Methods: `get(backend, hash)`, `put(backend, entry)`, `remove`, `list(backend?)`
        - File-locked using @poe-code/file-lock around read-modify-write.

      In src/state/jobs.ts:
        - One JSON file per job at `<homeDir>/.poe-code/state/jobs/<job_id>.json`
        - JobEntry: `{ id, env_id, env_kind, tool, argv, cwd, started_at,
          status: "pending"|"running"|"exited"|"killed"|"lost", exit_code?,
          exited_at?, log_file? }`
        - Atomic writes via tmp file + rename.
        - Methods: `get`, `put`, `update(id, patch)`, `list(filter?)`, `remove`.

      Tests with memfs (per CLAUDE.md): concurrent put/update preserves
      invariants under file-lock; partial-write recovery; list filtering.
      No real fs writes in unit tests except snapshots.
    status:
      implement: done
      test: done
      commit: done

  - id: harness-execution-env-contract
    title: Define ExecutionEnv contract in agent-harness-tools
    prompt: |
      In packages/agent-harness-tools, add `src/execution-env.ts` with:

      ```ts
      export interface ExecutionEnvFactory {
        readonly type: "host" | "docker" | "e2b";
        open(spec: OpenSpec): Promise<OpenedEnv>;
        attach(envId: string): Promise<OpenedEnv>;
      }

      export interface OpenSpec {
        cwd: string;
        runtime: RuntimeConfig;
        env: Record<string, string>;
        uploadIgnoreFiles: string[];
        jobLabel: { tool: string; argv: string[] };
      }

      export interface OpenedEnv {
        readonly id: string;
        readonly job: JobHandle | null;
        uploadWorkspace(): Promise<UploadResult>;
        downloadWorkspace(opts: { conflictPolicy: "refuse" | "overwrite" }): Promise<DownloadResult>;
        exec(spec: RunSpec): RunHandle;
        detach(): Promise<JobHandle>;
        shell(): RunHandle;
        close(): Promise<void>;
      }

      export interface JobHandle {
        readonly id: string;
        readonly envId: string;
        readonly tool: string;
        readonly argv: string[];
        status(): Promise<JobStatus>;
        stream(opts?: { sinceByte?: number }): AsyncIterable<LogChunk>;
        wait(): Promise<{ exitCode: number }>;
        kill(signal?: NodeJS.Signals): Promise<void>;
      }
      ```

      RunSpec/RunHandle come from @poe-code/process-runner. Add a registry:
      `registerExecutionEnvFactory(f)` and `selectExecutionEnv(runtime)` that
      picks a factory by `runtime.type`. No factory implementations yet.

      Re-export everything from src/index.ts. The test verifies registry
      lookup, missing-factory error, and that `selectExecutionEnv` is the
      only branch on `runtime.type` — add a grep-style snapshot test if
      practical.

      No SDK deps in this package.
    status:
      implement: done
      test: done
      commit: open

  - id: harness-workspace-transfer
    title: Implement workspace upload/download in agent-harness-tools
    prompt: |
      In packages/agent-harness-tools, add `src/workspace-transfer.ts`
      exporting `uploadWorkspace(env, opts)` and `downloadWorkspace(env, opts)`.

      Upload:
        - Walk `cwd`. Apply `.gitignore` then `.poe-code-ignore` (additive,
          never un-ignores). Apply `runner.workspace.exclude`.
        - Skip files >`upload_max_file_mb` (default 100). Print one warning per skip.
        - Stream as a tar to `env.uploadDir`-equivalent path.
        - Return `UploadResult { files, bytes, skipped: { path, bytes, reason }[] }`.

      Download:
        - Mirror remote /workspace back. Hash each local file at upload time,
          stash hashes on the in-memory `OpenedEnv` handle.
        - On download, re-hash local; if changed AND differs from remote,
          treat as conflict.
        - `conflictPolicy: "refuse"` → return `DownloadResult.conflicts[]`,
          do not write the affected files.
        - `conflictPolicy: "overwrite"` → clobber.

      Use memfs for tests (per CLAUDE.md). Cover: gitignore precedence,
      additive poe-code-ignore, oversize skip, conflict refuse-and-list,
      overwrite path. No real fs.
    status:
      implement: open
      test: open
      commit: open

  - id: harness-log-stream
    title: Tee-to-file log stream and offset-aware tail
    prompt: |
      In packages/agent-harness-tools, add `src/log-stream.ts` with:

        export function wrapForLogTee(argv: string[], jobId: string): string[];
        export function streamLogFile(env, jobId, opts: { sinceByte?: number }): AsyncIterable<LogChunk>;

      `wrapForLogTee` returns shell argv that runs the inner command with
      stdout+stderr teed to `/tmp/poe-jobs/<jobId>.log` and writes the exit
      code to `/tmp/poe-jobs/<jobId>.exit` after the process exits. Form:
      `["sh", "-c", "mkdir -p /tmp/poe-jobs && (<argv...>) 2>&1 | tee /tmp/poe-jobs/<id>.log; echo $? > /tmp/poe-jobs/<id>.exit"]`.

      `streamLogFile` reads from `sinceByte` (default 0), then tails. On
      backends without filesystem-watch, fall back to polling at 250ms.

      Add a `waitForExit(env, jobId): Promise<{ exitCode }>` that polls for
      the `.exit` file and parses its contents.

      Unit tests with memfs: replay from offset 0; replay from arbitrary
      offset; wait resolves with exit code; argv wrapping is shell-safe
      (escape jobId).
    status:
      implement: open
      test: open
      commit: open

  - id: harness-run-poe-command
    title: Implement runPoeCommand orchestrator
    prompt: |
      In packages/agent-harness-tools, add `src/run-poe-command.ts` exporting:

        export async function runPoeCommand(opts: {
          factory: ExecutionEnvFactory;
          openSpec: OpenSpec;
          detach: boolean;
          state: StateManager;
          signal?: AbortSignal;
        }): Promise<
          | { kind: "sync"; exitCode: number; download: DownloadResult }
          | { kind: "detached"; jobId: string; envId: string }
        >;

      Lifecycle:
        1. Generate job_id (ULID). Write JobEntry with status="pending"
           via `state.jobs.put`.
        2. `env = await factory.open(openSpec)`.
        3. `await env.uploadWorkspace()`.
        4. Wrap argv via `wrapForLogTee(argv, jobId)`. Call `env.exec(...)`
           to get RunHandle.
        5. Update job status="running", env_id, started_at.
        6. Sync mode: pipe RunHandle stdout/stderr to process; await
           `waitForExit`; download workspace per `runner.download_conflict`;
           env.close(); update status="exited", exit_code.
        7. Detach mode: skip stream + wait + download + close. Return
           { jobId, envId }. On signal abort during sync, kill, sync, close.

      Tests with a mock factory + memfs StateManager: pending→running→exited
      transition; detach leaves env open; download conflict surfaces in
      result; abort signal kills cleanly. No SDK or child_process.
    status:
      implement: open
      test: open
      commit: open

  - id: process-runner-host-factory
    title: Add hostExecutionEnvFactory in process-runner
    prompt: |
      In packages/process-runner, add `src/host/host-execution-env.ts`
      exporting `hostExecutionEnvFactory: ExecutionEnvFactory` (type: "host").

      `open(spec)`: returns an OpenedEnv whose:
        - `id` is "host"
        - `uploadWorkspace`/`downloadWorkspace`/`close` are no-ops
        - `exec(spec)` calls `createHostRunner().exec(spec)` (existing API)
        - `shell()` runs the user's $SHELL with tty:true via host runner
        - `detach()` rejects: host has no addressable env

      `attach(id)` rejects with a clear error: "host runtime does not
      support reattach".

      Re-export from src/index.ts. Tests: round-trip exec through the host
      runner; uploads are no-ops; attach throws.

      Do not import @poe-code/agent-harness-tools to avoid a cycle —
      duplicate the contract types or move them into a shared types-only
      package if needed. The harness-tools registry imports the factory
      via dynamic registration at app startup.
    status:
      implement: open
      test: open
      commit: open

  - id: migrate-agent-spawn
    title: Migrate agent-spawn off child_process to runPoeCommand
    prompt: |
      In packages/agent-spawn, replace `spawnChildProcess` calls in
      `src/spawn.ts` and `src/spawn-interactive.ts` with the
      runPoeCommand path:

        1. Resolve runtime via `resolveRuntime({ cwd, config })`.
        2. `factory = selectExecutionEnv(runtime)`.
        3. `runPoeCommand({ factory, openSpec: {...}, detach, state, signal })`.

      For interactive spawn, route through `OpenedEnv.shell()` for tty.

      Behavior MUST be bit-for-bit identical when `runtime.type === "host"`.
      All existing tests in this package must pass without modification.

      Remove the direct `import { spawn } from "node:child_process"` at the
      top of src/spawn.ts. Remove src/run-command.ts only if it's no longer
      called.

      Wire the host factory at startup: a small `register-factories.ts`
      that calls `registerExecutionEnvFactory(hostExecutionEnvFactory)` —
      imported once from the spawn entrypoint and from each tool entry.
    status:
      implement: open
      test: open
      commit: open

  - id: migrate-loop-tools
    title: Migrate experiment-loop, ralph, superintendent to runPoeCommand
    prompt: |
      Apply the same migration as agent-spawn to:
        - packages/experiment-loop/src/run/loop.ts
        - packages/ralph/src/runtime/* (all files that currently spawn)
        - packages/superintendent/src/runtime/run-builder.ts,
          run-superintendent.ts, run-inspector.ts, run-owner-review.ts

      Each tool's existing inner-agent invocation (which today calls
      `node:child_process` or @poe-code/agent-spawn directly) routes
      through `runPoeCommand` with the resolved factory. For `runtime.type
      === "host"` behavior must be unchanged; existing tests must pass.

      No `if (runtime.type === ...)` outside `selectExecutionEnv`. Verify
      with a grep test.

      Each tool's entrypoint imports the `register-factories` module so the
      host factory is registered before any `selectExecutionEnv` call.
    status:
      implement: open
      test: open
      commit: open

  - id: cli-universal-flags
    title: Add universal --runtime/--detach/--mount-poe-code flags to all four task
      commands
    prompt: |
      Wire `--runtime host|docker|e2b`, `--runtime-image <ref>`,
      `--runtime-template <id>`, `--detach`, `--mount-poe-code` on:
        - poe-code spawn
        - poe-code experiment
        - poe-code ralph
        - poe-code superintendent

      Source of truth: each command's option definitions. Mirror the same
      flags into the SDK exports (per CLAUDE.md "CLI vs SDK" rule).

      Flag semantics: each overrides the matching field on the resolved
      runtime/runner config. Without the flag, config wins; with it, the
      flag wins. `--detach` is a boolean toggle.

      Surface help text via the design system (no chalk, no @clack/prompts
      direct usage).

      Snapshot-test the `--help` output of each command (per
      docs/SNAPSHOT_TESTING.md). Take a screenshot of `poe-code spawn --help`
      via `npm run screenshot-poe-code -- spawn --help` to verify visually.
    status:
      implement: open
      test: open
      commit: open

  - id: docker-factory-and-build
    title: Add dockerExecutionEnvFactory with content-addressed image build
    prompt: |
      In packages/process-runner, add `src/docker/docker-execution-env.ts`
      exporting `dockerExecutionEnvFactory: ExecutionEnvFactory` (type: "docker").

      `open(spec)`:
        - If `runtime.image` set, pull/use directly.
        - Else compute hash = sha256(dockerfile_bytes + sorted(build_args)).
          Look up in `state.templates.get("docker", hash)`. Hit → use cached
          image tag. Miss → `docker build --tag poe-code/local:<hash>` against
          the resolved `build_context`, write entry, use new image.
        - Run container with mounts from `runtime.mounts`.
      `uploadWorkspace`/`downloadWorkspace` use `docker cp` of a tarball.
      `attach(envId)` reconnects to a container by id.
      `engine` field selects docker vs podman; default auto-detect via
      existing `detectEngine()`.

      Register this factory alongside host. Integration test gated on local
      docker availability (skip if `docker info` fails). Unit test with
      mocked Runner.

      For the dockerfile build path, the build is done by spawning the
      docker CLI through the host runner — no docker SDK dep.
    status:
      implement: open
      test: open
      commit: open

  - id: cli-runtime-init-build-templates
    title: Add poe-code runtime init/build/templates commands
    prompt: |
      Create packages/poe-code/src/commands/runtime/index.ts that registers
      the `runtime` namespace, then:

      `runtime/init.ts` — `poe-code runtime init [--type host|docker|e2b]
      [--no-dockerfile] [--yes]`. Idempotent: if .poe-code/Dockerfile and
      .poe-code/config.json exist, update only `runtime.type` (deep-merge).
      With `--yes` accept defaults; otherwise prompt via design system.
      Default Dockerfile content: node:22-bookworm-slim + git +
      `npm i -g @poe-code/cli @anthropic-ai/claude-code`.

      `runtime/build.ts` — `poe-code runtime build [--force]`. Resolves
      runtime; if e2b, calls `e2bExecutionEnvFactory`'s template build path
      via a small exposed helper. If docker, calls the docker factory's
      build helper. Writes the result to `state.templates`. With `--force`
      ignores cache.

      `runtime/templates/ls.ts` — list cached entries grouped by backend.
      Use the design-system table component.

      `runtime/templates/clear.ts` — drop all entries (with `--yes`) or
      prompt for confirmation. Only clears local-built entries; pinned
      `image`/`template_id` references in config are not touched.

      Snapshot/screenshot tests for ls + clear output.
    status:
      implement: open
      test: open
      commit: open

  - id: runner-e2b-package
    title: Create runner-e2b package implementing e2bExecutionEnvFactory
    prompt: |
      Create new package packages/runner-e2b with:

        package.json — name @poe-code/runner-e2b; declares `e2b` SDK as a
        runtime dependency (NOT @modelcontextprotocol/sdk; that rule is
        unrelated but we follow the same "SDK only where used" discipline).
        README.md listing env vars (E2B_API_KEY) and config options
        (runtime.api_key_env, cpu, memory_mb, timeout_minutes).
        tsconfig.json matching sibling packages.

      src/index.ts — `export const e2bExecutionEnvFactory: ExecutionEnvFactory`.

      src/sdk.ts — the only file that imports the e2b SDK. Exports thin
      typed wrappers: `createSandbox(opts)`, `connectSandbox(id)`,
      `buildTemplate(opts)`, `listSandboxes()`. Lints fail elsewhere if
      anyone else imports the SDK.

      src/template-build.ts — `buildOrResolveTemplate({ runtime, dockerfilePath,
      buildContext, state }): Promise<{ templateId: string; cached: boolean }>`.
      Hash inputs, look up in state.templates.get("e2b", hash); on miss
      call sdk.buildTemplate, write entry, return.

      src/factory.ts — open() resolves API key from
      `auth.providers.e2b` (or runtime.api_key_env), resolves template
      (template_id direct, else buildOrResolveTemplate), creates sandbox,
      returns OpenedEnv. attach(envId) connects to existing sandbox.

      src/opened-env.ts — implements OpenedEnv. uploadWorkspace uses sdk
      filesystem write of a tar; downloadWorkspace tars + reads. exec
      forwards to sdk command run. shell uses tty:true. detach() registers
      the running job in state and returns JobHandle. close() closes sandbox.

      src/job-handle.ts — implements JobHandle. status() consults
      sdk.commands.get + the .exit marker file. stream() uses sdk file watch
      on `/tmp/poe-jobs/<id>.log` via streamLogFile. wait() polls .exit.
      kill() sends signal via sdk.

      Keep-alive after exit: when JobHandle.wait() resolves, the wrapper
      script extends the sandbox timeout via the e2b SDK to
      `runtime.preserve_after_exit_hours` (default 24). This is critical
      for the overnight workflow — agent finishes at 2am, sandbox sits
      alive until morning sync. Released on `sync --close` or `stop`.
      Add `preserve_after_exit_hours` to the E2bRuntime config in
      poe-code-config (default 24, range 0-168). The wrapper script in
      log-stream.ts gets a final line: after writing the `.exit` file,
      call a small "extend timeout" helper exec from inside the sandbox
      that talks to the e2b API; or simpler — the host-side runPoeCommand
      issues the extend call when wait() resolves in detach mode.

      Unit tests: mock sdk.ts. Integration test gated on E2B_API_KEY:
      build minimal template, open, exec echo, download, close. Skipped
      from default `npm test`; runs in a dedicated workflow.

      Register the factory in the same `register-factories` module as host
      and docker.
    status:
      implement: open
      test: open
      commit: open

  - id: cli-runtime-jobs
    title: Add poe-code runtime jobs ls/attach/logs/stop/sandbox commands
    prompt: |
      In packages/poe-code/src/commands/runtime/jobs/:

      `ls.ts` — list state.jobs entries. Reconcile each `running` entry by
      calling `factory.attach(env_id).status()` and downgrading missing
      sandboxes to `lost`. Render via the design-system table:
      JOB | TOOL | RUNTIME | STATUS | STARTED | SANDBOX.

      Single-job ergonomics: every command below accepts `<jobId>` as
      optional. When omitted, resolve to "the only detached job that
      matches the command's intent" (running for attach/logs; running or
      exited for sync/stop). On ambiguity, error and list candidates.
      This optimizes for the common overnight workflow (one job at a
      time).

      `attach.ts [jobId]` — load entry; `factory.attach(env_id)`; replay
      via JobHandle.stream({ sinceByte: 0 }) by default, or `--since 5m`
      to seek by mtime. Ctrl-C detaches the local stream but does NOT
      kill the job. Print `detaching (job continues running)`. With no
      jobId, picks the latest running job.

      `logs.ts [jobId] [--since <duration>]` — non-interactive dump. With
      no jobId, picks the latest running or exited job.

      `stop.ts [jobId] [--sync] [--force-sync]` — JobHandle.kill('SIGTERM');
      30s grace; SIGKILL. With `--sync` download workspace per
      conflict policy ("refuse" by default). `--force-sync` overrides
      to "overwrite". Update state to "killed" + exit_code 130.

      `sync.ts [jobId] [--force-sync] [--close]` — the primitive pull.
      For a running job: snapshot download, sandbox stays alive.
      For an exited job: final download. With `--close`, also close the
      sandbox after the pull. Conflict policy honored; `--force-sync`
      overrides "refuse" → "overwrite". `stop --sync` and
      `attach --sync-on-exit` are sugar over this primitive — implement
      both by composing `sync.ts`.

      `sandbox.ts <envId>` — `factory.attach(envId).shell()`; pipe local
      stdin/stdout with tty. Ctrl-D closes the shell but leaves the
      sandbox running.

      Add `--detach` plumbing through the four task commands so they call
      runPoeCommand with detach=true and print
      `job started: <jobId>\nsandbox: <envId>\ndetached.`.

      Snapshot/screenshot tests for `runtime jobs ls` (mock state), `jobs
      logs` output, and `--detach` output.
    status:
      implement: open
      test: open
      commit: open

  - id: qa-and-readmes
    title: Manual QA doc, README updates, design-doc regeneration
    prompt: |
      Create docs/plans/qa/e2b-integration.md as a markdown checklist
      (per CLAUDE.md "QA is not a script"):
        - Fresh repo: `poe-code runtime init` writes .poe-code/Dockerfile
          and .poe-code/config.json.
        - First-run e2b builds template; second run hits cache.
        - `poe-code ralph plan.md --runtime e2b --detach` returns jobId;
          sandbox visible in e2b dashboard.
        - `poe-code runtime jobs attach <id>` resumes log; Ctrl-C detaches
          without killing.
        - `poe-code runtime jobs stop <id>` kills + syncs back.
        - Modify a local file mid-run, then sync-back: refuse-and-list
          output is clear.
        - Same Dockerfile shared with a teammate → same template_id resolves.

      Update READMEs to list new env vars and config options (per CLAUDE.md
      package-rules):
        - packages/poe-code-config/README.md: runtime + runner scopes,
          state file locations.
        - packages/agent-harness-tools/README.md: ExecutionEnv contract,
          runPoeCommand entry point.
        - packages/process-runner/README.md: host + docker factories.
        - packages/runner-e2b/README.md: full doc (env vars, config,
          template build flow).

      Run `npm run generate:design-docs` if any visual language changed.

      Do NOT touch the project root README without a separate request
      (per CLAUDE.md readme rule).
    status:
      implement: open
      commit: open
---

# e2b integration

Run spawn, experiment, ralph, and superintendent on e2b sandboxes, sync or async (detach + reconnect), caller's choice.

## 1. What we're building

End the "works on my machine" failure mode. The repo declares its execution environment once — a Dockerfile plus a `runtime` config block — and `poe-code spawn|experiment|ralph|superintendent` runs identically on the host, in Docker, or in an e2b sandbox.

All four top-level tools accept the same runtime selector. e2b is a third backend alongside host and docker; docker support ships in this work because it shares the same config scope, and skipping it would split the pitch. Per-tool branching is not allowed — every tool gets the runtime treatment for free.

Execution mode is a caller decision, not a per-tool default:

- **sync** — block until exit, stream output, tear down on close.
- **async** — `--detach` returns a job id, sandbox + job keep running, reattach later from any machine.

Mode is selectable per-invocation (`--detach`) and as a config default (`runner.detach: true`).

The conceptual model: the local CLI opens an env, uploads the workspace, and runs the same `poe-code <tool> <args>` invocation inside it. No re-implementation per backend — the inner process runs on the host runner inside the box.

Encapsulation lives in `@poe-code/agent-harness-tools`: owns the `ExecutionEnv` contract and the lifecycle (open → upload → exec → stream → close or detach). The e2b SDK lives in a new `@poe-code/runner-e2b` package; the docker runner already exists in `@poe-code/process-runner`. Both implement the same factory. Harness-tools has no SDK dependencies.

Reuses, not reinvented:

- The `runtime` config scope previously designed in `docs/plans/archive/spawn-docker-integration.md` ships here, extended with `type: "e2b"`. Same `dockerfile`, `image`/`template_id`, `build_context`, `build_args`, `mounts`, `link` fields.
- e2b builds templates from Dockerfiles, so one Dockerfile drives both backends.
- Templates are content-addressed by Dockerfile hash and cached in the state file; teammates with the same Dockerfile reuse the same template.

## 2. User-facing shape

### Declaring a runtime

Convention: every repo opting into a non-host runtime ships a `.poe-code/Dockerfile` next to `.poe-code/config.json`. No path discovery, no per-project bikeshedding.

```text
.poe-code/
├── config.json
└── Dockerfile          ← canonical location
```

A minimal one:

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm i -g @poe-code/cli @anthropic-ai/claude-code
WORKDIR /workspace
```

The `runtime` block in `.poe-code/config.json` selects the backend:

```jsonc
// .poe-code/config.json
{
  "runtime": {
    "type": "e2b",
    "build_args": { "NODE_VERSION": "22" },
    "mounts": [
      { "source": ".", "target": "/workspace" }
    ],
    "link": "https://github.com/my-org/repo/blob/main/.poe-code/Dockerfile"
  }
}
```

`type` accepts `"host" | "docker" | "e2b"`. With `host` (the default), nothing changes vs. today.

Defaults derived from the convention:

- `dockerfile` → `.poe-code/Dockerfile` (override only if you have a non-standard layout, e.g. monorepo).
- `build_context` → repo root (the directory containing `.poe-code/`).

Pre-built images opt out of the Dockerfile entirely and just point at a registered artifact:

```jsonc
{ "runtime": { "type": "docker",  "image":       "ghcr.io/my-org/dev:latest" } }
{ "runtime": { "type": "e2b",     "template_id": "tmpl_abc123" } }
```

If `type` is `docker` or `e2b`, neither `image`/`template_id` nor a Dockerfile at the conventional path is present, runtime resolution hard-errors with a pointer to `poe-code runtime init`.

### Scaffolding

```console
$ poe-code runtime init
created .poe-code/Dockerfile (minimal node:22 + poe-code + claude)
updated .poe-code/config.json: runtime.type = "e2b"
next: commit, then run `poe-code runtime build` (or just run any tool).
```

`poe-code runtime init --type docker` flips the type. `--no-dockerfile` skips writing the Dockerfile (useful when you'll point at a pre-built `image`/`template_id`).

### Per-invocation overrides

Every tool accepts the same flags. Config is the default; flags override.

```text
--runtime host|docker|e2b      override runtime.type
--runtime-image <ref>          override docker image
--runtime-template <id>        override e2b template_id
--detach                       async; print jobId and exit
--sandbox <id>                 (reserved; reuse not supported in v1)
--mount-poe-code               dev: upload local poe-code build into the env
```

### spawn

With `runtime.type: host` (the default), behavior is identical to today.

```console
$ poe-code spawn claude "fix the failing test" --runtime e2b
opening e2b sandbox (template tmpl_abc123)...
uploading workspace (.gitignore-respected, 142 files, 8.3 MB)...
[claude] reading test output...
[claude] editing src/foo.ts...
[claude] tests passing.
syncing workspace back...
done. exit 0.

$ poe-code spawn claude "..." --runtime e2b --detach
opening e2b sandbox...
uploading workspace...
job started: job_01HZX...
sandbox: sb_4f9c...
detached. attach with: poe-code jobs attach job_01HZX...
```

### experiment / ralph / superintendent

Same flag surface. Long-running loops are the obvious `--detach` use case:

```console
$ poe-code ralph plan.md --runtime e2b --detach
opening e2b sandbox...
uploading workspace...
job started: job_01HZY...
detached.

$ poe-code superintendent plan.md --runtime e2b --detach
job started: job_01HZZ...
```

### Command surface

The four task commands (`spawn`, `experiment`, `ralph`, `superintendent`) keep their existing shape and gain the universal flags above. Everything else runtime-related is grouped under one noun: `poe-code runtime`.

```text
poe-code runtime build              build template from the project's Dockerfile (force)
poe-code runtime templates ls       list cached dockerfile_hash → template_id entries
poe-code runtime templates clear    drop the local template cache

poe-code runtime jobs ls            list active and recently-exited jobs
poe-code runtime jobs attach <id>   reattach to a running job's log stream
poe-code runtime jobs logs <id>     dump logs (supports --since)
poe-code runtime jobs stop <id>     kill the job; sync workspace back on exit
poe-code runtime jobs sandbox <id>  open an interactive shell in the sandbox
```

No top-level `poe-code jobs` namespace — jobs are a runtime concept and live under it.

### Building / refreshing templates

For the dockerfile path, the first run with a new Dockerfile builds an e2b template; the hash → template id is written to the state file and reused. Teammates with the same Dockerfile reuse the same template.

```console
$ poe-code spawn claude "..." --runtime e2b
no cached template for .poe-code/Dockerfile (hash 7f3a91...). building...
e2b template build: ........ done (template tmpl_dee44a in 47s)
   cached: ~/.poe-code/state/templates.json
opening sandbox (tmpl_dee44a)...
```

### Job control

```console
$ poe-code runtime jobs ls
JOB           TOOL             RUNTIME  STATUS    STARTED           SANDBOX
job_01HZX...  spawn:claude     e2b      running   2026-05-01 10:14  sb_4f9c...
job_01HZY...  ralph            e2b      running   2026-05-01 10:18  sb_2a1e...
job_01HZZ...  superintendent   e2b      exited(0) 2026-05-01 09:52  sb_8b3d...

$ poe-code runtime jobs attach job_01HZY...
[ralph] iteration 4 — applying patch...
^C
detaching (job continues running). use `runtime jobs stop` to kill.

$ poe-code runtime jobs logs job_01HZY... --since 2m
[ralph] iteration 5 — running tests...

$ poe-code runtime jobs stop job_01HZY...
killed. workspace synced back. exit 130.

$ poe-code runtime jobs sandbox sb_4f9c...
opening interactive shell in sandbox...
sandbox$ pwd
/workspace
```

### Workspace transfer

Default behavior:

- Upload: `cwd` minus `.gitignore` minus `.poe-code-ignore` (additive). Files >100MB warned and skipped.
- Download (sync mode): on clean exit, mirror back. Conflict policy: refuse to overwrite locally-modified files; print a list and exit non-zero.
- Download (detach): no auto-download. `jobs stop` and `jobs attach … --sync-on-exit` trigger it explicitly.

### Auth and env

Provider tokens (poe, anthropic, codex, …) and `POE_*` env vars are forwarded from local `poe-code-config` + auth-store onto the inner `exec`. Never written into the sandbox image. Never persisted on disk inside the sandbox. The user's `~/.poe-code/config.json` content is materialized into the sandbox's home dir before exec, so the inner `poe-code` resolves config identically.

## 3. Implementation details and technical decisions

### Package layout

```text
packages/
  agent-harness-tools/      owns ExecutionEnv contract + lifecycle (no SDKs)
  process-runner/           existing host + docker runners; gains "build from dockerfile" path
  runner-e2b/               new; e2b SDK lives only here
  poe-code-config/          new runtime + runner scopes
  agent-spawn/              switches from child_process to ExecutionEnv
```

`agent-harness-tools` keeps its zero-SDK rule — depends on `process-runner` and `runner-e2b` only through the `ExecutionEnv` factory interface. `agent-spawn`, `experiment-loop`, `ralph`, and `superintendent` all stop calling `child_process.spawn` and `process-runner` directly; they call `harness-tools` to open an env, then `exec` inside it. There is no per-tool branching on `runtime.type` — every tool gets the runtime treatment for free.

### `ExecutionEnv` contract (in `agent-harness-tools`)

```ts
export interface ExecutionEnvFactory {
  readonly type: "host" | "docker" | "e2b";
  open(spec: OpenSpec): Promise<OpenedEnv>;
  attach(jobId: string): Promise<OpenedEnv>;   // for detach + reattach
}

export interface OpenSpec {
  cwd: string;
  runtime: RuntimeConfig;             // resolved from poe-code-config
  env: Record<string, string>;        // forwarded provider tokens + POE_*
  uploadIgnoreFiles: string[];        // ['.gitignore', '.poe-code-ignore']
  jobLabel: { tool: string; argv: string[] };
}

export interface OpenedEnv {
  readonly id: string;                // sandbox/container id; "host" for host
  readonly job: JobHandle | null;     // populated only after detach()
  uploadWorkspace(): Promise<UploadResult>;
  downloadWorkspace(opts: { conflictPolicy: "refuse" | "overwrite" }): Promise<DownloadResult>;
  exec(spec: RunSpec): RunHandle;     // RunSpec/RunHandle from process-runner
  detach(): Promise<JobHandle>;       // freeze ownership, register job, return id
  shell(): RunHandle;                 // interactive tty
  close(): Promise<void>;
}
```

Three implementations, all in their own packages: `host` and `docker` in `process-runner`, `e2b` in `runner-e2b`. The harness ships a tiny `selectExecutionEnv(runtime)` helper that picks a factory by `runtime.type`. Adding a fourth backend is one new package and one register-call — no edits to harness-tools or any tool.

### Runtime config scope

`poe-code-config` already supports nested JSON via the existing scope mechanism. Add two scopes — `runtime` and `runner`:

```ts
type RuntimeConfig =
  | { type: "host" }
  | DockerRuntime
  | E2bRuntime;

interface DockerRuntime {
  type: "docker";
  image?: string;                       // mutually exclusive with dockerfile
  dockerfile?: string;
  build_context?: string;
  build_args?: Record<string, string>;
  mounts?: Mount[];                     // ["./src", "/workspace/src"] etc.
  ports?: Port[];
  network?: string;
  extra_args?: string[];
  link?: string;                        // informational
  engine?: "docker" | "podman";
}

interface E2bRuntime {
  type: "e2b";
  template_id?: string;                 // mutually exclusive with dockerfile
  dockerfile?: string;
  build_context?: string;
  build_args?: Record<string, string>;
  mounts?: Mount[];                     // upload-only on open
  link?: string;
  api_key_env?: string;                 // default "E2B_API_KEY"
}

interface RunnerScope {
  detach: boolean;                      // default false
  upload_max_file_mb: number;           // default 100; oversize files warned + skipped
  download_conflict: "refuse" | "overwrite";  // default "refuse"
}
```

Validation lives in `poe-code-config/src/runtime.ts`. The doc-level merge in `merge.ts` already supports nested objects; per-field replace, per-array concat for `mounts` (global `default_mounts` prepend project `mounts`).

### Templates and content addressing

Both `docker` and `e2b` accept either a pre-built artifact (`image` / `template_id`) or a Dockerfile. For the Dockerfile path, the cache key is `sha256(dockerfile_bytes + sorted(build_args))`. Cache file: `~/.poe-code/state/templates.json`:

```json
{
  "e2b": {
    "7f3a91ee...": { "template_id": "tmpl_dee44a", "built_at": "2026-05-01T..." }
  },
  "docker": {
    "7f3a91ee...": { "image": "poe-code/local:7f3a91ee", "built_at": "..." }
  }
}
```

First-run miss for the active backend triggers `runtime build`; the result is written to the cache. Two devs racing the build is harmless — the second write replaces the first; both template ids work. `runtime templates ls` and `runtime templates clear` operate on this file.

### Job model and persistence

A "job" is a detached `OpenedEnv` plus its inner `exec` invocation. Jobs are persisted at `~/.poe-code/state/jobs/<job_id>.json`:

```json
{
  "id": "job_01HZX...",
  "tool": "spawn:claude",
  "runtime": "e2b",
  "sandbox_id": "sb_4f9c...",
  "started_at": "...",
  "status": "running" | "exited" | "killed",
  "exit_code": null,
  "argv": ["spawn", "claude", "fix the failing test"],
  "cwd": "/Users/kjopek/Workspace/foo",
  "log_file": "~/.poe-code/state/jobs/<id>.log"
}
```

Jobs are local to the machine that detached. `runtime jobs ls` reads the directory; running jobs are health-checked by querying the backend (e2b: `sandboxes.list`). Stale entries (sandbox gone, job marked running) are flipped to `status: "exited", exit_code: -1` and a `reason: "sandbox_disappeared"` field is added.

Cross-machine reattach is **out of scope for v1**. The job id is meaningful only on the machine that detached. We document this in `runtime jobs ls --help`.

### Workspace upload / download

Upload uses an ignore-aware tar:

1. Walk `cwd`, applying `.gitignore` rules, then `.poe-code-ignore` (additive — never un-ignores something gitignore excluded).
2. Skip files >`runner.upload_max_file_mb` (default 100) and print a warning per skip.
3. Stream a tarball over the SDK's filesystem API. e2b: `sandbox.files.write` with a stream; docker: `docker cp` of the tarball + extract.
4. Emit a single summary line: `uploading workspace (.gitignore-respected, 142 files, 8.3 MB)...`.

Download mirrors the same ignore set in reverse, comparing local mtime/hash vs remote. `conflict_policy: "refuse"` (default) prints conflicting paths and exits non-zero; `"overwrite"` clobbers. No three-way merge.

### Auth and inner-process env

- Provider tokens come from `auth-store` and are passed only via `env` on the inner `exec`. Never written to a file inside the sandbox. Never baked into the template.
- The user's resolved `poe-code-config` (merged global + project) is serialized to JSON and written to the sandbox at `$HOME/.poe-code/config.json` *immediately before* `exec` (e2b file write API; docker bind-mount or `cp`). It is removed in `close()`. This makes the inner `poe-code` resolve config identically to the host.
- `E2B_API_KEY` is read from the host env (configurable name via `runtime.api_key_env`); never forwarded into the sandbox.

### Interactive shell

`runtime jobs sandbox <id>` calls `OpenedEnv.shell()`, which opens a tty-attached `bash`/`sh` inside the existing sandbox/container. e2b: `sandbox.commands.run("bash", { tty: true })` piped through `process.stdin/stdout`. Local Ctrl-D detaches the shell but leaves the sandbox running. Same primitive backs `attach`'s log stream — both go through the same RunHandle plumbing in `process-runner/types.ts`.

### Edge cases

- **Ignore-file precedence.** `.gitignore` first (covers third-party deps), `.poe-code-ignore` second and additive only. Never un-ignores. If a user wants `node_modules` *included* in the upload (unusual but plausible for offline reproduction), they remove it from `.gitignore` — we do not invent an "include" syntax.
- **Race on first-run template build.** Two CLI invocations on different machines build the same Dockerfile concurrently. Each writes its own template id to its own state file; both are valid. No locking, no coordination.
- **Sandbox disappears during sync detach.** e2b auto-pauses idle sandboxes after a configurable timeout. Sync mode keeps the sandbox alive via the active connection; detached mode relies on e2b's keep-alive (default 60s of idle → pause). We document the cap; killing a paused sandbox is a `runtime jobs stop` no-op that cleans the state file.
- **Workspace conflicts on download.** Default `refuse` exits non-zero with a list. Surfaced clearly in `attach --sync-on-exit` and `jobs stop`.
- **Dockerfile changes mid-job.** The job carries the template id it opened with. Editing the Dockerfile after detach has no effect on the running job; the next `open` rebuilds.
- **`--mount-poe-code` (dev).** Uploads the local `poe-code` build (`packages/poe-code/dist/` plus deps) to `/usr/local/lib/poe-code` and prepends it to the inner `PATH`. For testing unreleased local changes inside the sandbox.

### Flags, env vars, defaults

| Surface | Default | Override |
| --- | --- | --- |
| `runtime.type` | `host` | config `runtime.type`, flag `--runtime` |
| `runner.detach` | `false` | config `runner.detach`, flag `--detach` |
| `runner.upload_max_file_mb` | `100` | config only |
| `runner.download_conflict` | `refuse` | config only; `--sync-on-exit --overwrite` future |
| e2b api key env | `E2B_API_KEY` | `runtime.api_key_env` |
| Template cache | `~/.poe-code/state/templates.json` | not configurable |
| Job state dir | `~/.poe-code/state/jobs/` | not configurable |

## 4. Interfaces and test plan

### Module-boundary types

`@poe-code/agent-harness-tools` (new exports):

```ts
export interface ExecutionEnvFactory { /* see L3 */ }
export interface OpenSpec { /* see L3 */ }
export interface OpenedEnv { /* see L3 */ }

export interface UploadResult {
  files: number;
  bytes: number;
  skipped: { path: string; bytes: number; reason: "max_size" }[];
}

export interface DownloadResult {
  files: number;
  bytes: number;
  conflicts: { path: string; reason: "local_modified" }[];
}

export interface JobHandle {
  readonly id: string;
  readonly envId: string;
  readonly tool: string;
  readonly argv: string[];
  status(): Promise<JobStatus>;
  stream(opts?: { sinceByte?: number }): AsyncIterable<LogChunk>;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: NodeJS.Signals): Promise<void>;
}

export type JobStatus = "running" | "exited" | "killed" | "lost";

export function selectExecutionEnv(
  runtime: RuntimeConfig
): ExecutionEnvFactory;

export function runPoeCommand(opts: RunPoeCommandOptions): Promise<RunPoeCommandResult>;

export interface RunPoeCommandOptions {
  factory: ExecutionEnvFactory;
  openSpec: OpenSpec;
  detach: boolean;
  state: StateManager;
  signal?: AbortSignal;
}

export type RunPoeCommandResult =
  | { kind: "sync"; exitCode: number; download: DownloadResult }
  | { kind: "detached"; jobId: string; envId: string };
```

`@poe-code/poe-code-config` (new exports):

```ts
export type RuntimeConfig =
  | { type: "host" }
  | DockerRuntime
  | E2bRuntime;

export interface DockerRuntime { /* see L3 */ }
export interface E2bRuntime { /* see L3 */ }
export interface RunnerScope { /* see L3 */ }

export interface RuntimeResolveResult {
  runtime: RuntimeConfig;
  runner: RunnerScope;
  dockerfilePath: string | null;       // resolved absolute, or null when image/template_id used
  buildContext: string | null;
}

export function resolveRuntime(opts: {
  cwd: string;
  config: ResolvedConfig;
}): RuntimeResolveResult;

export interface StateManager {
  templates: TemplateRegistry;
  jobs: JobRegistry;
}

export interface TemplateRegistry {
  get(backend: "docker" | "e2b", hash: string): TemplateEntry | null;
  put(backend: "docker" | "e2b", entry: TemplateEntry): Promise<void>;
  remove(backend: "docker" | "e2b", hash: string): Promise<void>;
  list(backend?: "docker" | "e2b"): TemplateEntry[];
}

export interface JobRegistry {
  get(jobId: string): JobEntry | null;
  put(entry: JobEntry): Promise<void>;
  update(jobId: string, patch: Partial<JobEntry>): Promise<void>;
  list(filter?: { status?: JobStatus[]; tool?: string }): JobEntry[];
}

export function loadStateManager(homeDir?: string): Promise<StateManager>;
```

`@poe-code/runner-e2b` (single named export):

```ts
export const e2bExecutionEnvFactory: ExecutionEnvFactory;
```

`@poe-code/process-runner` (additional exports):

```ts
export const hostExecutionEnvFactory: ExecutionEnvFactory;
export const dockerExecutionEnvFactory: ExecutionEnvFactory;
```

### Test plan

**Unit — `poe-code-config`:**

- `resolveRuntime` merging cases: project overrides global; arrays concat; mutually exclusive image/dockerfile rejected; missing dockerfile + missing image hard-errors.
- `StateManager`: concurrent `put` calls preserve invariants (use `file-lock`); reading partial-write state is detected and rejected; per-job file write is atomic via `tmp + rename`.

**Unit — `agent-harness-tools`:**

- `runPoeCommand` flow with a mock `ExecutionEnvFactory`: state moves `pending → running → exited`; sync path closes env; detach path leaves env open and returns jobId.
- Workspace transfer: gitignore parsed, additive `.poe-code-ignore`, max-size skip, conflict refuse-and-list. Use `memfs` per CLAUDE.md.
- Log streaming: `stream({ sinceByte: 0 })` replays history; `stream({ sinceByte: N })` starts at offset; `wait()` resolves on exit-marker file.

**Unit — `process-runner`:**

- `hostExecutionEnvFactory.open` is a thin adapter: `exec` round-trips through existing host runner; `uploadDir`/`downloadDir`/`close` are no-ops.
- `dockerExecutionEnvFactory`: open with `image`, with `dockerfile`, both fail-closed when neither.

**Unit — `runner-e2b`:**

- Mock the e2b SDK at the boundary; verify `open` resolves template via `StateManager.templates`, builds on miss, opens sandbox.
- `attach(envId)` calls SDK reconnect; rejects on "sandbox not found" with a typed error.

**Integration:**

- New package `runner-e2b/test/integration.test.ts` (gated on `E2B_API_KEY`). Builds a minimal Dockerfile, opens a sandbox, runs `echo`, downloads. Skipped without API key. Not in default `npm test`.
- `agent-spawn` end-to-end with `runtime.type: "docker"` against the local docker daemon — gated on docker availability.

**E2E (`npm run e2e:verbose`):**

- `poe-code runtime init` creates files; subsequent `poe-code spawn ...` against host succeeds (no docker required).
- `poe-code runtime jobs ls` against an empty state returns clean output.
- Skipped or smoke-only for docker/e2b paths.

**Visual / screenshot:**

- `npm run screenshot-poe-code -- runtime --help`, `runtime jobs ls`, `runtime templates ls`.
- `--detach` output of `poe-code spawn` (against a mock factory).

**Manual QA — markdown checklist** at `docs/plans/qa/e2b-integration.md`:

- [ ] Fresh repo, run `poe-code runtime init`, verify `.poe-code/Dockerfile` and `.poe-code/config.json` written.
- [ ] `poe-code spawn claude "..." --runtime e2b` first run builds template; second run hits cache.
- [ ] `poe-code ralph plan.md --runtime e2b --detach` returns jobId; sandbox visible in e2b dashboard.
- [ ] `poe-code runtime jobs attach <id>` resumes log; Ctrl-C detaches without killing.
- [ ] `poe-code runtime jobs stop <id>` kills + syncs.
- [ ] Modify a local file mid-run, then sync-back: refuse-and-list output is clear.
- [ ] Same Dockerfile shared with a teammate → same template_id resolves.

### Rollout / migration

No existing callers break: `runtime.type` defaults to `host`, which is the current code path. The `child_process.spawn` call sites in `agent-spawn`, `experiment-loop`, `ralph`, `superintendent` are migrated through the new `runPoeCommand` helper, but the host `ExecutionEnvFactory` adapter routes them back to today's behavior bit-for-bit.

Migration ordering (keeps the branch green):

1. Land `runtime` + `runner` config scopes with parser/validator. No callers.
2. Land `ExecutionEnv` contract and `host` factory in `process-runner`. No callers.
3. Land `runPoeCommand` in `agent-harness-tools` against the host factory only. No callers.
4. Migrate `agent-spawn` to call `runPoeCommand`. Behavior unchanged for `type: host`.
5. Migrate `experiment-loop`, `ralph`, `superintendent` similarly.
6. Land `docker` factory + template build path. New CLI: `poe-code runtime init`, `runtime build`, `runtime templates *`.
7. Land `runner-e2b`. New CLI: `runtime jobs *`.
8. Land `--detach` plumbing through `runPoeCommand`.
9. Documentation + screenshots.

Each step is independently shippable; nothing past step 1 is a breaking change.

### Autonomy checklist

For an agent picking this up to run end-to-end without coming back:

- [ ] All four task commands accept `--runtime`, `--detach`, `--mount-poe-code` and read the same config scopes.
- [ ] `runtime.type === "host"` runs identically to today (verified by existing test suite).
- [ ] `selectExecutionEnv(runtime)` is the only branch on `runtime.type`. Grep-test: no `if (runtime.type === ...)` outside that helper.
- [ ] No `child_process.spawn` calls remain in `agent-spawn`, `experiment-loop`, `ralph`, `superintendent`.
- [ ] `StateManager` is the only writer to `~/.poe-code/state/`. Grep-test in CI.
- [ ] e2b SDK appears only in `runner-e2b` deps. Lint rule via `package.json` rules or `npm run lint:deps`.
- [ ] `poe-code runtime init` is idempotent: re-running on an initialized repo updates `runtime.type` but does not overwrite an existing Dockerfile (prompts unless `--yes`).
- [ ] Snapshot tests cover `runtime jobs ls` formatting (per `docs/SNAPSHOT_TESTING.md`).
- [ ] Manual QA doc is markdown, executable by an agent (per CLAUDE.md QA convention).
- [ ] All new packages have a README listing env vars and config options (per CLAUDE.md package rules).

## 5. Code plan

### Files to create

**`packages/poe-code-config/src/runtime.ts`** — runtime + runner scope types, parser, validator, `resolveRuntime`.

```ts
export type RuntimeConfig = HostRuntime | DockerRuntime | E2bRuntime;
export interface RuntimeResolveResult { /* L4 */ }
export function parseRuntime(raw: unknown): RuntimeConfig;
export function parseRunnerScope(raw: unknown): RunnerScope;
export function resolveRuntime(opts: { cwd: string; config: ResolvedConfig }): RuntimeResolveResult;
```

**`packages/poe-code-config/src/state/index.ts`** — `StateManager` entry point.

```ts
export async function loadStateManager(homeDir?: string): Promise<StateManager>;
```

**`packages/poe-code-config/src/state/templates.ts`** — `TemplateRegistry` over `~/.poe-code/state/templates.json` with `file-lock`.

**`packages/poe-code-config/src/state/jobs.ts`** — `JobRegistry` over `~/.poe-code/state/jobs/<id>.json` (one file per job; atomic via `tmp + rename`).

**`packages/agent-harness-tools/src/execution-env.ts`** — `ExecutionEnvFactory`, `OpenedEnv`, `JobHandle` interfaces; `selectExecutionEnv` registry.

```ts
export function registerExecutionEnvFactory(factory: ExecutionEnvFactory): void;
export function selectExecutionEnv(runtime: RuntimeConfig): ExecutionEnvFactory;
```

**`packages/agent-harness-tools/src/run-poe-command.ts`** — the universal entry point.

```ts
export async function runPoeCommand(opts: RunPoeCommandOptions): Promise<RunPoeCommandResult>;
```

**`packages/agent-harness-tools/src/workspace-transfer.ts`** — gitignore + poe-code-ignore aware tar; oversize skip.

```ts
export async function uploadWorkspace(env: OpenedEnv, opts: UploadOptions): Promise<UploadResult>;
export async function downloadWorkspace(env: OpenedEnv, opts: DownloadOptions): Promise<DownloadResult>;
```

**`packages/agent-harness-tools/src/log-stream.ts`** — tee-to-file inside sandbox + offset-aware tail on the host.

```ts
export function wrapForLogTee(argv: string[], jobId: string): string[];   // returns sh -c "..."
export function streamLogFile(env: OpenedEnv, jobId: string, opts: { sinceByte?: number }): AsyncIterable<LogChunk>;
```

**`packages/process-runner/src/host/host-execution-env.ts`** — `hostExecutionEnvFactory`. Wraps existing host runner; uploads/downloads are no-ops.

**`packages/process-runner/src/docker/docker-execution-env.ts`** — `dockerExecutionEnvFactory`. Builds image from Dockerfile when `image` is absent (delegates to `StateManager.templates` for hash → image). Container lifecycle.

**`packages/runner-e2b/`** — NEW package.

```text
packages/runner-e2b/
├── package.json
├── README.md                    env vars, config options
├── tsconfig.json
└── src/
    ├── index.ts                 export { e2bExecutionEnvFactory }
    ├── factory.ts               implements ExecutionEnvFactory
    ├── opened-env.ts            implements OpenedEnv (upload, exec, download, close, shell)
    ├── template-build.ts        hash + cache + e2b template build
    ├── job-handle.ts            implements JobHandle (status, stream, wait, kill)
    ├── sdk.ts                   thin wrapper around @e2b SDK; the only file that imports it
    └── *.test.ts
```

**`packages/poe-code/src/commands/runtime/`** — new CLI namespace.

```text
packages/poe-code/src/commands/runtime/
├── index.ts             root: registers subcommands
├── init.ts              poe-code runtime init
├── build.ts             poe-code runtime build
├── templates/ls.ts      poe-code runtime templates ls
├── templates/clear.ts   poe-code runtime templates clear
├── jobs/ls.ts           poe-code runtime jobs ls
├── jobs/attach.ts       poe-code runtime jobs attach
├── jobs/logs.ts         poe-code runtime jobs logs
├── jobs/stop.ts         poe-code runtime jobs stop
└── jobs/sandbox.ts      poe-code runtime jobs sandbox
```

**`docs/plans/qa/e2b-integration.md`** — manual QA checklist (markdown, executable by agent, per CLAUDE.md rule).

### Files to change

**`packages/poe-code-config/src/index.ts`** — re-export `RuntimeConfig`, `RunnerScope`, `resolveRuntime`, `loadStateManager`.

**`packages/poe-code-config/src/types.ts`** — add `runtime` and `runner` to `ResolvedConfig`.

**`packages/poe-code-config/src/merge.ts`** — extend merge rules: `runtime` is replace-by-field; `runtime.mounts` and `runner.workspace.exclude` concat (global prepended to project).

**`packages/poe-code-config/src/schema.ts`** — JSON schema for the new scopes (for `poe-code-config-schema-generation` per the existing plan).

**`packages/agent-harness-tools/src/index.ts`** — re-export `ExecutionEnvFactory`, `OpenedEnv`, `JobHandle`, `runPoeCommand`, `selectExecutionEnv`, transfer + log helpers.

**`packages/agent-harness-tools/package.json`** — add `@poe-code/poe-code-config` (new) and `@poe-code/process-runner` (already there) deps. No SDK deps.

**`packages/process-runner/src/index.ts`** — export `hostExecutionEnvFactory`, `dockerExecutionEnvFactory`.

**`packages/agent-spawn/src/spawn.ts`** — replace direct `child_process.spawn` with `runPoeCommand` + selected factory. Host factory keeps current behavior.

**`packages/agent-spawn/src/spawn-interactive.ts`** — same migration; interactive uses `OpenedEnv.shell()` for tty.

**`packages/experiment-loop/src/run/loop.ts`** — wrap inner agent invocations through the same path.

**`packages/ralph/src/runtime/*`** — same.

**`packages/superintendent/src/runtime/run-builder.ts`**, **`run-superintendent.ts`**, **`run-inspector.ts`**, **`run-owner-review.ts`** — same.

**`packages/poe-code/src/commands/index.ts`** — register the `runtime` namespace.

**`packages/poe-code/src/cli.ts`** (or wherever flags are wired) — universal flags `--runtime`, `--runtime-image`, `--runtime-template`, `--detach`, `--mount-poe-code` available on all four task commands. Surfaced via the design system (no `chalk` / `@clack/prompts` direct).

**SDK callers** — same flags exposed in the SDK (per CLAUDE.md "CLI vs SDK" rule).

**Each new/changed package's `README.md`** — env vars and config options, per CLAUDE.md package rules.

### Function signatures (new / modified)

```ts
// agent-harness-tools/src/run-poe-command.ts
export async function runPoeCommand(opts: {
  factory: ExecutionEnvFactory;
  openSpec: OpenSpec;
  detach: boolean;
  state: StateManager;
  signal?: AbortSignal;
}): Promise<RunPoeCommandResult>;

// agent-harness-tools/src/execution-env.ts
export function selectExecutionEnv(runtime: RuntimeConfig): ExecutionEnvFactory;
export function registerExecutionEnvFactory(f: ExecutionEnvFactory): void;

// poe-code-config/src/runtime.ts
export function resolveRuntime(opts: {
  cwd: string;
  config: ResolvedConfig;
}): RuntimeResolveResult;

// poe-code-config/src/state/index.ts
export async function loadStateManager(homeDir?: string): Promise<StateManager>;

// process-runner/src/host/host-execution-env.ts
export const hostExecutionEnvFactory: ExecutionEnvFactory;

// process-runner/src/docker/docker-execution-env.ts
export const dockerExecutionEnvFactory: ExecutionEnvFactory;

// runner-e2b/src/index.ts
export const e2bExecutionEnvFactory: ExecutionEnvFactory;

// runner-e2b/src/template-build.ts
export async function buildOrResolveTemplate(opts: {
  runtime: E2bRuntime;
  dockerfilePath: string;
  buildContext: string;
  state: StateManager;
}): Promise<{ templateId: string; cached: boolean }>;

// agent-spawn/src/spawn.ts (modified)
export async function spawn(agentId: string, options: SpawnOptions): Promise<SpawnResult>;
// internally now goes through runPoeCommand
```

### Build order

Each step keeps the branch green; nothing later than step 1 is a breaking change.

1. **Config scopes + state manager** (`poe-code-config`)
   - Add `runtime.ts`, `state/*`, schema, merge rules.
   - Tests: parser, merge, registry CRUD with `memfs`.
   - No callers wired yet.

2. **Execution env contract + host factory** (`agent-harness-tools`, `process-runner`)
   - Add `execution-env.ts`, `run-poe-command.ts`, `workspace-transfer.ts`, `log-stream.ts`.
   - Add `hostExecutionEnvFactory` (no-op uploads, wraps existing `Runner`).
   - Tests: mock factory + `runPoeCommand` flow.

3. **Migrate `agent-spawn` to host factory**
   - Replace `child_process.spawn` with `runPoeCommand` + host factory.
   - Behavior bit-for-bit identical when `runtime.type === "host"`.
   - Existing spawn tests pass unchanged.

4. **Migrate `experiment-loop`, `ralph`, `superintendent`**
   - Same pattern. No new behavior.

5. **Universal CLI flags + `runtime init`**
   - `--runtime`, `--detach`, `--mount-poe-code` wired on the four task commands and SDK.
   - `poe-code runtime init` scaffolds Dockerfile + config.

6. **Docker factory + template build path** (`process-runner`)
   - `dockerExecutionEnvFactory`, image build from Dockerfile via `StateManager.templates`.
   - `poe-code runtime build`, `runtime templates ls|clear`.
   - Integration test gated on local docker.

7. **e2b factory** (`runner-e2b` — new package)
   - SDK wrapper, factory, opened-env, template build, job handle.
   - Integration test gated on `E2B_API_KEY`.

8. **Detach + jobs commands**
   - State writes, log tee, attach/stream/wait reattach.
   - `runtime jobs ls|attach|logs|stop|sandbox`.

9. **Manual QA + screenshots + READMEs**
   - QA markdown doc; design-system screenshots for the new commands; per-package READMEs.
