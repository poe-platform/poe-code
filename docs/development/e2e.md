# E2E development

This repo uses `@poe-code/e2e-test-runner` with three backends:

| Backend   | Default usage   | Isolation model                               | `container.home`         |
| --------- | --------------- | --------------------------------------------- | ------------------------ |
| `env`     | CI default      | Fresh HOME/XDG on the host                    | Temporary host directory |
| `sandbox` | Local default   | Fresh HOME/XDG on the host plus OS sandboxing | Temporary host directory |
| `podman`  | Explicit opt-in | Persistent rootless container                 | `/home/poe`              |

Backend resolution order:

1. `E2E_BACKEND=env|sandbox|podman`
2. `CI`: `env`
3. local machine: `sandbox`
4. if the sandbox runtime is unavailable locally, fall back to `env`

No Docker Desktop or Colima setup is required.

## Prerequisites

### Common

- `POE_API_KEY` must be available
- `node`, `npm`, and `uv` must be on `PATH`

### `env`

No extra runtime requirements.

### `sandbox`

- macOS: `sandbox-exec`
- Linux: `bwrap` / bubblewrap
- Supported on macOS and Linux only

### `podman`

- `podman` installed
- `podman info` succeeds
- `E2E_PODMAN_IMAGE` set when using the podman backend, unless you pass `image` manually to the low-level container factory

## Running e2e tests locally

Run the suite with the local default backend:

```bash
npm run e2e
```

That uses the `sandbox` backend locally when the sandbox runtime is available. If it is not available, the runner falls back to `env`.

### Override the backend

```bash
E2E_BACKEND=env npm run e2e
E2E_BACKEND=sandbox npm run e2e
E2E_BACKEND=podman E2E_PODMAN_IMAGE=poe-code-e2e:local npm run e2e
```

Useful variants:

```bash
npm run e2e:verbose
npm run e2e:cleanup
npm run e2e:cleanup:aggressive
```

`npm run e2e:cleanup` is backend-aware:

- `podman`: removes orphaned containers, removable images, and the local cache
- `env` / `sandbox`: clears the local e2e cache only

## Test structure

Prefer `useContainer()` for new tests. It creates a fresh backend-aware container before each test, logs in automatically, and destroys it after each test.

```typescript
import { describe, expect, it } from "vitest";
import { useContainer } from "@poe-code/e2e-test-runner";

describe("claude-code", () => {
  const container = useContainer({ testName: "claude-code" });

  it("configure and test", async () => {
    const result = await container.exec("poe-code configure claude-code --yes");
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/.claude/settings.json`);

    const testResult = await container.exec("poe-code test claude-code");
    expect(testResult).toSucceedWith("Tested Claude Code.");
  });
});
```

Always use `container.home` instead of hardcoding backend-specific home directories.

## Repo setup

The repo already wires preflight and matchers through the e2e Vitest config.

### `e2e/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

const e2ePackageSrc = path.resolve(__dirname, "../packages/e2e-test-runner/src");

export default defineConfig({
  test: {
    root: __dirname,
    testTimeout: 300000,
    hookTimeout: 300000,
    include: ["*.test.ts"],
    maxWorkers: 1,
    globalSetup: "./setup.ts",
    setupFiles: [path.join(e2ePackageSrc, "matchers.ts")]
  }
});
```

### `e2e/setup.ts`

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

`runPreflight()` checks only what the selected backend needs:

- `env`: API key, clean HOME, required host tools
- `sandbox`: `env` checks plus sandbox runtime
- `podman`: API key plus podman availability and daemon health

## Low-level container API

Use the low-level API only when you need manual lifecycle control:

```typescript
import { createBackendContainer, resolveBackend, setWorkspaceDir } from "@poe-code/e2e-test-runner";

setWorkspaceDir(process.cwd());
const container = await createBackendContainer(resolveBackend(), {
  testName: "manual-e2e"
});

try {
  await container.login();
  await container.execOrThrow("poe-code configure codex --yes");
} finally {
  await container.destroy();
}
```

If you explicitly need a podman-only container, `createContainer()` / `createPersistentContainer()` remain available, but new tests should prefer backend-aware APIs.

## Troubleshooting

### Missing API key

```text
Error: No API key available. Set POE_API_KEY environment variable.
```

Set the key and rerun:

```bash
export POE_API_KEY='your-api-key'
npm run e2e
```

### Sandbox backend unavailable

If local sandboxing is unavailable, either install the platform runtime or force a different backend:

```bash
E2E_BACKEND=env npm run e2e
E2E_BACKEND=podman E2E_PODMAN_IMAGE=poe-code-e2e:local npm run e2e
```

### Podman backend not configured

```text
Error: Podman image not configured. Pass options.image or set E2E_PODMAN_IMAGE.
```

Set `E2E_PODMAN_IMAGE` or use the low-level factory and pass `image` explicitly.
