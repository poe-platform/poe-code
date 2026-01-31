# @poe-code/e2e-docker-test-runner

Docker-based e2e test runner for poe-code.

## Usage

### Vitest Configuration

Create `e2e/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
    maxConcurrency: 1,
    pool: 'forks',
    globalSetup: ['e2e/setup.ts'],
  },
});
```

### Global Setup

Create `e2e/setup.ts`:

```typescript
import { createGlobalSetup } from '@poe-code/e2e-docker-test-runner';

export default createGlobalSetup({
  logsDir: '.e2e-logs',
});
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { withContainer } from '@poe-code/e2e-docker-test-runner';

describe('poe-code install', () => {
  it('configures claude-code', async () => {
    await withContainer(async (c) => {
      await c.login();
      await c.execOrThrow('poe-code install claude-code');

      expect(await c.fileExists('~/.claude/settings.json')).toBe(true);
    }, { testName: 'claude-code-install' });
  });
});
```

## API

### `withContainer(fn, options?)`

Runs a test in an isolated Docker container.

- `fn`: Async function receiving a `Container` instance
- `options.image`: Docker image (default: `node:22`)
- `options.testName`: Name for log files

### Container Methods

- `exec(command)`: Execute command, returns `{ exitCode, stdout, stderr }`
- `execOrThrow(command)`: Execute command, throws on non-zero exit
- `login()`: Authenticate with poe-code API
- `fileExists(path)`: Check if file exists
- `readFile(path)`: Read file contents

### `createGlobalSetup(options?)`

Creates a Vitest globalSetup function that runs preflight checks.

- `options.logsDir`: Directory for test logs
- `options.maxLogs`: Maximum number of log files to keep (default: 50)

### `rotateLogs(logsDir, maxLogs?)`

Rotate old log files, keeping only the most recent N files.

- `logsDir`: Directory containing log files
- `maxLogs`: Maximum files to keep (default: 50)

Returns the number of files deleted.

### `cleanupOrphans()`

Manually clean up orphaned test containers.

### `runPreflight()`

Run preflight checks and return results.

## CLI Commands

When used with poe-code, the following npm scripts are available:

- `npm run e2e` - Run e2e tests
- `npm run e2e:cleanup` - Clean up orphaned containers
- `npm run e2e:logs` - View test logs
- `npm run e2e:logs -- <filter>` - View logs matching filter
- `npm run e2e:logs -- --follow` - Stream logs in real-time
- `npm run e2e:logs:rotate` - Manually rotate old logs
