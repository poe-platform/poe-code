# Agent MCP config OpenCode HTTP shape configures URL as a local command

## Summary

`@poe-code/agent-mcp-config` accepts remote HTTP MCP servers for OpenCode, but its OpenCode shape serializes an HTTP endpoint as a `type: "local"` server whose command array contains the URL. Instead of configuring a remote transport, it instructs OpenCode to execute an HTTPS URL as a local process command.

## Reproduction

Add the following temporary probe as `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { opencodeShape } from "./shapes.js";

describe("OpenCode HTTP MCP translation", () => {
  it("configures a remote HTTP endpoint as a local executable command", () => {
    const shaped = opencodeShape({
      name: "remote",
      config: { transport: "http", url: "https://mcp.example.test/rpc" }
    });

    console.log(JSON.stringify(shaped));
    expect(shaped).toEqual({
      type: "local",
      command: ["https://mcp.example.test/rpc"],
      enabled: true
    });
  });
});
```

Run:

```sh
npm exec vitest run -- packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"type":"local","command":["https://mcp.example.test/rpc"],"enabled":true}
✓ packages/agent-mcp-config/src/__probe__.test.ts > OpenCode HTTP MCP translation > configures a remote HTTP endpoint as a local executable command
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

`McpHttpServer` is a supported public configuration input in `packages/agent-mcp-config/src/types.ts`. When `opencodeShape()` sees such an input in `packages/agent-mcp-config/src/shapes.ts`, it returns `{ type: "local", command: [entry.config.url], enabled }`. This output represents process execution, not the supplied HTTP transport, so configuration writes a server entry that cannot connect as requested.

## Expected Behavior

An HTTP MCP input configured for OpenCode should be serialized using OpenCode's remote HTTP server form when supported, including transport-specific metadata, or rejected clearly if remote HTTP servers cannot be represented. A URL must not be silently rewritten into a local executable command.

## Impact

Any user attempting to configure a remote MCP endpoint for OpenCode receives a broken local-process configuration. At runtime, the tool cannot reach the remote MCP server and may instead attempt to spawn a nonsensical executable path, making OpenCode remote MCP configuration non-functional through this API.
