# Terminal Pilot MCP README advertises prefixed tools that server does not expose

## Summary

The `terminal-pilot-mcp` README documents its public MCP tool names with a `terminal_` prefix, including `terminal_create_session`, `terminal_read_screen`, and `terminal_close_session`. The actual MCP server is configured with `omitRootToolNamePrefix: true` and serves unprefixed names such as `create_session`, `read_screen`, and `close_session` instead. Clients following the package documentation therefore invoke tool names that are not present on the running server.

## Reproduction

From the repository root, run a disposable Vitest probe that constructs the same Toolcraft MCP server configuration used by the package and compares its served tool list with the README's advertised `terminal_create_session` name:

```sh
cat > packages/terminal-pilot-mcp/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { createMCPServer } from "toolcraft/mcp";
import { terminalPilotGroup, type TerminalPilotRuntime } from "terminal-pilot/commands";

const runtime = {
  createSession: async (params) => ({ name: params.session ?? "s1", session: session(params.command) }),
  resolveSession: async () => ({ name: "s1", session: session("bash") }),
  closeSession: async () => ({ exitCode: 0, name: "s1" }),
  listSessions: async () => [{ name: "s1", session: session("bash") }]
} satisfies TerminalPilotRuntime;

function session(command: string) {
  return {
    id: "session-1", command, pid: 1234, exitCode: null,
    fill: async () => undefined, type: async () => undefined, press: async () => undefined,
    signal: async () => undefined, waitFor: async () => "matched", waitForExit: async () => 0,
    screen: async () => ({ lines: ["ready"], cursor: { row: 0, col: 5 }, size: { rows: 24, cols: 80 } }),
    history: async () => ["ready"], resize: async () => undefined, close: async () => 0
  };
}

describe("terminal-pilot-mcp documented tool names", () => {
  it("serves unprefixed tools instead of the README's terminal-prefixed names", async () => {
    const server = createMCPServer(terminalPilotGroup, {
      name: "terminal-pilot", version: "0.0.1", omitRootToolNamePrefix: true,
      services: { terminalPilotRuntime: runtime }
    });
    const { client, cleanup } = await createSdkTestPair(server, () => new McpClient({
      clientInfo: { name: "probe", version: "1" }
    }));
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      console.log(JSON.stringify({
        advertisesTerminalCreate: names.includes("terminal_create_session"),
        servesCreate: names.includes("create_session"),
        names
      }));
      expect(names).not.toContain("terminal_create_session");
      expect(names).toContain("create_session");
    } finally {
      await cleanup();
    }
  });
});
EOF
trap 'rm -f packages/terminal-pilot-mcp/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/terminal-pilot-mcp/src/__probe__.test.ts --reporter verbose
nl -ba packages/terminal-pilot-mcp/README.md | sed -n '86,112p;118,126p'
nl -ba packages/terminal-pilot-mcp/src/index.ts
nl -ba packages/terminal-pilot-mcp/src/mcp-tools.test.ts | sed -n '7,23p;100,132p'
```

## Observed Behavior

The live server tool list contains only the unprefixed terminal operations and the approval helpers; the README-advertised prefixed operation is absent:

```text
{"advertisesTerminalCreate":false,"servesCreate":true,"names":["create_session","fill","type","press_key","send_signal","wait_for","wait_for_exit","read_screen","read_history","resize","close_session","get_session","list_sessions","approvals__list","approvals__show"]}
✓ packages/terminal-pilot-mcp/src/__probe__.test.ts > terminal-pilot-mcp documented tool names > serves unprefixed tools instead of the README's terminal-prefixed names
```

The public tools table and example invocation use names such as `terminal_create_session` in `packages/terminal-pilot-mcp/README.md:86` through `packages/terminal-pilot-mcp/README.md:112` and `packages/terminal-pilot-mcp/README.md:118` through `packages/terminal-pilot-mcp/README.md:126`. The package entry point configures Toolcraft with `omitRootToolNamePrefix: true` in `packages/terminal-pilot-mcp/src/index.ts:4` through `packages/terminal-pilot-mcp/src/index.ts:10`. Its own server test confirms the resulting unprefixed names at `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:7` through `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:23` and `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:100` through `packages/terminal-pilot-mcp/src/mcp-tools.test.ts:132`.

## Expected Behavior

The documented MCP tool names should be callable on the shipped server. Either the server should expose the `terminal_*` names advertised to clients, or the package documentation and examples should consistently identify its actual unprefixed tool surface.

## Impact

Agents and integrations configured from the README receive tool-not-found failures for every documented terminal operation, preventing session creation and terminal automation until they independently inspect `tools/list` and discover undocumented names. This creates an avoidable public API break at the MCP boundary.
