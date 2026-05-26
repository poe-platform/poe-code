# Tiny HTTP MCP OAuth startup failure suppresses failed OAuth rollback

## Summary

`tiny-http-mcp-oauth-test-server` starts its embedded OAuth listener before attempting to start the protected MCP listener. If MCP startup rejects and closing the already-started OAuth listener also rejects, `listen()` discards that rollback failure through `Promise.allSettled()` and rethrows only the MCP startup error. The caller receives no handle for retrying the OAuth cleanup and no signal that its listener may still be live.

## Reproduction

Create the disposable probe `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const oauthClose = vi.hoisted(() => vi.fn());

vi.mock('../../mcp-oauth/dist/index.js', () => ({
  createJwksTokenVerifier: vi.fn(() => ({ verify: vi.fn() })),
}));
vi.mock('tiny-http-mcp-server', () => ({
  TokenVerificationError: class TokenVerificationError extends Error {},
  nodeFetch: vi.fn(),
  createTestMcpServer: vi.fn(() => ({
    listenHttp: vi.fn().mockRejectedValue(new Error('mcp listener failed')),
  })),
}));
vi.mock('tiny-oauth-test-server', () => ({
  createOAuthTestServer: vi.fn(() => ({
    issuer: 'http://127.0.0.1:4010/oauth',
    listen: vi.fn().mockResolvedValue({ close: oauthClose }),
  })),
}));

import { createMcpOAuthTestServer } from './index.js';

describe('MCP OAuth fixture failed startup rollback', () => {
  it('reports only MCP startup failure after OAuth rollback also rejects', async () => {
    oauthClose.mockRejectedValue(new Error('oauth rollback failed'));

    await expect(
      createMcpOAuthTestServer({
        issuer: 'http://127.0.0.1:4010/oauth',
        resource: 'http://127.0.0.1:4020/mcp',
      }).listen({ hostname: '127.0.0.1', port: 4020 }),
    ).rejects.toThrow('mcp listener failed');

    expect(oauthClose).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > MCP OAuth fixture failed startup rollback > reports only MCP startup failure after OAuth rollback also rejects
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`listenOnce()` assigns `oauthHandle` after the OAuth listener starts at `packages/tiny-http-mcp-oauth-test-server/src/index.ts:244` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:248`, and then awaits MCP listener startup at lines 268 through 282. Its failure handler builds cleanup operations, awaits `Promise.allSettled(closeOperations)`, and unconditionally throws the original startup error at lines 314 through 322. In the probe, MCP startup rejects with `mcp listener failed`, OAuth rollback rejects with `oauth rollback failed`, and the public `listen()` promise exposes only `mcp listener failed` despite invoking the failed rollback.

## Expected Behavior

When a partially started fixture cannot be rolled back, the public failure should preserve the cleanup failure, expose both errors, or return a recoverable cleanup handle. A rejected startup must not hide that an already-started OAuth listener failed to shut down.

## Impact

Transient startup conflicts or MCP listener failures can strand an OAuth authorization server or occupied port while callers diagnose only an unrelated MCP startup error. Because `listen()` never returned a handle, test suites and embedding code cannot retry the suppressed OAuth shutdown through the public API, causing resource leaks and misleading failure diagnostics.
