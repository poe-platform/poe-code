# E2E Test Runner — Layered Isolation

## Problem

Docker on macOS requires a Linux VM (Colima/Docker Desktop), making e2e tests heavy and slow to start. Different environments need different isolation levels — CI just needs HOME isolation, local dev benefits from kernel sandboxing, and full container isolation should remain an option.

## Approach: Isolation Layers

Four isolation backends, ordered lightest to heaviest. Each layer builds on the guarantees of the previous:

```
Layer 1: env        — HOME/XDG isolation only (env vars + temp dir)
Layer 2: sandbox    — Kernel-enforced write restrictions (sandbox-exec / bwrap)
Layer 3: podman     — Rootless containers via Podman
Layer 4: docker     — Docker containers (remove)
```

### Defaults

| Environment | Default backend | Why |
|---|---|---|
| CI (`CI=true`) | `env` | Fast, sufficient — CI runners are already ephemeral |
| Local dev | `sandbox` | Protects real HOME without needing a container runtime |

Override via `E2E_BACKEND=env|sandbox|podman|docker`.

### Per-Test Fresh State Guarantee

Every test gets a completely fresh, empty HOME directory. This is non-negotiable across all backends:

- **beforeEach**: `mkdtemp` creates a new temp dir → becomes `$HOME` for that test
- **afterEach**: `rm -rf` the temp dir — no state survives between tests
- **No shared cache mounts** — unlike Docker where npm/uv caches were shared across tests, each test starts from zero. If agent install is too slow, we pre-install into the workspace `node_modules/.bin` (which is read-only shared), not into the per-test HOME.
- **Preflight validation per test** — after creating the fresh HOME, verify it's truly clean before running the test command

This matches the current Docker behavior (fresh container per test) but without the startup cost.

## Layer 1: `env` — HOME/XDG Isolation

The lightest layer. Creates a temp directory, points HOME and XDG dirs at it, runs the process directly. No kernel enforcement — relies on the process being well-behaved.

### Agent Config Directory Override

Each agent resolves its config dir differently:

| Agent | Default config dir | Override env var | `HOME` sufficient? |
|---|---|---|---|
| Claude Code | `~/.claude` | `CLAUDE_CONFIG_DIR` | Yes — `homedir()` reads `$HOME` |
| Codex | `~/.codex` | `CODEX_HOME` | Yes — `dirs` crate reads `$HOME` |
| OpenCode | `$XDG_CONFIG_HOME/opencode` | `XDG_CONFIG_HOME` | No — on macOS `xdg-basedir` returns `~/Library/Application Support/opencode` |
| Goose | `~/.config/goose` | `GOOSE_PATH_ROOT` | Yes — `etcetera` 0.11 uses `std::env::home_dir()` which reads `$HOME` first |
| Kimi | `~/.kimi` | `KIMI_SHARE_DIR` | Yes — `Path.home()` reads `$HOME` |

**Only OpenCode needs explicit `XDG_CONFIG_HOME`** — all others derive config from `$HOME`.

### Env vars per test

```typescript
{
  HOME: sandboxHome,
  XDG_CONFIG_HOME: `${sandboxHome}/.config`,      // OpenCode on macOS
  NPM_CONFIG_PREFIX: `${sandboxHome}/.npm-global`, // global npm installs
  PATH: `${sandboxHome}/.local/bin:${sandboxHome}/.npm-global/bin:<workspace>/node_modules/.bin:${process.env.PATH}`,
}
```

### Preflight Checks (per test, after mkdtemp)

Validate the fresh HOME before running the test command:

1. **HOME is empty** — the just-created temp dir has no files (sanity check)
2. **No agent config leaking** — `$HOME/.config/` doesn't exist yet (confirms env isolation is working)
3. **API key available** — `POE_API_KEY` env var is set
4. **Required tools on PATH** — node, npm, uv

### exec()

```typescript
spawn(command, {
  env: {
    HOME: sandboxHome,
    XDG_CONFIG_HOME: `${sandboxHome}/.config`,
    NPM_CONFIG_PREFIX: `${sandboxHome}/.npm-global`,
    PATH: `${sandboxHome}/.local/bin:${sandboxHome}/.npm-global/bin:${workspace}/node_modules/.bin:${process.env.PATH}`,
    POE_API_KEY: apiKey,
  },
  cwd: workspace,
});
```

### File operations

Direct `fs.readFile()` / `fs.writeFile()` / `fs.existsSync()` — no container indirection.

### Cleanup

`rm -rf` the temp directory.

## Layer 2: `sandbox` — Kernel-Enforced Isolation

Everything from Layer 1, plus kernel-enforced write restrictions. The process cannot write outside the sandbox HOME, even if it tries.

### Platform Details

#### macOS: sandbox-exec (Seatbelt)

Built into macOS. Deprecated in docs but Apple's own services depend on the underlying Seatbelt subsystem — removal is extremely unlikely.

```bash
sandbox-exec -p '(version 1)
(deny default)
(allow process*)
(allow sysctl*)
(allow mach*)
(allow signal)
(allow file-read*)
(allow network*)
(allow file-write* (subpath "/tmp/poe-e2e-xyz"))
(allow file-write* (subpath "/dev"))
(allow file-write* (subpath "/private/var/folders"))
' env HOME=/tmp/poe-e2e-xyz sh -c "poe-code install goose"
```

- No install needed — ships with macOS
- No root needed
- ~0ms overhead

#### Linux: bubblewrap (bwrap)

Kernel namespace-based sandboxing, used by Flatpak.

```bash
bwrap \
  --ro-bind / / \
  --bind /tmp/poe-e2e-xyz /home/poe \
  --bind /tmp/poe-e2e-xyz /tmp/poe-e2e-xyz \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --setenv HOME /home/poe \
  --die-with-parent \
  -- sh -c "poe-code install goose"
```

- Needs install: `sudo apt-get install bubblewrap` (1 line in CI)
- No root to run (uses unprivileged user namespaces)
- ~2-5ms overhead
- Caveat: Ubuntu 24.04 restricts unprivileged user namespaces behind AppArmor

### Isolation Guarantees

```
┌──────────────────────────────────────────────────────────────┐
│ Kernel Sandbox                                               │
│                                                              │
│  ✅ Write to $SANDBOX_HOME/.config/goose/...  → ALLOWED     │
│  ✅ Write to $SANDBOX_HOME/.local/bin/...     → ALLOWED     │
│  ❌ Write to real ~/.config/...               → EPERM       │
│  ❌ Write to /etc/...                         → EPERM       │
│  ✅ Read /usr/local/bin/node                  → ALLOWED     │
│  ✅ Read repo source files                    → ALLOWED     │
│  ✅ Network (HTTPS to API)                    → ALLOWED     │
│  ✅ Child processes inherit sandbox           → YES         │
│  ❌ Symlink escape to real HOME               → DENIED      │
└──────────────────────────────────────────────────────────────┘
```

## Layer 3: `podman` — Rootless Containers

Full OCI container isolation using Podman. Rootless by default, no daemon required.

Uses the existing Dockerfile and container logic, but with `podman` instead of `docker`. The current `engine.ts` already detects podman — this layer formalizes it as a distinct backend choice rather than a transparent docker swap.

## Layer 4: `docker` — Remove

The current Docker backend (Docker Desktop / Colima). Remove this entirely — Podman covers the same use case without the VM overhead. Removing Docker simplifies the codebase (no Colima context management, no Docker Desktop auto-start, no daemon checks).

## Container Interface

The `Container` interface stays the same. All backends implement it:

```typescript
interface Container {
  id: string;
  home: string;  // new: path to sandbox HOME
  destroy(): Promise<void>;
  exec(command: string): Promise<ExecResult>;
  execOrThrow(command: string): Promise<ExecResult>;
  login(): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  proxyLog(): Promise<string | null>;
  requests(): Promise<CapturedRequests>;
  writeSnapshots(snapshots: Array<{ key: string; response: unknown }>): Promise<void>;
}
```

Key change: add `home: string` so tests don't hardcode `/home/poe`.

## Backend Selection

```typescript
type Backend = 'env' | 'sandbox' | 'podman' | 'docker';

function resolveBackend(): Backend {
  const explicit = process.env.E2E_BACKEND;
  if (explicit) return explicit as Backend;
  if (process.env.CI) return 'env';
  return 'sandbox';
}
```

## Implementation Plan

### Phase 1: Package rename + `home` on Container

Rename `@poe-code/e2e-docker-test-runner` → `@poe-code/e2e-test-runner`.

**Directory**: `packages/e2e-docker-test-runner/` → `packages/e2e-test-runner/`

**Update references** (mechanical find-and-replace):
- `packages/e2e-test-runner/package.json` — name field
- `package.json` — dependency + npm script paths (e2e:cleanup, e2e:logs)
- `e2e/vitest.config.ts` — alias paths
- `e2e/tsconfig.json` — path aliases + includes
- `e2e/setup.ts` — import
- `e2e/*.test.ts` (5 files) — imports
- `packages/e2e-test-runner/src/image.ts` — BUILD_TARBALLS tarball name
- `e2e.Dockerfile` — COPY/install/rm references
- `docs/development/e2e.md` — package name in examples

Add `home: string` to `Container` interface. Return `'/home/poe'` from the existing Docker/Podman backends. Replace hardcoded `/home/poe` in tests with `container.home`.

### Phase 2: Backend abstraction

New file: `packages/e2e-test-runner/src/backend.ts`

```typescript
type Backend = 'env' | 'sandbox' | 'podman' | 'docker';

function resolveBackend(): Backend;

async function createBackendContainer(
  backend: Backend,
  options: ContainerOptions
): Promise<Container>;
```

Update `use-container.ts` to call `createBackendContainer(resolveBackend(), options)` instead of `createContainer()` directly.

Existing `persistent-container.ts` becomes the `podman`/`docker` backend.

### Phase 3: `env` backend

New file: `packages/e2e-test-runner/src/env-container.ts`

Implements `Container` using:
- `mkdtemp` for sandbox HOME
- `spawn` with env overrides for `exec()`
- `fs.*` for file operations
- Preflight checks before first exec

Proxy server runs as a host process (same as today's Docker proxy, but on the host directly).

### Phase 4: `sandbox` backend

New file: `packages/e2e-test-runner/src/sandbox.ts`

Platform-specific command builder:

```typescript
interface SandboxConfig {
  home: string;
  writablePaths: string[];
  env: Record<string, string>;
}

function buildSandboxCommand(config: SandboxConfig, command: string): { bin: string; args: string[] };
```

New file: `packages/e2e-test-runner/src/sandbox-container.ts`

Same as `env-container.ts` but wraps `exec()` through `buildSandboxCommand()`.

### Phase 5: Remove Docker backend

Delete:
- `packages/e2e-test-runner/src/context.ts` (Colima context management)
- `packages/e2e-test-runner/src/image.ts` (image building/caching)
- `packages/e2e-test-runner/e2e.Dockerfile`
- Colima auto-start logic from `preflight.ts`
- Docker Desktop auto-start logic from `preflight.ts`

Keep `engine.ts` for podman detection only.

### Phase 6: CI workflow update

```yaml
# .github/workflows/pr-checks-pr.yml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - run: npm ci
    - name: Install prerequisites
      run: curl -LsSf https://astral.sh/uv/install.sh | sh
    - run: npm run e2e:verbose
      env:
        POE_API_KEY: ${{ secrets.POE_API_KEY }}
        E2E_BACKEND: env
```

No bubblewrap needed in CI — `env` backend is sufficient.

### Phase 7: Preflight per backend

Update preflight to check based on selected backend:

| Check | env | sandbox | podman |
|---|---|---|---|
| API key available | ✅ | ✅ | ✅ |
| Agent not configured | ✅ | ✅ | - |
| node/npm/uv on PATH | ✅ | ✅ | - |
| sandbox-exec / bwrap available | - | ✅ | - |
| Podman installed + running | - | - | ✅ |

## Comparison

| Concern | docker (current) | env | sandbox | podman |
|---|---|---|---|---|
| Isolation | Container namespaces | Env vars only | Kernel sandbox | Container namespaces |
| Home isolation | Container filesystem | Temp dir | Write-restricted temp dir | Container filesystem |
| poe-code binary | `npm install -g` in image | Monorepo `node_modules/.bin` | Monorepo `node_modules/.bin` | `npm install -g` in image |
| Node/npm | Bundled in image | Host system | Host system | Bundled in image |
| `exec()` | `docker exec` | `spawn` with env | `sandbox-exec`/`bwrap` + `spawn` | `podman exec` |
| `readFile()` | `docker exec cat` | `fs.readFile()` | `fs.readFile()` | `podman exec cat` |
| Cleanup | `docker rm -f` | `rm -rf` temp dir | `rm -rf` temp dir | `podman rm -f` |
| Startup | ~2-3s per container | ~0ms | ~5ms | ~1-2s per container |
| VM required | Yes (macOS) | No | No | No (rootless) |
| CI install | Docker + Colima | Nothing | bubblewrap | podman |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| sandbox-exec removed from future macOS | Fall back to `env` on macOS — the preflight check detects this |
| bwrap AppArmor restriction on Ubuntu 24.04 | CI uses `env` backend, not `sandbox` — only affects local Linux devs |
| Host tool pollution (wrong node/npm version) | CI pins node version. Local dev: document prerequisites |
| Proxy port conflicts in parallel tests | Assign random ports per sandbox |
| macOS /private/var/folders path varies | Detect at runtime via `os.tmpdir()` |
| `env` backend has no write protection | Acceptable for CI (ephemeral runners). Local dev defaults to `sandbox` |

## Open Questions

1. Keep `podman` backend as escape hatch, or sunset after `sandbox` is validated?
2. Should the proxy server run inside the sandbox (Layer 2) or always on the host?
