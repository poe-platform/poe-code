# Tiny HTTP MCP testing nodeFetch drops URLSearchParams request body

## Summary

The public `tiny-http-mcp-server/testing` `nodeFetch()` helper is typed to accept standard `RequestInit`, but silently drops a `URLSearchParams` request body. A POST using this valid Fetch body form reaches the server with an empty payload instead of the encoded form data.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { nodeFetch } from './testing.js';

describe('nodeFetch standard body repro', () => {
  it('drops URLSearchParams request bodies despite accepting RequestInit', async () => {
    let receivedBody = '';
    const server = http.createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        receivedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(204);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing address');

    try {
      await nodeFetch(`http://127.0.0.1:${address.port}/submit`, {
        method: 'POST',
        body: new URLSearchParams({ code: 'expected' }),
      });

      expect(receivedBody).toBe('');
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
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > nodeFetch standard body repro > drops URLSearchParams request bodies despite accepting RequestInit
```

## Observed Behavior

`nodeFetch(input, init)` exposes `init: RequestInit` at `packages/tiny-http-mcp-server/src/test-support.ts:23`. It creates and ends a Node request, but writes the body only when `init.body` is a string or `Uint8Array` at `packages/tiny-http-mcp-server/src/test-support.ts:86`. A standard `URLSearchParams` body is therefore ignored: the HTTP server receives an empty request even though the public helper resolves successfully with the response.

## Expected Behavior

A helper accepting `RequestInit` should transmit supported Fetch request bodies according to that contract, including `URLSearchParams`, or reject unsupported body representations clearly rather than converting them into successful empty requests.

## Impact

Authentication interoperability tests and HTTP MCP fixtures commonly submit form-encoded OAuth/token payloads using `URLSearchParams`. Tests using the exported helper can silently exercise empty-body server behavior instead of the intended request, generating misleading passing or failing results and hiding defects in request validation, credential exchange, or form parsing.
