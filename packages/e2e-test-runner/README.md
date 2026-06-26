# @poe-code/e2e-test-runner

Backend-aware e2e test runner for poe-code.

## Backends

The runner supports three isolation backends:

| Backend   | How commands run                                               | `container.home`         | Best fit                               | Extra prerequisites                                  |
| --------- | -------------------------------------------------------------- | ------------------------ | -------------------------------------- | ---------------------------------------------------- |
| `env`     | Directly on the host with a fresh HOME/XDG environment         | Temporary host directory | CI, fast host-based runs               | No extra runtime beyond the common prerequisites     |
| `sandbox` | On the host inside a sandbox with a fresh HOME/XDG environment | Temporary host directory | Local development default              | macOS: `sandbox-exec`; Linux: `bwrap`                |
| `podman`  | Inside a persistent rootless container                         | `/home/poe`              | Containerized debugging or parity runs | Podman installed and running, plus a container image |

### Backend selection

Backend resolution is:

1. `E2E_BACKEND=env|sandbox|podman`
2. `CI` → `env`
3. local machine → `sandbox`
4. if the sandbox runtime is unavailable locally, fall back to `env`

## Environment variables

| Variable            | Required    | Description                                                                                                                                      |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POE_API_KEY`       | Yes         | API key used by `container.login()` and preflight checks.                                                                                        |
| `E2E_BACKEND`       | No          | Force `env`, `sandbox`, or `podman`. Defaults to `env` in CI and `sandbox` locally, with local fallback to `env` when sandboxing is unavailable. |
| `E2E_PODMAN_IMAGE`  | Podman only | Default image for the `podman` backend. You can also pass `options.image`.                                                                       |
| `POE_SNAPSHOT_MODE` | No          | Snapshot mode for proxy-backed tests: `playback` or `record`.                                                                                    |
| `POE_SNAPSHOT_MISS` | No          | Snapshot miss behavior: `error`, `warn`, `passthrough`, or `record`.                                                                             |
| `E2E_VERBOSE`       | No          | Enables extra podman backend debug logging.                                                                                                      |

## Validation and isolation

- `POE_API_KEY` is read from the current environment each time credentials are resolved; blank or removed env values are not reused from cache.
- CLI proxy ports must be decimal integers.
- Snapshot proxy config accepts only supported `POE_SNAPSHOT_MISS` modes.
- File helpers reject paths outside the sandbox home and workspace.
- Linux sandbox setup mounts tmpfs before writable paths so `/tmp` homes stay visible.
- Proxy route matching is segment-aware and does not match sibling paths that merely share a prefix.

## Prerequisites

### Common prerequisites

All backends require:

- `node` on `PATH`
- `npm` on `PATH`
- `uv` on `PATH`
- `POE_API_KEY`

### Per-backend prerequisites

#### `env`

- No extra runtime prerequisites beyond the common list
- Best choice for CI

#### `sandbox`

- macOS: `sandbox-exec`
- Linux: `bwrap` / bubblewrap
- Supported on macOS and Linux only

#### `podman`

- `podman` installed
- `podman info` must succeed
- `E2E_PODMAN_IMAGE` set, or `options.image` passed to the podman container factory

## Quick start

### 1. Vitest setup

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
    maxWorkers: 1,
    globalSetup: ["./e2e/setup.ts"],
    setupFiles: ["@poe-code/e2e-test-runner/matchers"]
  }
});
```

### 2. Global setup

```typescript
import { runPreflight, formatPreflightResults } from "@poe-code/e2e-test-runner";

export async function setup(): Promise<void> {
  const { passed, results } = await runPreflight();
  console.error(formatPreflightResults(results));

  if (!passed) {
    throw new Error("Preflight checks failed");
  }
}
```

### 3. Write tests

`useContainer()` is the preferred API because it automatically creates a backend-aware container per test and destroys it in `afterEach`.

```typescript
import { describe, expect, it } from "vitest";
import { useContainer } from "@poe-code/e2e-test-runner";

describe("claude-code", () => {
  const container = useContainer({ testName: "claude-code" });

  it("configures the agent", async () => {
    const result = await container.exec("poe-code configure claude-code --yes");
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/.claude/settings.json`);
  });
});
```

## API

### `useContainer(options)`

Preferred Vitest helper.

| Option         | Type      | Required | Description                                  |
| -------------- | --------- | -------- | -------------------------------------------- |
| `testName`     | `string`  | Yes      | Stable name used for logs and snapshots.     |
| `workspaceDir` | `string`  | No       | Workspace root. Defaults to `process.cwd()`. |
| `useSnapshots` | `boolean` | No       | Enable proxy snapshot playback/recording.    |

### `createBackendContainer(backend, options?)`

Low-level factory when you want to manage lifecycle yourself.

```typescript
import { createBackendContainer, resolveBackend, setWorkspaceDir } from "@poe-code/e2e-test-runner";

setWorkspaceDir(process.cwd());
const container = await createBackendContainer(resolveBackend(), {
  testName: "manual-test"
});

try {
  await container.login();
  await container.execOrThrow("poe-code configure codex --yes");
} finally {
  await container.destroy();
}
```

### `ContainerOptions`

| Option         | Type      | Applies to   | Description                                                            |
| -------------- | --------- | ------------ | ---------------------------------------------------------------------- |
| `image`        | `string`  | `podman`     | Container image. Required for podman unless `E2E_PODMAN_IMAGE` is set. |
| `testName`     | `string`  | all backends | Label used for logs and snapshots.                                     |
| `useSnapshots` | `boolean` | all backends | Enable proxy snapshot playback/recording.                              |

### `Container` interface

Use `container.home` instead of hardcoding backend-specific home paths.

```typescript
interface Container {
  id: string;
  home: string;
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

Notes:

- `home` is a temporary host directory for `env` and `sandbox`
- `home` is `/home/poe` for `podman`
- `createContainer()` / `createPersistentContainer()` are podman-specific helpers; prefer `useContainer()` or `createBackendContainer(resolveBackend(), ...)` for backend-aware tests

## Useful commands

When used in this repo:

- `npm run e2e`
- `npm run e2e:verbose`
- `npm run e2e:cleanup`
- `npm run e2e:cleanup:aggressive`

`npm run e2e:cleanup` removes podman containers/images only when `E2E_BACKEND=podman`; for `env` and `sandbox` it clears the local e2e cache only.
