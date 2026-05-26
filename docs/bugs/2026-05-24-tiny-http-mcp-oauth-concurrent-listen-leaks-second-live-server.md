# Tiny HTTP MCP OAuth concurrent listen leaks second live server

## Summary

`tiny-http-mcp-oauth-test-server` guards against a second `listen()` call only after a handle has already been stored. Two simultaneous `listen()` calls both pass that check and start independent OAuth/MCP listener pairs, but each returned `close()` function clears the shared `currentHandle` before closing its own pair. Closing the first handle consequently makes closing the second a no-op, leaving its protected HTTP server live.

## Reproduction

From the repository root, run a disposable Vitest probe that starts the same server instance twice concurrently, closes both returned handles, and checks reachability via Node HTTP requests:

```sh
cat > /tmp/tiny-http-mcp-oauth-concurrent-listen-probe.test.ts <<'EOF'
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createMcpOAuthTestServer } from "./index.js";

function reach(url: string): Promise<string> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(`reachable:${response.statusCode}`);
    });
    request.once("error", () => resolve("closed"));
  });
}

describe("MCP OAuth concurrent listen", () => {
  it("starts two listener pairs concurrently and leaks the second after both handles close", async () => {
    const server = createMcpOAuthTestServer({ autoApprove: true, scopes: ["mcp.read"] });
    const [first, second] = await Promise.all([
      server.listen({ port: 0, hostname: "127.0.0.1" }),
      server.listen({ port: 0, hostname: "127.0.0.1" })
    ]);
    const before = await Promise.all([reach(first.mcpUrl), reach(second.mcpUrl)]);
    await first.close();
    await second.close();
    const afterFirst = await reach(first.mcpUrl);
    const afterSecond = await reach(second.mcpUrl);
    console.log(JSON.stringify({ distinct: first.mcpUrl !== second.mcpUrl, before, afterFirst, afterSecond, first: first.mcpUrl, second: second.mcpUrl }));
    expect(first.mcpUrl).not.toBe(second.mcpUrl);
    expect(afterFirst).toBe("closed");
    expect(afterSecond).toMatch(/^reachable:/);
  });
});
EOF
cp /tmp/tiny-http-mcp-oauth-concurrent-listen-probe.test.ts packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Both concurrent handles start distinct reachable MCP endpoints. After calling both `close()` methods, the first endpoint is closed but the second endpoint still answers HTTP requests:

```text
{"distinct":true,"before":["reachable:401","reachable:401"],"afterFirst":"closed","afterSecond":"reachable:401","first":"http://127.0.0.1:61460/mcp","second":"http://127.0.0.1:61461/mcp"}
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > MCP OAuth concurrent listen > starts two listener pairs concurrently and leaks the second after both handles close
```

`packages/tiny-http-mcp-oauth-test-server/src/index.ts:166` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:191` check `currentHandle` only before asynchronous startup begins, without marking the server as starting. `packages/tiny-http-mcp-oauth-test-server/src/index.ts:286` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:313` then install each completed handle into the same state slot, and each handle's `close()` returns immediately whenever any prior close has already set that shared state to `null`.

## Expected Behavior

A single server instance should permit only one active or in-progress `listen()` operation, or every successfully returned handle should independently close its own listener pair regardless of other handle state.

## Impact

Tests and demos can leak OAuth-protected HTTP listeners, ports, and associated authorization-server resources after apparently complete cleanup. This can keep test processes alive, cause later port contention, or unintentionally expose a fixture endpoint longer than intended.
