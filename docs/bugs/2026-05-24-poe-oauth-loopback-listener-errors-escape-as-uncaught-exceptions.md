# Poe OAuth loopback listener errors escape as uncaught exceptions

## Summary

`poe-oauth` starts its local OAuth callback listener without observing the HTTP server's `error` event. If the loopback server cannot bind, such as due to an address or platform-level listener failure, `client.authorize()` does not reject with that setup error; instead the server emits an uncaught exception into the hosting process.

## Reproduction

From the repository root, run this isolated passing probe with a server implementation that asynchronously emits the standard bind failure shape:

```sh
cat > /tmp/poe-oauth-bind-error-probe.test.ts <<'EOF'
import { EventEmitter } from "node:events";
import type http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthClient } from "./oauth-client.js";

class FailingServer extends EventEmitter {
  listen(_port: number, _host: string, _callback: () => void): this {
    queueMicrotask(() => this.emit("error", Object.assign(new Error("address in use"), { code: "EADDRINUSE" })));
    return this;
  }
  address(): { port: number } { return { port: 0 }; }
  close(): this { return this; }
}

describe("poe-oauth loopback listener failure", () => {
  it("emits an uncaught server error instead of rejecting authorize", async () => {
    const client = createOAuthClient({
      clientId: "client",
      createServer: () => new FailingServer() as unknown as http.Server
    });
    const uncaught = new Promise<string>((resolve) => {
      process.once("uncaughtException", (error) => resolve((error as Error).message));
    });
    const authorize = client.authorize();
    const observed = await Promise.race([
      uncaught.then((message) => ({ uncaught: message })),
      authorize.then(() => ({ resolved: true }), (error: unknown) => ({ rejected: String(error) })),
      new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), 100))
    ]);
    console.log(JSON.stringify({ observed }));
    expect(observed).toEqual({ uncaught: "address in use" });
  });
});
EOF
cp /tmp/poe-oauth-bind-error-probe.test.ts packages/poe-oauth/src/__probe__.test.ts
trap 'rm -f packages/poe-oauth/src/__probe__.test.ts /tmp/poe-oauth-bind-error-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The authorization setup emits an uncaught server exception rather than settling `authorize()` through its returned promise:

```text
{"observed":{"uncaught":"address in use"}}
✓ packages/poe-oauth/src/__probe__.test.ts > poe-oauth loopback listener failure > emits an uncaught server error instead of rejecting authorize
```

`packages/poe-oauth/src/loopback-authorization.ts:39` creates a promise that resolves only from the `server.listen(..., callback)` success callback. No `error` listener is installed before calling `listen()`, so a Node HTTP server bind error follows EventEmitter's unhandled `error` behavior instead of rejecting loopback session creation or the public OAuth authorization operation.

## Expected Behavior

Failure to establish the local callback listener should reject the OAuth authorization setup promise with the listener error so callers can report or recover from the failed login attempt without process-level exceptions.

## Impact

OAuth login can crash a CLI or embedding application when loopback binding fails because of socket restrictions, mocked servers, or other listener errors. Callers cannot handle the failure through the documented promise API, and unattended processes may terminate rather than emitting an actionable authentication diagnostic.
