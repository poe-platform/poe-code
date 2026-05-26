# Toolcraft codemode dotted group name collides with nested group path

## Summary

`toolcraft-codemode` builds discovery keys and agent-script module names by joining group segments with `.`. A valid group named `a.b` therefore receives the same codemode path as nested groups `a` then `b`. When both contain a command with the same name, `search` returns two indistinguishable command paths, while `get_schemas` and `execute` silently expose only one of them.

## Reproduction

From the repository root, run a disposable Vitest probe with one dotted group and one nested group that both provide `run`:

```sh
cat > /tmp/toolcraft-codemode-dotted-group-collision-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";

describe("codemode dotted group collision", () => {
  it("collapses a dotted group and nested groups into one code-mode path", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({ name: "a.b", children: [defineCommand({ name: "run", description: "dotted", scope: ["sdk"], params: S.Object({}), handler: async () => "dotted" })] }),
        defineGroup({ name: "a", children: [defineGroup({ name: "b", children: [defineCommand({ name: "run", description: "nested", scope: ["sdk"], params: S.Object({}), handler: async () => "nested" })] })] })
      ]
    });
    const sdk = createSDK(codeMode(root)) as {
      search(input: { query: string; detail: "full"; limit: number }): Promise<Array<{ path: string; description: string }>>;
      getSchemas(input: { names: string[] }): Promise<Record<string, { description: string }>>;
      execute(input: { source: string }): Promise<unknown>;
    };
    const search = await sdk.search({ query: "run", detail: "full", limit: 10 });
    const schemas = await sdk.getSchemas({ names: ["a.b.run"] });
    const execution = await sdk.execute({ source: 'import { run } from "a.b";\nreturn await run({});' });
    console.log(JSON.stringify({ search, schemas, execution }));
    expect(search.map(({ path, description }) => ({ path, description }))).toEqual([
      { path: "a.b.run", description: "dotted" },
      { path: "a.b.run", description: "nested" }
    ]);
    expect(schemas).toMatchObject({ "a.b.run": { description: "nested" } });
    expect(execution).toMatchObject({ ok: true, returnValue: "nested" });
  });
});
EOF
cp /tmp/toolcraft-codemode-dotted-group-collision-probe.test.ts packages/toolcraft-codemode/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-codemode/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Both distinct commands are advertised under the identical `a.b.run` path, but fetching that schema and invoking the corresponding module access only the later nested command:

```text
{"search":[{"path":"a.b.run","description":"dotted","schema":{"type":"object","properties":{},"required":[]}},{"path":"a.b.run","description":"nested","schema":{"type":"object","properties":{},"required":[]}}],"schemas":{"a.b.run":{"description":"nested","params":{"type":"object","properties":{},"required":[]}}},"execution":{"ok":true,"returnValue":"nested","stats":{"nodeVisits":5}}}
✓ packages/toolcraft-codemode/src/__probe__.test.ts > codemode dotted group collision > collapses a dotted group and nested groups into one code-mode path
```

`packages/toolcraft-codemode/src/tree.ts:52` through `packages/toolcraft-codemode/src/tree.ts:71` serialize the group segment array with `groupSegments.join(".")` and serialize command paths with another dot join, without escaping separators already present in a valid group name. `packages/toolcraft-codemode/src/host-modules.ts:78` through `packages/toolcraft-codemode/src/host-modules.ts:91` then parse those dot-separated paths into module names, causing both trees to share one module export slot and the later entry to overwrite the earlier one.

## Expected Behavior

Distinct Toolcraft command nodes should retain distinct codemode identities. Dotted group names must either be rejected for codemode trees or encoded so they cannot collide with nested group paths, and collisions should be reported instead of silently overriding one command.

## Impact

Valid programmatic commands can disappear from the executable codemode surface without an error. A model can discover two tools with the same path but receive only one schema and execute only one implementation, risking unintended operations when the hidden and selected commands perform different actions.
