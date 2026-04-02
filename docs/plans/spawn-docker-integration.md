# Spawn Docker Integration

Run agents inside Docker containers, driven by project and global config.

## Problem

Today `agent-spawn` calls `child_process.spawn()` directly.
`process-runner` already provides a `Runner` abstraction with `HostRunner` and `DockerRunner`,
but agent-spawn doesn't use it. There's no way to say "this project runs agents in Docker"
via configuration — Docker is only used by `process-launcher` for long-running services.

## Goal

A project can declare a Docker runtime in `.poe-code/config.json`. When present,
`poe-code spawn` (and all SDK callers) run the agent CLI inside that container
instead of on the host. The same image/config is used consistently across spawn,
interactive spawn, and streaming spawn.

## Design decisions

### Config location: project + global

**Project config** (`.poe-code/config.json`) — declares the image and project-specific settings:

```json
{
  "runtime": {
    "type": "docker",
    "image": "ghcr.io/my-org/dev-env:latest",
    "link": "https://github.com/my-org/dev-env",
    "mounts": [
      { "source": ".", "target": "/workspace" }
    ],
    "ports": [
      { "host": 3000, "container": 3000 }
    ],
    "network": "my-network",
    "extra_args": ["--gpus", "all"]
  }
}
```

**Global config** (`~/.poe-code/config.json`) — sets defaults that apply when no project config exists:

```json
{
  "runtime": {
    "engine": "podman",
    "default_mounts": [
      { "source": "~/.ssh", "target": "/root/.ssh", "readonly": true },
      { "source": "~/.gitconfig", "target": "/root/.gitconfig", "readonly": true }
    ]
  }
}
```

Merge strategy: project overrides global. `mounts` and `default_mounts` are concatenated
(global `default_mounts` are prepended to project `mounts`). Scalar fields (engine, image,
network) are replaced.

### Why not `defineScope`

The typed config scope API only supports flat scalar fields (`string | number | boolean`).
Docker config needs arrays of objects (mounts, ports). The config store already supports
arbitrary JSON at the document level (`ConfigDocument = Record<string, Record<string, unknown>>`),
and the `configured_services` scope already uses nested objects.

Approach: define a `runtime` scope with its own TypeScript types and a parser/validator
that reads from the merged document. No changes to `poe-code-config`'s schema system needed.

### Runtime config types

```typescript
// packages/poe-code-config/src/runtime.ts

interface RuntimeConfig {
  type: "host" | "docker";
}

interface HostRuntimeConfig extends RuntimeConfig {
  type: "host";
}

interface DockerRuntimeConfig extends RuntimeConfig {
  type: "docker";

  // --- Image source (exactly one required) ---

  /** Pre-built image to pull/use. Mutually exclusive with `dockerfile`. */
  image?: string;
  /** Path to a Dockerfile, relative to project root. Mutually exclusive with `image`. */
  dockerfile?: string;
  /** Build context directory, relative to project root. Default: dirname of dockerfile. */
  build_context?: string;
  /** Build args passed as --build-arg to docker build. */
  build_args?: Record<string, string>;

  /** Optional. URL to Dockerfile source or image registry page. Informational only. */
  link?: string;
  /** Container engine. Default: auto-detect (docker > podman). */
  engine?: "docker" | "podman";
  /** Volume mounts. "." is resolved to project root at runtime. */
  mounts?: Array<{
    source: string;
    target: string;
    readonly?: boolean;
  }>;
  /** Port mappings. */
  ports?: Array<{
    host: number;
    container: number;
    protocol?: "tcp" | "udp";
  }>;
  /** Docker network. */
  network?: string;
  /** Extra docker run arguments. */
  extra_args?: string[];
}

// Global-only fields (merged into DockerRuntimeConfig at resolution time)
interface GlobalRuntimeDefaults {
  engine?: "docker" | "podman";
  /** Mounts prepended to every project's mount list. */
  default_mounts?: Array<{
    source: string;
    target: string;
    readonly?: boolean;
  }>;
}
```

### Image source: `image` vs `dockerfile`

A project provides **exactly one** of:

| Field | When to use | Example |
|-------|------------|---------|
| `image` | Pre-built image from a registry or local | `"node:22-slim"`, `"ghcr.io/my-org/dev:latest"` |
| `dockerfile` | Project contains its own Dockerfile | `".poe-code/Dockerfile"`, `"docker/agent.Dockerfile"` |

Validation: if both are set → error. If neither is set → error.

#### Dockerfile build flow

When `dockerfile` is set, poe-code builds the image before spawning:

1. **Hash** — compute content hash of the Dockerfile + build context directory
   (reuse the hashing approach from `e2e-docker-test-runner/src/image.ts`)
2. **Tag** — `poe-runtime:<project-name>-<hash[:12]>`
3. **Cache check** — if image with that tag already exists, skip build
4. **Build** — `docker build -t <tag> -f <dockerfile> <build_context>`
   - Pass `build_args` as `--build-arg KEY=VALUE`
   - Show build output in verbose mode, suppress in normal mode
5. **Use** — the resolved tag becomes the `image` for `createDockerRunner()`

The build step happens once per Dockerfile change. Subsequent spawns reuse the cached image.

#### Recommended Dockerfile location

Convention: `.poe-code/Dockerfile` (next to config.json). But any path works.

```
my-project/
  .poe-code/
    config.json        # runtime.dockerfile = "Dockerfile"
    Dockerfile         # project-specific agent environment
  src/
    ...
```

### Resolution

```typescript
interface ResolvedDockerRuntime {
  type: "docker";
  /** Final image tag to use (either from config or built from Dockerfile). */
  image: string;
  engine: Engine;
  mounts: DockerMount[];
  ports: DockerPortMapping[];
  network?: string;
  extraArgs: string[];
}

async function resolveRuntimeConfig(
  globalDoc: ConfigDocument,
  projectDoc: ConfigDocument | undefined,
  cwd: string,
  homeDir: string
): Promise<HostRuntimeConfig | ResolvedDockerRuntime>;
```

1. Read `runtime` scope from merged document
2. If absent or `type !== "docker"` → return `{ type: "host" }` (default, zero-config)
3. Validate exactly one of `image` or `dockerfile` is present
4. If `dockerfile`:
   a. Resolve path relative to `cwd`
   b. Validate file exists
   c. Build image (with cache check) → sets `image` to built tag
5. Resolve relative mount paths: `"."` → `cwd`, `"~"` prefix → `homeDir`
6. Prepend `default_mounts` from global config
7. Return fully resolved `ResolvedDockerRuntime`

### Wiring into agent-spawn

`agent-spawn` already has a `SpawnContext` type. Add an optional `runner` field:

```typescript
// packages/agent-spawn/src/types.ts
export interface SpawnContext {
  dryRun?: boolean;
  logger?: SpawnLogger;
  homeDir?: string;
  runner?: Runner;  // NEW — from @poe-code/process-runner
}
```

In `spawn()`, `spawnInteractive()`, and `spawnStreaming()`:
- If `context.runner` is provided → use it
- Otherwise → use `createHostRunner()` (current behavior, no breaking change)

The CLI layer (or SDK caller) is responsible for creating the runner based on config:

```typescript
// Pseudocode in CLI spawn command handler
const runtimeConfig = resolveRuntimeConfig(globalDoc, projectDoc, cwd, homeDir);

let runner: Runner;
if (runtimeConfig.type === "docker") {
  runner = createDockerRunner({
    image: runtimeConfig.image,
    engine: runtimeConfig.engine,
    mounts: runtimeConfig.mounts,
    ports: runtimeConfig.ports,
    network: runtimeConfig.network,
    extraArgs: runtimeConfig.extra_args
  });
} else {
  runner = createHostRunner();
}

await spawn(agentId, options, { runner });
```

### Automatic cwd mount (read/write)

The agent needs full read/write access to the project directory — it reads code, writes
fixes, creates files. This is the whole point of running an agent.

When runtime is Docker, **always** mount cwd as read/write:

```json
{ "source": ".", "target": "/workspace" }
```

This mount is **implicit and non-optional** — it's not part of the user's `mounts` config,
it's injected by the resolver. The user's `mounts` array is for *additional* mounts only
(shared data dirs, caches, etc.).

The RunSpec `cwd` is set to `/workspace` so the agent operates in the right directory.

If the user's `mounts` includes a mount targeting `/workspace`, the implicit mount is
skipped (user override wins). This is the only escape hatch — for exotic setups where
the project dir should be mounted elsewhere or read-only.

**Why read/write is critical**: agents create files, modify source code, write configs,
run build tools that produce artifacts. A read-only cwd mount would make the agent useless.
The global `default_mounts` (ssh keys, gitconfig) are read-only because those are reference
data — but the project directory is the agent's workspace.

### Process-launcher integration

`process-launcher` already supports `ProcessSpec.docker`. No changes needed there.
The runtime config is specifically for agent spawn. If a user wants a launched service
in Docker, they configure it via `poe-code launch start --image ...` as today.

Future: `process-launcher` could also read from runtime config for consistency,
but that's a separate concern.

### `poe-code config` integration

The `config show` command should display runtime config when present.
The `config init` command could scaffold a runtime section when Docker is detected.

### CLI flags (override config)

```
poe-code spawn --runtime docker --image node:22 ...
poe-code spawn --runtime host ...  (force host even if project says docker)
```

These override the config for a single invocation. Useful for debugging.

## Config file examples

### Minimal: pre-built image

`.poe-code/config.json`:
```json
{
  "runtime": {
    "type": "docker",
    "image": "node:22-slim",
    "link": "https://hub.docker.com/_/node"
  }
}
```

That's it. cwd is auto-mounted. Engine is auto-detected.

### Minimal: project Dockerfile

`.poe-code/config.json`:
```json
{
  "runtime": {
    "type": "docker",
    "dockerfile": "Dockerfile",
    "link": "https://github.com/my-org/my-project"
  }
}
```

`.poe-code/Dockerfile`:
```dockerfile
FROM node:22-slim

# Install the agent CLI the project uses
RUN npm install -g @anthropic-ai/claude-code

# Project-specific tooling
RUN apt-get update && apt-get install -y git ripgrep
```

poe-code builds this image automatically (cached by content hash), then runs the agent inside it.

### Dockerfile with build args

`.poe-code/config.json`:
```json
{
  "runtime": {
    "type": "docker",
    "dockerfile": "docker/agent.Dockerfile",
    "build_context": "docker",
    "build_args": {
      "NODE_VERSION": "22",
      "AGENT_VERSION": "latest"
    },
    "link": "https://github.com/my-org/my-project/tree/main/docker"
  }
}
```

`docker/agent.Dockerfile`:
```dockerfile
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim

ARG AGENT_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${AGENT_VERSION}
```

### Full Docker project with custom mounts

`.poe-code/config.json`:
```json
{
  "runtime": {
    "type": "docker",
    "image": "ghcr.io/my-org/dev-env:latest",
    "link": "https://github.com/my-org/dev-env/pkgs/container/dev-env",
    "mounts": [
      { "source": ".", "target": "/workspace" },
      { "source": "../shared-data", "target": "/data", "readonly": true }
    ],
    "ports": [
      { "host": 3000, "container": 3000 },
      { "host": 5432, "container": 5432 }
    ],
    "network": "dev-net",
    "extra_args": ["--gpus", "all"]
  }
}
```

### Global defaults (user-wide)

`~/.poe-code/config.json`:
```json
{
  "core": { "apiKey": "..." },
  "runtime": {
    "engine": "podman",
    "default_mounts": [
      { "source": "~/.ssh", "target": "/root/.ssh", "readonly": true },
      { "source": "~/.gitconfig", "target": "/root/.gitconfig", "readonly": true }
    ]
  }
}
```

## Implementation order

### Phase 1: Runtime config types and resolution

**Package:** `poe-code-config`

1. Add `runtime.ts` — types (`DockerRuntimeConfig`, `HostRuntimeConfig`, `GlobalRuntimeDefaults`)
2. Add `resolve-runtime.ts` — `resolveRuntimeConfig()` function
   - Reads `runtime` scope from merged document
   - Validates exactly one of `image` / `dockerfile`
   - Resolves relative paths
   - Merges global `default_mounts` with project `mounts`
3. Tests for resolution logic (memfs)
   - No runtime scope → `{ type: "host" }`
   - Docker config with neither image nor dockerfile → throws
   - Docker config with both image and dockerfile → throws
   - `image` config resolves correctly
   - `dockerfile` config resolves path relative to cwd
   - Relative mounts resolved to absolute
   - Global default_mounts prepended
   - Project fields override global scalars

### Phase 1b: Dockerfile build

**Package:** `process-runner` (or new `runtime-builder` utility in poe-code-config)

4. `buildRuntimeImage()` function
   - Content-hash the Dockerfile + build context for cache key
   - Check if image with tag `poe-runtime:<project>-<hash>` exists
   - If not, run `docker build -t <tag> -f <dockerfile> <context>`
   - Pass `build_args` as `--build-arg`
   - Return the image tag
5. Tests
   - Hash changes when Dockerfile content changes
   - Cache hit skips build (mock engine commands)
   - Build args forwarded correctly

### Phase 2: Inject Runner into agent-spawn

**Package:** `agent-spawn`

4. Add optional `runner?: Runner` to `SpawnContext`
5. Refactor `spawn()` to use `context.runner ?? createHostRunner()` instead of `child_process.spawn()` directly
6. Refactor `spawnInteractive()` similarly
7. Refactor `spawnStreaming()` similarly
8. Tests: mock runner verifies spawn calls go through runner interface
9. Existing tests continue to pass (no behavioral change when runner not provided)

### Phase 3: CLI + SDK wiring

**Package:** `poe-code` (core)

10. In spawn command handler: read runtime config, create appropriate runner, pass via context
11. Add `--runtime` and `--image` CLI flags as overrides
12. SDK `spawn()` accepts optional `runtimeConfig` or `runner`
13. Screenshot tests for `poe-code spawn --help` showing new flags

### Phase 4: Config UX

14. `config show` displays runtime section
15. `config init` prompts for runtime type when Docker is detected on the system
16. Validation errors shown clearly when Docker image is missing or engine not found

### Phase 5: Verification

17. Manual: `poe-code spawn claude-code -p "echo hello" --runtime docker --image node:22`
18. Manual: Project with `.poe-code/config.json` runtime → spawn uses Docker automatically
19. E2E: spawn with mock runner verifies full config → runner → spawn flow

## Open questions

1. **Agent binary availability in container**: The Docker image must have the agent CLI installed
   (e.g., `claude` binary for claude-code). Should we document this as a requirement, or
   provide a base image / install step? With `dockerfile` support, the user controls this
   directly. For `image` mode, we could warn if the binary isn't found after container start.

2. **Env var passthrough**: Should all host env vars be forwarded to the container, or only
   specific ones (like `POE_API_KEY`)? Forwarding all could leak sensitive vars. Forwarding
   none breaks agent auth. Proposal: forward vars listed in the agent's spawn config +
   `runtime.env_passthrough` list in config.

3. **Image pull policy**: Should `poe-code` auto-pull the image if not present? Or require
   the user to pull manually? Auto-pull is convenient but slow on first run. (Only applies
   to `image` mode — `dockerfile` mode always builds locally.)

4. **Nested Docker**: If poe-code runs inside Docker and the project also wants Docker,
   should we detect and warn? Docker-in-Docker has known footguns.

5. **Build cache invalidation**: The content-hash approach caches well for Dockerfile changes,
   but won't detect changes to files copied via `COPY` unless the entire build context is hashed.
   Hashing a large build context could be slow. Proposal: hash Dockerfile + `.dockerignore` +
   `build_args` for the tag, rely on Docker's own layer cache for COPY invalidation.

## Non-goals

- Docker Compose integration (too complex, different abstraction level)
- Running process-launcher services via runtime config (separate concern)
- Kubernetes or other orchestrators
- Multi-stage build orchestration (user's Dockerfile handles this)
