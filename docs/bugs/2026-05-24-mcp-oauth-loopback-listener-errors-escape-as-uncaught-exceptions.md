# MCP OAuth loopback listener errors escape as uncaught exceptions

## Summary

The exported `mcp-oauth` loopback authorization session starts its callback HTTP listener without handling listener `error` events. If local callback binding fails, `createLoopbackAuthorizationSession()` does not reject through its promise API; the HTTP server instead emits an uncaught exception into the embedding MCP client process.

## Reproduction

From the repository root, run this isolated passing probe with an injected loopback server that emits a normal asynchronous bind failure:

```sh
cat > /tmp/mcp-oauth-bind-error-probe.test.ts <<'EOF'
import { EventEmitter } from "node:events";
import type http from "node:http";
import { describe, expect, it } from "vitest";
import { createLoopbackAuthorizationSession } from "./index.js";

class FailingServer extends EventEmitter {
  listen(_port: number, _host: string, _callback: () => void): this {
    queueMicrotask(() => this.emit("error", Object.assign(new Error("address in use"), { code: "EADDRINUSE" })));
    return this;
  }
  address(): { port: number } { return { port: 0 }; }
  close(): this { return this; }
}

describe("mcp-oauth loopback listener failure", () => {
  it("emits an uncaught server error instead of rejecting session creation", async () => {
    const uncaught = new Promise<string>((resolve) => process.once("uncaughtException", (error) => resolve((error as Error).message)));
    const creation = createLoopbackAuthorizationSession({ createServer: () => new FailingServer() as unknown as http.Server });
    const observed = await Promise.race([
      uncaught.then((message) => ({ uncaught: message })),
      creation.then(() => ({ resolved: true }), (error: unknown) => ({ rejected: String(error) })),
      new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), 100))
    ]);
    console.log(JSON.stringify({ observed }));
    expect(observed).toEqual({ uncaught: "address in use" });
  });
});
EOF
cp /tmp/mcp-oauth-bind-error-probe.test.ts packages/mcp-oauth/src/__probe__.test.ts
trap 'rm -f packages/mcp-oauth/src/__probe__.test.ts /tmp/mcp-oauth-bind-error-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The exported session constructor causes a process-level uncaught exception rather than rejecting the returned promise:

```text
{"observed":{"uncaught":"address in use"}}
✓ packages/mcp-oauth/src/__probe__.test.ts > mcp-oauth loopback listener failure > emits an uncaught server error instead of rejecting session creation
```

`packages/mcp-oauth/src/client/loopback-authorization.ts:43` constructs a promise that resolves from only the `server.listen(..., callback)` success callback. Because it never installs an `error` listener before starting the server, an HTTP listener bind failure is emitted as an unhandled EventEmitter error rather than being converted into the rejection channel of the exported constructor.

## Expected Behavior

`createLoopbackAuthorizationSession()` should reject with the callback-listener setup failure when its HTTP server cannot bind, allowing the MCP caller to surface or recover from the authentication error safely.

## Impact

MCP integrations starting browser authorization can terminate unexpectedly when local callback binding fails due to socket restrictions, runtime errors, or injected server behavior. Authentication callers cannot catch this failure from the public promise API and may crash instead of reporting a recoverable authorization problem.
