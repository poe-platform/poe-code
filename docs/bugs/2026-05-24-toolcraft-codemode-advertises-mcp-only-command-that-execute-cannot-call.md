# Toolcraft codemode advertises MCP-only command that execute cannot call

## Summary

`toolcraft-codemode` exposes commands with either `mcp` or `sdk` scope through its `search` and `get_schemas` meta-tools, but its `execute` meta-tool calls those entries through a Toolcraft SDK that contains only `sdk`-scoped commands. An `mcp`-only command is therefore discoverable and has a returned schema, yet deterministically fails when the model invokes it through the advertised code-mode execution path.

## Reproduction

From the repository root, run a disposable Vitest probe that wraps a root containing one `mcp`-only command and exercises all three codemode meta-tools:

```sh
cat > /tmp/toolcraft-codemode-mcp-only-execute-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";

describe("codemode mcp-only command exposure", () => {
  it("advertises an MCP-only command that execute cannot invoke", async () => {
    const root = defineGroup({
      name: "ops",
      children: [
        defineCommand({
          name: "ping",
          description: "Visible MCP-only command",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => "pong"
        })
      ]
    });
    const sdk = createSDK(codeMode(root)) as {
      search(input: { query: string; detail: "full" }): Promise<Array<{ path: string }>>;
      getSchemas(input: { names: string[] }): Promise<Record<string, unknown>>;
      execute(input: { source: string }): Promise<unknown>;
    };

    const search = await sdk.search({ query: "ping", detail: "full" });
    const schemas = await sdk.getSchemas({ names: ["ping"] });
    const execution = await sdk.execute({
      source: 'import { ping } from "ops";\nreturn await ping({});'
    });

    console.log(JSON.stringify({ search, schemas, execution }));
    expect(search.map((entry) => entry.path)).toEqual(["ping"]);
    expect(schemas).toHaveProperty("ping");
    expect(execution).toMatchObject({
      ok: false,
      kind: "runtime",
      error: { message: 'SDK member "ping" is not callable.' }
    });
  });
});
EOF
cp /tmp/toolcraft-codemode-mcp-only-execute-probe.test.ts packages/toolcraft-codemode/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-codemode/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

`search` and `get_schemas` expose the `mcp`-only `ping` command, while `execute` returns a runtime failure instead of calling the command:

```text
{"search":[{"path":"ping","description":"Visible MCP-only command","schema":{"type":"object","properties":{},"required":[]}}],"schemas":{"ping":{"description":"Visible MCP-only command","params":{"type":"object","properties":{},"required":[]}}},"execution":{"ok":false,"kind":"runtime","error":{"message":"SDK member \"ping\" is not callable.","stack":"TypeError: SDK member \"ping\" is not callable.\n    at ping (line 2, column 14)"}}}
✓ packages/toolcraft-codemode/src/__probe__.test.ts > codemode mcp-only command exposure > advertises an MCP-only command that execute cannot invoke
```

`packages/toolcraft-codemode/src/tree.ts:24` through `packages/toolcraft-codemode/src/tree.ts:25` treat both `mcp` and `sdk` commands as programmatic entries, and `packages/toolcraft-codemode/src/index.ts:40` through `packages/toolcraft-codemode/src/index.ts:63` provide those same entries to `search`, `get_schemas`, and `execute`. However, `packages/toolcraft/src/sdk.ts:608` through `packages/toolcraft/src/sdk.ts:615` omit any command without `sdk` scope, while `packages/toolcraft-codemode/src/host-modules.ts:113` through `packages/toolcraft-codemode/src/host-modules.ts:122` attempt to invoke every advertised entry through that SDK and throw when the member is absent.

## Expected Behavior

Commands advertised by codemode's discovery and schema meta-tools should be callable through its `execute` meta-tool. Either `execute` should invoke `mcp`-scoped entries using an execution surface that supports them, or discovery should omit commands that the code-mode script runtime cannot call.

## Impact

An MCP client using codemode can select an exposed command, obtain its valid schema, generate a valid script, and still receive a guaranteed runtime error solely because the command was declared `mcp`-only. This makes codemode unreliable for valid Toolcraft MCP surfaces and wastes model calls on commands it advertises but cannot execute.
