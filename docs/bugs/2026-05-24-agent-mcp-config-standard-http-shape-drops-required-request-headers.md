# Agent MCP config standard HTTP shape drops required request headers

## Summary

`@poe-code/agent-mcp-config` publicly accepts HTTP MCP server definitions with request headers, but its `standard` shape translation discards those headers entirely. Configuring an authenticated remote MCP server for standard-shape agents such as Claude Code, Claude Desktop, Kimi, or Codex writes only the endpoint string, leaving the configured client unable to present required authorization or routing headers.

## Reproduction

Add the following temporary probe as `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { standardShape } from "./shapes.js";

describe("standard HTTP MCP translation", () => {
  it("drops required HTTP request headers from the configured server", () => {
    const shaped = standardShape({
      name: "private",
      config: {
        transport: "http",
        url: "https://mcp.example.test/rpc",
        headers: { Authorization: "Bearer secret" }
      }
    });

    console.log(JSON.stringify(shaped));
    expect(shaped).toEqual({ command: "https://mcp.example.test/rpc" });
  });
});
```

Run:

```sh
npm exec vitest run -- packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"command":"https://mcp.example.test/rpc"}
✓ packages/agent-mcp-config/src/__probe__.test.ts > standard HTTP MCP translation > drops required HTTP request headers from the configured server
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The `McpHttpServer` input type in `packages/agent-mcp-config/src/types.ts` exposes optional `headers`, and `gooseShape()` preserves them for HTTP configurations in `packages/agent-mcp-config/src/shapes.ts`. In contrast, `standardShape()` handles HTTP entries by returning only `{ command: entry.config.url }`, silently dropping all supplied headers. The later configuration writer stores exactly that shaped result for standard-shape agents.

## Expected Behavior

When the SDK accepts an HTTP MCP server with headers, every supported target shape that claims to support that transport should either faithfully persist the headers in its target format or reject the unsupported configuration clearly before writing a non-functional server entry. It should not silently remove authentication metadata.

## Impact

Users configuring private remote MCP servers through standard-shape agents receive saved configurations that cannot authenticate to those servers. Tokens or tenant-routing headers appear accepted at configuration time but are absent at runtime, causing confusing failures and making authenticated remote MCP setup unreliable.
