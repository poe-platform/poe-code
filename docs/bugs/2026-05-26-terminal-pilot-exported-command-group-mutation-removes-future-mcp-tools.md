# Terminal Pilot exported command group mutation removes future MCP tools

## Summary

The public `terminal-pilot/commands` `terminalPilotGroup` export contains a mutable `children` command array that is passed directly into `terminal-pilot-mcp` server construction. Removing `create-session` from the exported group before a server is created silently removes the public `create_session` MCP tool from that later server.

## Reproduction

Create a disposable probe at `packages/terminal-pilot-mcp/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { createMCPServer } from "toolcraft/mcp";
import { terminalPilotGroup } from "terminal-pilot/commands";

describe("public terminal pilot group mutation probe", () => {
  it("removes a built-in MCP tool after mutating the exported group", async () => {
    const originalChildren = terminalPilotGroup.children;
    terminalPilotGroup.children = terminalPilotGroup.children.filter(
      (child) => child.name !== "create-session"
    );

    try {
      const server = createMCPServer(terminalPilotGroup, {
        name: "terminal-pilot",
        version: "0.0.1",
        omitRootToolNamePrefix: true
      });
      const { client, cleanup } = await createSdkTestPair(server, () =>
        new McpClient({ clientInfo: { name: "probe", version: "1.0.0" } })
      );

      try {
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        expect(names).not.toContain("create_session");
      } finally {
        await cleanup();
      }
    } finally {
      terminalPilotGroup.children = originalChildren;
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/terminal-pilot-mcp/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-pilot-mcp/src/__probe__.test.ts
```

The probe passes, confirming that public command-tree mutation removes a later server's built-in terminal automation tool:

```text
✓ packages/terminal-pilot-mcp/src/__probe__.test.ts > public terminal pilot group mutation probe > removes a built-in MCP tool after mutating the exported group
```

## Observed Behavior

`terminalPilotGroup` is created from the built-in command list and publicly exported at `packages/terminal-pilot/src/commands/index.ts:38` through `packages/terminal-pilot/src/commands/index.ts:62`. The `terminal-pilot-mcp` entrypoint imports that same exported group and passes it into `runMCP()` at `packages/terminal-pilot-mcp/src/index.ts:1` through `packages/terminal-pilot-mcp/src/index.ts:10`. Toolcraft's MCP construction enumerates tools from the supplied group at `packages/toolcraft/src/mcp.ts:650` through `packages/toolcraft/src/mcp.ts:710`, with `createMCPServer()` and `runMCP()` receiving the group directly at `packages/toolcraft/src/mcp.ts:789` through `packages/toolcraft/src/mcp.ts:810`. The MCP package's own tool-surface test identifies `create_session` as a normally served command at `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:7` through `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:23` and `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:100` through `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:132`. After a caller assigns a filtered array to `terminalPilotGroup.children`, a subsequently created server no longer advertises `create_session`.

## Expected Behavior

Reading or composing against the public Terminal Pilot command definition must not allow unrelated code to change the built-in tools advertised by future MCP server instances. The exported group should be immutable or MCP startup should consume a private immutable/defensively cloned command definition, so all supported built-in tools remain available unless server configuration explicitly disables them.

## Impact

Any same-process plugin, test helper, or integration that modifies the exported command group can silently remove terminal-control capabilities from subsequently launched MCP servers. Agents may discover an incomplete tool set, fail to create sessions or execute expected automation flows, and diagnose the resulting missing capabilities as transport or deployment issues rather than prior in-process metadata mutation.
