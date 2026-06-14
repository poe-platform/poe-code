---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Apple container e2e runner

Add Apple `container` support as a first-class e2e isolation backend and runner engine for poe-code.

## 1. What we're building

Extend `@poe-code/e2e-test-runner` so local macOS developers can run poe-code e2e tests inside Linux containers managed by Apple's `container` CLI.

The end state is a fourth backend, tentatively named `apple-container`, that works through the existing backend-aware API:

- `useContainer({ testName })`
- `createBackendContainer(resolveBackend(), options)`
- `container.exec(command)`
- `container.login()`
- `container.fileExists(path)`
- `container.readFile(path)`
- `container.writeFile(path, content)`
- snapshot proxy helpers when enabled
- backend-aware cleanup and preflight

This backend is also the foundation for using Apple's `container` CLI as a runner engine beyond the e2e suite, where poe-code needs a persistent Linux execution environment on Apple silicon without requiring Docker Desktop, Colima, or Podman.

Confirmed upstream constraints:

- Apple's `container` is for creating and running Linux containers as lightweight virtual machines on a Mac.
- It consumes and produces OCI-compatible container images.
- It requires Apple silicon.
- It is supported on macOS 26.
- It requires the `container` system service to be started with `container system start`.
- The project is active and its public README says stability is only guaranteed within patch versions until 1.0; the current GitHub release shown during planning is `1.0.0`.

Confirmed repo constraints:

- Existing e2e backends are `env`, `sandbox`, and `podman`.
- The test author API should stay backend-aware; tests should not need to branch on the selected backend.
- `podman` currently owns the persistent container implementation details, including create/start/exec/cp/rm command construction, labels, cache mounts, snapshot copy, proxy startup, and cleanup.
- Adding Apple `container` cleanly requires an engine adapter boundary instead of adding provider-specific branches throughout tests or high-level e2e call sites.
- The package README and `docs/development/e2e.md` must be updated because packages must document env variables and config options they expose.

Explicit non-goals for the first implementation:

- Do not make Apple `container` the CI default, because GitHub-hosted CI is not guaranteed to provide Apple silicon macOS 26 with the service installed.
- Do not remove `env`, `sandbox`, or `podman`.
- Do not require test files under `e2e/` to know whether they are running on Apple `container`.
- Do not use Apple `container` on Linux or Intel macOS.
- Do not add GitHub workflow unit tests.
- Do not add branching by provider or agent; this is runner infrastructure, not provider behavior.

## 2. User-facing shape

### Default local behavior

On supported Apple machines, `npm run e2e` uses `apple-container` by default after the backend has passed the real e2e proof for this repo.

Backend resolution becomes:

1. `E2E_BACKEND=env|sandbox|podman|apple-container`
2. `CI` -> `env`
3. local Apple silicon macOS 26+ with a usable Apple `container` setup -> `apple-container`
4. local machine with host sandbox runtime -> `sandbox`
5. fallback -> `env`

"Usable Apple `container` setup" means:

- `process.platform === "darwin"`
- `process.arch === "arm64"`
- macOS major version is at least 26
- `container --version` succeeds
- the Apple `container` service is running or can be verified without prompting
- the e2e runner can resolve an image from `options.image`, `E2E_APPLE_CONTAINER_IMAGE`, or a built local runtime image

If any Apple-specific prerequisite is missing, unforced local runs continue through the existing `sandbox`/`env` path. If `E2E_BACKEND=apple-container` is explicit, missing prerequisites fail preflight with actionable messages.

### Commands

Run with the default backend:

```bash
npm run e2e
npm run e2e:verbose
```

Force Apple `container`:

```bash
E2E_BACKEND=apple-container npm run e2e:verbose
```

Use a prebuilt e2e image:

```bash
E2E_BACKEND=apple-container \
E2E_APPLE_CONTAINER_IMAGE=poe-code-e2e:local \
npm run e2e:verbose
```

Build the local runtime image with Apple `container`:

```bash
container build -t poe-code-e2e:local -f .poe-code/Dockerfile .
```

Clean up backend artifacts:

```bash
E2E_BACKEND=apple-container npm run e2e:cleanup
E2E_BACKEND=apple-container npm run e2e:cleanup:aggressive
```

### Preflight output

Successful forced run:

```text
Environment:
  backend:   apple-container
  workspace: /home/poe/workspace
  home:      /home/poe

Preflight checks:
  ✓ Apple container installed
  ✓ Apple container platform supported
  ✓ Apple container service running
  ✓ Apple container image available
  ✓ API key available
  ✓ Cleanup
```

Forced run with the service stopped:

```text
Preflight checks:
  ✓ Apple container installed
  ✓ Apple container platform supported
  ✗ Apple container service running: container system service is not running

Start the service:
  container system start
```

Local default run on Apple silicon where Apple `container` is not ready:

```text
Environment:
  backend:   sandbox
```

The fallback is silent except for the normal environment line, because the user did not explicitly ask for `apple-container`.

### Test author API

No e2e test changes are required for normal tests:

```typescript
import { describe, expect, it } from 'vitest';
import { useContainer } from '@poe-code/e2e-test-runner';

describe('codex', () => {
  const container = useContainer({ testName: 'codex' });

  it('configures the agent', async () => {
    const result = await container.exec('poe-code configure codex --yes');
    expect(result).toHaveExitCode(0);
    await expect(container).toHaveFile(`${container.home}/.codex/config.toml`);
  });
});
```

The same test runs under `env`, `sandbox`, `podman`, or `apple-container`.

### Low-level API

Manual lifecycle code remains backend-aware:

```typescript
import {
  createBackendContainer,
  resolveBackend,
  setWorkspaceDir,
} from '@poe-code/e2e-test-runner';

setWorkspaceDir(process.cwd());

const container = await createBackendContainer(resolveBackend(), {
  testName: 'manual-apple-container',
});

try {
  await container.login();
  await container.execOrThrow('poe-code configure codex --yes');
} finally {
  await container.destroy();
}
```

### Runner shape beyond e2e

The Apple `container` runner should use the same execution contract as the e2e backend:

- persistent Linux container per job
- workspace mounted at a stable path
- explicit `home`
- command execution through `exec`
- cleanup that removes the job container and best-effort prunes poe-code-owned artifacts

This keeps the e2e backend and the future runner from drifting into two separate lifecycle implementations.

## 3. Implementation details and technical decisions

### Autonomy audit

The executor must be able to run the implementation and proof commands without a human prompt in the middle.

Required local tools:

- `node`, `npm`, and `uv` stay required for all e2e backends.
- `container` is required only when `E2E_BACKEND=apple-container` is explicit, or when local default resolution chooses `apple-container`.
- `sw_vers` is used on macOS to read the product version. Do not infer macOS 26 from `os.release()`, because Darwin and macOS major versions differ.

Required credentials:

- `POE_API_KEY` is required for e2e, as today.
- No Apple registry credentials are required for the first implementation. The local e2e image is built from the checkout unless `E2E_APPLE_CONTAINER_IMAGE` is set.

Required services:

- The Apple `container` system service must already be running for explicit `E2E_BACKEND=apple-container`.
- The runner must not start the service automatically. `container system start` can require machine-level setup and should stay a documented setup command.
- Unforced local backend resolution treats a stopped service as "not usable" and falls through to `sandbox` or `env`.

Required network:

- Image builds need whatever `.poe-code/Dockerfile` needs, currently npm and apt-style package access depending on the chosen image.
- Tests that are not using snapshot playback need Poe API access.
- Snapshot playback behavior stays unchanged.

Required sample data:

- No new sample data is required.
- Snapshot tests continue to use `.snapshots/<testName>/`.

No human mid-run setup remains after preflight:

- Explicit `apple-container` either passes preflight or fails with setup instructions.
- Default local resolution chooses `apple-container` only after platform, service, and image readiness checks pass.

### Shared Apple container package

Create `packages/apple-container/` as a small private package for Apple `container` command construction and platform detection.

Purpose:

- Keep Apple `container` CLI details out of `e2e-test-runner` and `process-runner`.
- Avoid duplicating command shapes for `create`, `start`, `exec`, `copy`, `delete`, `build`, and image inspection.
- Keep the code testable with pure unit tests and mocked command runners.

Files:

- `packages/apple-container/package.json`
- `packages/apple-container/README.md`
- `packages/apple-container/tsconfig.json`
- `packages/apple-container/tsconfig.build.json`
- `packages/apple-container/src/index.ts`
- `packages/apple-container/src/platform.ts`
- `packages/apple-container/src/commands.ts`
- `packages/apple-container/src/images.ts`

Public signatures:

```typescript
export interface AppleContainerPlatform {
  supported: boolean;
  reason?: string;
  macosVersion?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: {
    env?: NodeJS.ProcessEnv;
    input?: string;
    cwd?: string;
  }): CommandResult | Promise<CommandResult>;
}

export function detectAppleContainerPlatform(runner?: CommandRunner): Promise<AppleContainerPlatform>;
export function buildAppleContainerCreateArgs(input: AppleContainerCreateArgs): string[];
export function buildAppleContainerExecArgs(containerId: string, command: string): string[];
export function buildAppleContainerWriteFileArgs(containerId: string, path: string): string[];
export function buildAppleContainerCopyArgs(source: string, destination: string): string[];
export function buildAppleContainerDeleteArgs(containerId: string): string[];
export function buildAppleContainerImageInspectArgs(image: string): string[];
export function buildAppleContainerBuildArgs(input: AppleContainerBuildArgs): string[];
```

`README.md` documents:

- environment variables: none exposed by this low-level package
- config options: none exposed by this low-level package
- supported platform: Apple silicon macOS 26+ with the Apple `container` service installed and running

### E2E backend integration

Add `apple-container` to `@poe-code/e2e-test-runner` as a real backend, not a special case in tests.

Files to change:

- `packages/e2e-test-runner/src/backend.ts`
- `packages/e2e-test-runner/src/types.ts`
- `packages/e2e-test-runner/src/preflight.ts`
- `packages/e2e-test-runner/src/cleanup.ts`
- `packages/e2e-test-runner/src/index.ts`
- `packages/e2e-test-runner/src/persistent-container.ts`
- `packages/e2e-test-runner/README.md`
- `packages/e2e-test-runner/package.json`
- `docs/development/e2e.md`
- `DEVELOPMENT.md`

New files:

- `packages/e2e-test-runner/src/apple-container-container.ts`
- `packages/e2e-test-runner/src/apple-container-image.ts`
- `packages/e2e-test-runner/src/apple-container-preflight.ts`
- `packages/e2e-test-runner/src/persistent-container-engine.ts`
- `packages/e2e-test-runner/src/podman-container-engine.ts`
- `packages/e2e-test-runner/src/apple-container-engine.ts`

Backend type:

```typescript
export type Backend = 'env' | 'sandbox' | 'podman' | 'apple-container';
```

Persistent engine boundary:

```typescript
interface PersistentContainerEngine {
  readonly kind: 'podman' | 'apple-container';
  create(args: string[], env: NodeJS.ProcessEnv): ExecResult;
  start(containerId: string): ExecResult;
  exec(containerId: string, command: string, options?: ExecOptions): ExecResult | Promise<ExecResult>;
  writeFile(containerId: string, path: string, content: string): ExecResult;
  copyToContainer(source: string, containerId: string, destination: string): ExecResult;
  remove(containerId: string): ExecResult;
  listPoeE2eContainers(): string[];
  removeImage(image: string): ExecResult;
  prune(options: { aggressive: boolean }): void;
}
```

`persistent-container.ts` becomes backend-neutral and receives a `PersistentContainerEngine`. Podman command specifics move to `podman-container-engine.ts`; Apple command specifics live in `apple-container-engine.ts`.

This is the main refactor that keeps test files from branching by backend.

### Apple e2e image resolution

Apple `container` should be local-default-capable, so it cannot require users to manually set an image for normal local runs.

Resolution order:

1. `options.image`
2. `E2E_APPLE_CONTAINER_IMAGE`
3. auto-built local e2e image from the current checkout

The auto-built image must exercise current code, not the latest published npm package.

Implementation:

- Build a temporary e2e image context under the existing e2e cache root.
- Run `npm pack --pack-destination <temp-context>` after the repo is built.
- Generate a minimal Dockerfile in the temp context that installs the packed `poe-code-*.tgz`.
- Use `container build -t poe-code-e2e:<hash> <temp-context>`.
- Hash inputs for the tag:
  - packed tarball bytes
  - generated Dockerfile bytes
  - selected base image string
  - Apple container backend version if available from `container --version`

No source files are copied into the image except the npm pack artifact. That avoids slow full-checkout image builds and keeps image cache identity tied to the package artifact.

Default base image:

```text
node:22-bookworm-slim
```

Generated e2e Dockerfile shape:

```Dockerfile
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY poe-code-*.tgz /tmp/poe-code.tgz
RUN npm install -g /tmp/poe-code.tgz
RUN npm install -g @openai/codex opencode-ai
```

Agent install commands can stay inside tests when tests are explicitly exercising install behavior. The generated e2e image only preinstalls dependencies needed to make the existing suite fast and deterministic.

Environment variables exposed by `@poe-code/e2e-test-runner`:

- `E2E_BACKEND=env|sandbox|podman|apple-container`
- `E2E_APPLE_CONTAINER_IMAGE=<image>`
- `E2E_APPLE_CONTAINER_BASE_IMAGE=<image>` for the auto-build base image
- `E2E_APPLE_CONTAINER_REBUILD=1` to force rebuilding the auto image
- existing `E2E_PODMAN_IMAGE`, `E2E_VERBOSE`, `POE_SNAPSHOT_MODE`, `POE_SNAPSHOT_MISS`

### Backend default resolution

`resolveBackend()` should stay deterministic and cheap.

Algorithm:

```typescript
export function resolveBackend(): Backend {
  const explicit = process.env.E2E_BACKEND;
  if (isBackend(explicit)) return explicit;
  if (explicit) throw new Error(`Unsupported E2E_BACKEND: ${explicit}`);
  if (process.env.CI) return 'env';
  if (isAppleContainerUsableSync()) return 'apple-container';
  return hasSandboxRuntime() ? 'sandbox' : 'env';
}
```

`isAppleContainerUsableSync()` performs only non-mutating checks:

- platform is `darwin`
- architecture is `arm64`
- `sw_vers -productVersion` major is `>= 26`
- `container --version` exits successfully
- `container list --format json` exits successfully

Image build readiness is checked in preflight and container creation, not in `resolveBackend()`, because building can take longer than a backend resolver should.

### Preflight behavior

For explicit `apple-container`, `runPreflight()` checks:

- platform support
- `container --version`
- `container list --format json` to prove the service is reachable
- image availability or auto-build capability
- API key
- orphan cleanup

For default `apple-container`, the same checks run after resolution. If they fail, that is a real failure because the backend has already been selected as usable.

Actionable failure examples:

- Unsupported platform: "Apple container backend requires Apple silicon macOS 26 or newer."
- Missing CLI: "Install Apple container from https://github.com/apple/container/releases."
- Service stopped: "Start the service: container system start."
- Build failed: include the failing `container build` stderr and the generated context path under the e2e cache root.

### Snapshot proxy behavior

The Apple backend mirrors the podman proxy model:

- create/start the test container
- copy snapshot fixtures into `/tmp/proxy-snapshots`
- start `proxy-server` inside the container with `container exec`
- set `POE_BASE_URL=http://localhost:3456` inside the test container
- read `/tmp/proxy-capture.jsonl` through `container exec`
- write snapshots through `container exec -i`

The first version keeps the proxy inside the test container, matching podman. If Apple `container` loopback semantics differ from Podman in practice, adjust only the Apple engine adapter so the `Container` interface remains unchanged.

### Cleanup behavior

`npm run e2e:cleanup` becomes backend-aware for `apple-container`.

Behavior:

- remove poe-code-owned Apple containers by label
- remove auto-built images named `poe-code-e2e:<hash>` when not in use
- prune stopped Apple containers
- aggressive cleanup also prunes Apple images and volumes that Apple `container` marks as unused
- clear the local e2e cache root when `clearLocalCache` is true

Apple command mapping:

- list: `container list --all --format json`
- delete container: `container delete --force <id>`
- delete image: `container image delete --force <image>`
- prune containers: `container prune`
- prune images: `container image prune --all`
- prune volumes: `container volume prune`

### Runtime runner integration

Add Apple `container` as a runtime backend for jobs, spawn, experiment, ralph, and any other code path using runtime overrides.

Runtime type:

```typescript
export type Runtime = 'host' | 'docker' | 'e2b' | 'apple-container';
```

Config shape:

```json
{
  "runtime": {
    "type": "apple-container",
    "image": "poe-code/local:abc123",
    "dockerfile": ".poe-code/Dockerfile",
    "build_context": ".",
    "build_args": {},
    "mounts": [],
    "cpus": 4,
    "memory": "4g",
    "extra_args": []
  }
}
```

Files to change:

- `packages/poe-code-config/src/runtime.ts`
- `packages/poe-code-config/src/types.compile-check.ts`
- `packages/poe-code-config/src/state/templates.ts`
- `packages/poe-code-config/README.md`
- `packages/process-runner/src/types.ts`
- `packages/process-runner/src/index.ts`
- `packages/process-runner/README.md`
- `src/sdk/types.ts`
- `src/cli/commands/runtime-options.ts`
- `src/cli/commands/runtime/shared.ts`
- `src/cli/commands/runtime/init.ts`
- `src/cli/commands/runtime/build.ts`
- runtime help snapshots under `src/cli/commands/__snapshots__/`

New files:

- `packages/process-runner/src/apple-container/apple-container-execution-env.ts`
- `packages/process-runner/src/apple-container/args.ts`
- `packages/process-runner/src/apple-container/template-build.ts`
- `packages/process-runner/src/apple-container/platform.ts`

Runtime factory:

```typescript
export const appleContainerExecutionEnvFactory: ExecutionEnvFactory = {
  type: 'apple-container',
  supportsDetach: true,
  open(spec): Promise<OpenedEnv>;
  attach(envId, context): Promise<OpenedEnv>;
};
```

The Apple runtime factory mirrors Docker runtime behavior:

- resolve image from `runtime.image`, or build from Dockerfile/build context
- create a long-lived detached container
- upload/download workspace through `container copy`
- execute commands with `container exec`
- support `shell()`
- support detach/attach through stored `reattachContext`
- close with `container delete --force`

Template cache:

```typescript
export type TemplateBackend = 'docker' | 'e2b' | 'apple-container';
```

Apple built images use a backend-specific cache key so Docker/Podman and Apple builds do not collide.

### CLI and SDK parity

Every runtime CLI flag that accepts `host|docker|e2b` must accept `apple-container`:

- `poe-code spawn --runtime apple-container`
- `poe-code runtime init --type apple-container --yes`
- `poe-code runtime build --runtime apple-container`
- SDK `spawn(..., { runtime: 'apple-container' })`
- SDK `experiment` and `ralph` runtime overrides

`--runtime-image` remains the image override for Docker-compatible image runtimes, including Apple `container`. Do not add `--apple-container-image`; the SDK and CLI should keep one image override concept.

`runtime init --type apple-container --yes` writes:

```json
{
  "runtime": {
    "type": "apple-container"
  }
}
```

It creates `.poe-code/Dockerfile` through the same default Dockerfile path used by Docker and E2B, unless `--no-dockerfile` is set.

### Edge cases

- macOS 26 beta/point release strings: parse only the leading numeric major from `sw_vers -productVersion`.
- `container` installed but service stopped: explicit preflight fails; default resolver falls through.
- image exists but is stale: `E2E_APPLE_CONTAINER_REBUILD=1` forces rebuild; runtime build has the existing `--force` path.
- Apple command output changes: command builders avoid parsing table output; use `--format json` where available.
- snapshot directory missing in playback mode: preserve existing behavior.
- `container copy` requires a running container: start the container before snapshot copy and workspace transfer.
- Apple `container` labels not filterable like Podman: list JSON and filter labels in TypeScript.
- interactive shell: pass `--interactive --tty` only for shell/TTY paths, not normal e2e `exec`.
- cleanup must only delete poe-code-owned containers/images identified by name prefix or label.
