# Poe OAuth repeated waitForResult hangs after session closes

## Summary

The exported `@poe-code/poe-oauth` client returns an authorization handle whose `waitForResult()` method remains callable after a successful result. The first invocation closes the loopback callback server in its `finally` block; a second invocation installs a new wait on that already-closed session and remains pending indefinitely when no further callback can arrive.

## Reproduction

Create a disposable Vitest probe at `packages/poe-oauth/src/__probe__.test.ts`:

```ts
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createOAuthClient } from "./oauth-client.js";

function createMockServer() {
  let requestHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | undefined;
  const server = {
    on: vi.fn((event: string, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) => {
      if (event === "request") requestHandler = handler;
      return server;
    }),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      callback();
      return server;
    }),
    close: vi.fn(() => server),
    address: vi.fn(() => ({ port: 54321 })),
  } as unknown as http.Server;
  return {
    server,
    callback(url: string) {
      requestHandler?.(
        { url } as http.IncomingMessage,
        { writeHead() {}, end() {} } as http.ServerResponse,
      );
    },
  };
}

describe("poe-oauth reusable authorization result", () => {
  it("starts a second wait after the loopback session has already been closed", async () => {
    const mock = createMockServer();
    const client = createOAuthClient({
      clientId: "client",
      createServer: () => mock.server,
      openBrowser: async () => mock.callback("/callback?code=first"),
      fetch: async () => new Response('{"api_key":"sk-ok"}', { status: 200 }),
    });
    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).resolves.toEqual({
      apiKey: "sk-ok",
      expiresIn: null,
    });

    let settled = false;
    void authorization.waitForResult().finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    console.log(JSON.stringify({
      closeCalls: (mock.server.close as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
      settled,
    }));
    expect(settled).toBe(false);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-oauth/src/__probe__.test.ts
```

The probe prints:

```text
{"closeCalls":1,"settled":false}
✓ packages/poe-oauth/src/__probe__.test.ts > poe-oauth reusable authorization result > starts a second wait after the loopback session has already been closed
```

## Observed Behavior

`packages/poe-oauth/src/oauth-client.ts` returns `waitForResult` as a normal reusable function. Each call invokes `loopbackSession.waitForCode(authorizationUrl)`, but every invocation also executes `loopbackSession.close()` in a `finally` block. After the first call successfully exchanges a callback code and closes the session, calling `waitForResult()` again registers a fresh wait through `packages/poe-oauth/src/loopback-authorization.ts` without restarting or validating the closed server. In the reproduction, the first result succeeds and closes once, while the second promise remains unsettled.

## Expected Behavior

An authorization result handle should either make `waitForResult()` idempotent by returning the original in-flight/completed result, or reject subsequent invocations immediately with a clear consumed-session error. It must not accept a repeat call that can only wait forever after its callback listener has already been torn down.

## Impact

Plugins, UI layers, or retry/error-reporting code that accidentally awaits a returned authorization more than once can hang indefinitely after login has already succeeded or failed. This leaks pending work and blocks authentication workflows with no recoverable signal, despite the public handle appearing reusable and method-based rather than one-shot.
