# Markdown reader smoke test rejects server advertised approval tools

## Summary

The Markdown Reader MCP server automatically exposes Toolcraft approval tools in addition to its `read` and `read_section` tools, and its unit test asserts that four-tool surface. However, the package's shipped MCP smoke test and acceptance fixture require the server to return exactly the two reader tools, so the documented verification path fails against the implemented server.

## Reproduction

From the repository root, run a disposable Vitest probe that starts the same MCP server configuration used by the package and evaluates the smoke script's exact two-tool assertion:

```sh
cat > /tmp/markdown-reader-tool-list-probe.test.ts <<'EOF'
import { createMCPServer } from "toolcraft/mcp";
import { describe, expect, it } from "vitest";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { markdownGroup } from "./mcp/group.js";

describe("markdown-reader smoke expectation", () => {
  it("lists approval tools in addition to the two tools accepted by the smoke script", async () => {
    const server = createMCPServer(markdownGroup, { name: "markdown-reader", version: "0.0.1", omitRootToolNamePrefix: true });
    const { client, cleanup } = await createSdkTestPair(server, () => new McpClient({ clientInfo: { name: "probe", version: "1" } }));
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
      const smokeExpected = ["read", "read_section"];
      const namesMatch = names.length === smokeExpected.length && smokeExpected.every((name, index) => names[index] === name);
      console.log(JSON.stringify({ names, smokeExpected, namesMatch }));
      expect(namesMatch).toBe(false);
    } finally { await cleanup(); }
  });
});
EOF
cp /tmp/markdown-reader-tool-list-probe.test.ts packages/markdown-reader/src/__probe__.test.ts
trap 'rm -f packages/markdown-reader/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-markdown-reader-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/markdown-reader/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-markdown-reader-probe.config.mjs --reporter verbose
nl -ba packages/markdown-reader/scripts/smoke-test.ts | sed -n '20,34p'
nl -ba packages/markdown-reader/src/mcp/tools.test.ts | sed -n '1,30p'
```

## Observed Behavior

The active MCP server returns four tool names, so the smoke script's two-tool equality check evaluates false:

```text
{"names":["approvals__list","approvals__show","read","read_section"],"smokeExpected":["read","read_section"],"namesMatch":false}
✓ packages/markdown-reader/src/__probe__.test.ts > markdown-reader smoke expectation > lists approval tools in addition to the two tools accepted by the smoke script
```

The smoke script requires exactly `read` and `read_section` in `packages/markdown-reader/scripts/smoke-test.ts:20` through `packages/markdown-reader/scripts/smoke-test.ts:34`. In contrast, the package MCP test explicitly expects `approvals__list` and `approvals__show` alongside those tools in `packages/markdown-reader/src/mcp/tools.test.ts:6` through `packages/markdown-reader/src/mcp/tools.test.ts:30`, reflecting the actual Toolcraft-created server behavior.

## Expected Behavior

The shipped smoke test and acceptance documentation should validate the actual intended server tool surface, or the server should be configured not to advertise tools that its own acceptance test forbids.

## Impact

Following the package's required MCP smoke verification yields a deterministic failure for the implemented server, blocking acceptance and creating contradictory guidance about which tools clients should expect to receive.
