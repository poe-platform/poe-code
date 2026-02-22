# E2E Test Library

`@poe-code/e2e-docker-test-runner` — persistent Docker containers for e2e testing with per-command assertions.

## Quick Start

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createContainer, setWorkspaceDir } from '@poe-code/e2e-docker-test-runner';
import type { Container } from '@poe-code/e2e-docker-test-runner';
import '@poe-code/e2e-docker-test-runner/matchers';

describe('my agent', () => {
  let container: Container;

  beforeAll(async () => {
    setWorkspaceDir('/path/to/repo');
    container = await createContainer({ testName: 'my-agent' });
    await container.login();
  });

  afterAll(async () => {
    await container?.destroy();
  });

  it('install', async () => {
    const result = await container.exec('poe-code install my-agent');
    expect(result).toHaveExitCode(0);
  });

  it('configure', async () => {
    const result = await container.exec('poe-code configure my-agent --yes');
    expect(result).toHaveExitCode(0);
    await expect(container).toHaveFile('/root/.my-agent/config.json');
  });

  it('test', async () => {
    const result = await container.exec('poe-code test my-agent');
    expect(result).toSucceedWith('MY_AGENT_OK');
  });
});
```

## API Reference

### `createContainer(options?): Promise<Container>`

Create and start a persistent Docker container.

```typescript
const container = await createContainer();
const container = await createContainer({ testName: 'codex' });
const container = await createContainer({ image: 'my-custom-image:latest' });
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.testName` | `string?` | — | Label for container identification |
| `options.image` | `string?` | auto-built `poe-code-e2e:<hash>` | Docker image to use |

The container runs `sleep 86400`, staying alive for the duration of the test suite. On creation it mounts the workspace, npm/uv caches, and sets `PATH` for agent binaries.

### `setWorkspaceDir(dir: string): void`

Set the host directory mounted at `/workspace` inside the container. Call before `createContainer()`.

```typescript
setWorkspaceDir(join(import.meta.dirname, '..'));
```

### Container Methods

#### `container.id: string`

The Docker container ID.

#### `container.exec(command: string): Promise<ExecResult>`

Execute a shell command inside the container via `docker exec ... sh -c '<command>'`.

Returns `{ exitCode, stdout, stderr }`. Does **not** throw on non-zero exit.

```typescript
const result = await container.exec('poe-code install codex');
// result.exitCode: 0
// result.stdout: "codex installed successfully"
// result.stderr: ""
```

#### `container.execOrThrow(command: string): Promise<ExecResult>`

Same as `exec`, but throws if `exitCode !== 0`.

```typescript
await container.execOrThrow('poe-code install codex');
// throws: Command failed: "poe-code install codex" (exit code 1)
//         <stderr output>
```

#### `container.login(): Promise<void>`

Run `poe-code login` using the API key from `POE_API_KEY`.

Throws if no API key is set.

```typescript
await container.login();
```

#### `container.fileExists(path: string): Promise<boolean>`

Check if a file exists inside the container (`test -f`). Returns `false` for directories.

```typescript
const exists = await container.fileExists('/root/.claude/settings.json');
```

#### `container.readFile(path: string): Promise<string>`

Read file contents from the container (`cat`). Returns trimmed string. Throws if the file doesn't exist.

```typescript
const config = await container.readFile('/root/.codex/config.toml');
const parsed = JSON.parse(await container.readFile('/root/.claude/settings.json'));
```

#### `container.writeFile(path: string, content: string): Promise<void>`

Write content to a file inside the container. Uses stdin piping for safe handling of special characters.

```typescript
await container.writeFile('/root/.config/test.json', JSON.stringify({ key: 'value' }));
```

#### `container.destroy(): Promise<void>`

Stop and remove the container (`docker rm -f`). Safe to call multiple times. Always call in `afterAll`.

```typescript
afterAll(async () => {
  await container?.destroy();
});
```

### Types

```typescript
interface ExecResult {
  exitCode: number;
  stdout: string;  // trimmed
  stderr: string;  // trimmed
}

interface ContainerOptions {
  image?: string;
  testName?: string;
}

interface Container {
  id: string;
  destroy(): Promise<void>;
  exec(command: string): Promise<ExecResult>;
  execOrThrow(command: string): Promise<ExecResult>;
  login(): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
```

## Matchers Reference

Import matchers via side-effect import or vitest `setupFiles`:

```typescript
// In test file:
import '@poe-code/e2e-docker-test-runner/matchers';

// Or in vitest.config.ts:
setupFiles: ['@poe-code/e2e-docker-test-runner/matchers']
```

All matchers print full context (exit code, stdout, stderr) on failure.

### ExecResult Matchers

#### `toHaveExitCode(code: number)`

Assert exact exit code.

```typescript
expect(result).toHaveExitCode(0);
```

Failure message:
```
expected exit code 0, got 1
  Exit code: 1
  stdout: npm warn deprecated ...
  stderr: Error: binary not found
```

#### `toSucceedWith(text: string)`

Assert exit code is 0 **and** stdout contains `text`.

```typescript
expect(result).toSucceedWith('CLAUDE_CODE_OK');
```

Failure message:
```
expected command to succeed with "CLAUDE_CODE_OK"
  exit code was 1 (expected 0), stdout does not contain "CLAUDE_CODE_OK"
  Exit code: 1
  stdout: (empty)
  stderr: Error: connection refused
```

#### `toFail()`

Assert exit code is non-zero.

```typescript
expect(result).toFail();
```

Failure message:
```
expected command to fail but it exited with code 0
  Exit code: 0
  stdout: success
  stderr: (empty)
```

#### `toFailWith(text: string)`

Assert exit code is non-zero **and** stderr contains `text`.

```typescript
expect(result).toFailWith('No API key');
```

Failure message:
```
expected command to fail with "No API key"
  command succeeded (exit code 0)
  Exit code: 0
  stdout: ok
  stderr: (empty)
```

#### `toHaveStdout(matcher: string | RegExp)`

Assert stdout contains string or matches regex.

```typescript
expect(result).toHaveStdout('installed');
expect(result).toHaveStdout(/v\d+\.\d+\.\d+/);
```

Failure message:
```
expected stdout to match /v\d+\.\d+\.\d+/
  Exit code: 0
  stdout: codex installed
  stderr: (empty)
```

#### `toHaveStderr(matcher: string | RegExp)`

Assert stderr contains string or matches regex.

```typescript
expect(result).toHaveStderr('warning');
expect(result).toHaveStderr(/deprecated/i);
```

Failure message:
```
expected stderr to match "warning"
  Exit code: 0
  stdout: ok
  stderr: (empty)
```

### Container Matchers (Async)

These matchers are async — use `await expect(...)`.

#### `toHaveFile(path: string)`

Assert a file exists in the container.

```typescript
await expect(container).toHaveFile('/root/.claude/settings.json');
```

Failure message:
```
expected container to have file "/root/.claude/settings.json"
```

#### `toHaveFileContaining(path: string, text: string)`

Assert a file exists **and** its content includes `text`.

```typescript
await expect(container).toHaveFileContaining('/root/.codex/config.toml', 'model_provider');
```

Failure message (file missing):
```
expected file "/root/.codex/config.toml" to contain "model_provider", but file does not exist
```

Failure message (text not found):
```
expected file "/root/.codex/config.toml" to contain "model_provider"
  Content: [api]
  base_url = "https://..."
```

## Examples

### Basic Flow

A standard agent test: login, install, configure, verify.

```typescript
describe('codex', () => {
  let container: Container;

  beforeAll(async () => {
    setWorkspaceDir(repoRoot);
    container = await createContainer({ testName: 'codex' });
    await container.login();
  });

  afterAll(async () => {
    await container?.destroy();
  });

  it('install', async () => {
    const result = await container.exec('poe-code install codex');
    expect(result).toHaveExitCode(0);
    const which = await container.exec('which codex');
    expect(which).toHaveExitCode(0);
  });

  it('configure', async () => {
    const result = await container.exec('poe-code configure codex --yes');
    expect(result).toHaveExitCode(0);
    await expect(container).toHaveFile('/root/.codex/config.toml');
    const config = await container.readFile('/root/.codex/config.toml');
    expect(config).toContain('model_provider');
  });

  it('test', async () => {
    const result = await container.exec('poe-code test codex');
    expect(result).toSucceedWith('CODEX_OK');
  });
});
```

### File Assertions

Read and parse config files after commands modify them.

```typescript
it('configure writes correct settings', async () => {
  await container.exec('poe-code configure claude-code --yes');

  await expect(container).toHaveFile('/root/.claude/settings.json');
  await expect(container).toHaveFileContaining('/root/.claude/settings.json', 'apiKeyHelper');

  const raw = await container.readFile('/root/.claude/settings.json');
  const config = JSON.parse(raw);
  expect(config).toHaveProperty('apiKeyHelper');
  expect(config).toHaveProperty('env.ANTHROPIC_BASE_URL');
});
```

### Error Handling

Use `execOrThrow` for setup steps that must succeed. Use `toFail` / `toFailWith` to assert expected failures.

```typescript
// Setup that must succeed — throws with full stderr on failure
await container.execOrThrow('poe-code install codex');

// Assert a command fails as expected
it('rejects invalid agent', async () => {
  const result = await container.exec('poe-code install nonexistent');
  expect(result).toFail();
  expect(result).toHaveStderr('not found');
});
```

### Isolated Flow

Test `--isolated` mode in a separate container to avoid state bleed.

```typescript
describe('codex isolated', () => {
  let container: Container;

  beforeAll(async () => {
    setWorkspaceDir(repoRoot);
    container = await createContainer({ testName: 'codex-isolated' });
    await container.login();
  });

  afterAll(async () => {
    await container?.destroy();
  });

  it('install', async () => {
    const result = await container.exec('poe-code install codex');
    expect(result).toHaveExitCode(0);
  });

  it('test --isolated', async () => {
    const result = await container.exec('poe-code test codex --isolated');
    expect(result).toSucceedWith('CODEX_OK');
  });
});
```

## Vitest Configuration

### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 300000,   // 5 min — agent installs are slow
    hookTimeout: 300000,   // 5 min — container creation + login
    maxWorkers: 1,         // serial — containers share Docker daemon
    globalSetup: './setup.ts',
    setupFiles: ['@poe-code/e2e-docker-test-runner/matchers'],
  },
});
```

### `setup.ts` (Global Setup)

Run preflight checks before all tests: verifies Docker is available and API key is set, cleans orphaned containers.

```typescript
import { runPreflight, formatPreflightResults } from '@poe-code/e2e-docker-test-runner';

export async function setup(): Promise<void> {
  const { passed, results } = await runPreflight();
  console.error(formatPreflightResults(results));
  if (!passed) {
    throw new Error('Preflight checks failed');
  }
}
```

### `createGlobalSetup` Factory

Alternative: use the built-in factory for log rotation and workspace setup.

```typescript
import { createGlobalSetup } from '@poe-code/e2e-docker-test-runner';

export default createGlobalSetup({
  logsDir: './e2e-logs',
  maxLogs: 50,
  workspaceDir: '/path/to/repo',
});
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `logsDir` | `string?` | — | Directory for log files (rotated automatically) |
| `maxLogs` | `number?` | `50` | Max log files to keep |
| `workspaceDir` | `string?` | — | Calls `setWorkspaceDir` if provided |

## Troubleshooting

### Docker not running

```
Error: Failed to create container: Cannot connect to the Docker daemon
```

Start Docker Desktop or the Docker daemon:

```bash
# macOS with Docker Desktop
open -a Docker

# macOS with Colima
colima start

# Linux
sudo systemctl start docker
```

### No API key

```
Error: No API key available. Set POE_API_KEY environment variable.
```

Export the API key before running tests:

```bash
export POE_API_KEY='your-api-key'
npm run e2e
```

### Container leak cleanup

If tests crash without calling `destroy()`, orphaned containers remain running. Clean them up:

```bash
docker ps -a --filter label=poe-e2e-test-runner=true
docker rm -f $(docker ps -aq --filter label=poe-e2e-test-runner=true)
```

The `runPreflight()` global setup also cleans orphaned containers automatically.

### Test timeouts

E2e tests are slow (agent installs download binaries over the network). Set generous timeouts:

```typescript
// vitest.config.ts
test: {
  testTimeout: 300000,  // 5 min per test
  hookTimeout: 300000,  // 5 min for beforeAll/afterAll
}
```

If a specific command hangs, debug by running it manually:

```bash
# List running test containers
docker ps --filter label=poe-e2e-test-runner=true

# Exec into a running container
docker exec -it <container-id> sh

# Run the command manually to see output in real time
poe-code install codex
```
