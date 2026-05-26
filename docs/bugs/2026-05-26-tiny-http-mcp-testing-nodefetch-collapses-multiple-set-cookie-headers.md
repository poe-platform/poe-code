# Tiny HTTP MCP testing nodeFetch collapses multiple Set-Cookie headers

## Summary

The public `tiny-http-mcp-server/testing` `nodeFetch()` helper collapses separate `Set-Cookie` response header fields into one comma-delimited value. Consumers using the Fetch `Headers.getSetCookie()` API therefore cannot observe the distinct cookies emitted by an HTTP fixture response.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { nodeFetch } from './testing.js';

describe('nodeFetch multi-cookie response repro', () => {
  it('loses separate Set-Cookie values exposed by the Fetch Headers API', async () => {
    const server = http.createServer((_request, response) => {
      response.setHeader('Set-Cookie', ['first=one; Path=/', 'second=two; Path=/']);
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing address');

    try {
      const response = await nodeFetch(`http://127.0.0.1:${address.port}/cookies`);

      expect(response.headers.getSetCookie()).toEqual(['first=one; Path=/, second=two; Path=/']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
EOF
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > nodeFetch multi-cookie response repro > loses separate Set-Cookie values exposed by the Fetch Headers API
```

## Observed Behavior

`nodeFetch()` receives Node response headers and copies array-valued headers into a web `Headers` instance using `value.join(", ")` at `packages/tiny-http-mcp-server/src/test-support.ts:37`. When the server emits two `Set-Cookie` fields, the returned response has `headers.getSetCookie()` equal to one merged entry, `['first=one; Path=/, second=two; Path=/']`, rather than two separately observable cookie values.

## Expected Behavior

The Fetch-compatible helper should preserve separate `Set-Cookie` response values so `Headers.getSetCookie()` returns one entry per cookie, or otherwise reject unsupported multi-value responses instead of silently corrupting response-header semantics.

## Impact

OAuth, session, and authentication fixture tests that rely on multiple cookies can observe a response shape that no longer represents what the server emitted. Cookie parsing, rotation, session establishment, and header-forwarding tests may fail misleadingly or pass against a collapsed value rather than validating real multi-cookie behavior.
