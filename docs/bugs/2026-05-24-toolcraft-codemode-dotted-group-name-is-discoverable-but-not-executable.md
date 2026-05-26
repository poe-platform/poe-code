# Toolcraft codemode dotted group name is discoverable but not executable

## Summary

`toolcraft-codemode` advertises commands contained beneath an SDK-scoped group whose name includes a dot, such as group `a.b` with command `run`, but cannot execute them. The code-mode module path flattens the dotted group name into `a.b`, then the SDK lookup interprets that string as two nested groups even when no such nesting exists.

## Reproduction

From the repository root, run a disposable Vitest probe with one command beneath a standalone dotted group name:

```sh
cat > /tmp/toolcraft-codemode-dotted-group-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";

describe("codemode dotted group", () => {
  it("advertises a command in a standalone dotted group but cannot execute it", async () => {
    const root = defineGroup({
      name: "root",
      children: [defineGroup({ name: "a.b", children: [defineCommand({ name: "run", description: "dotted group", scope: ["sdk"], params: S.Object({}), handler: async () => "dotted" })] })]
    });
    const sdk = createSDK(codeMode(root)) as {
      search(input: { query: string; detail: "full" }): Promise<Array<{ path: string }>>;
      getSchemas(input: { names: string[] }): Promise<Record<string, unknown>>;
      execute(input: { source: string }): Promise<unknown>;
    };
    const search = await sdk.search({ query: "run", detail: "full" });
    const schemas = await sdk.getSchemas({ names: ["a.b.run"] });
    const execution = await sdk.execute({ source: 'import { run } from "a.b";\nreturn await run({});' });
    console.log(JSON.stringify({ search, schemas, execution }));
    expect(search.map((entry) => entry.path)).toEqual(["a.b.run"]);
    expect(schemas).toHaveProperty("a.b.run");
    expect(execution).toMatchObject({ ok: false, kind: "runtime", error: { message: 'SDK member "a.b.run" is not callable.' } });
  });
});
EOF
cp /tmp/toolcraft-codemode-dotted-group-probe.test.ts packages/toolcraft-codemode/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-codemode/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The command is searchable and its schema is returned, but the corresponding module import fails to invoke the underlying SDK command:

```text
{"search":[{"path":"a.b.run","description":"dotted group","schema":{"type":"object","properties":{},"required":[]}}],"schemas":{"a.b.run":{"description":"dotted group","params":{"type":"object","properties":{},"required":[]}}},"execution":{"ok":false,"kind":"runtime","error":{"message":"SDK member \"a.b.run\" is not callable.","stack":"TypeError: SDK member \"a.b.run\" is not callable.\n    at run (line 2, column 14)"}}}
✓ packages/toolcraft-codemode/src/__probe__.test.ts > codemode dotted group > advertises a command in a standalone dotted group but cannot execute it
```

`packages/toolcraft-codemode/src/tree.ts:52` through `packages/toolcraft-codemode/src/tree.ts:71` encode group paths by joining raw group names with `.`. `packages/toolcraft-codemode/src/host-modules.ts:78` through `packages/toolcraft-codemode/src/host-modules.ts:87` preserve that dotted module path for the script surface, while `packages/toolcraft-codemode/src/host-modules.ts:99` through `packages/toolcraft-codemode/src/host-modules.ts:121` split the full command path by `.` during SDK invocation and look for nonexistent nested `a.b` SDK groups instead of the actual single SDK member generated from group `a.b`.

## Expected Behavior

Commands beneath valid dotted group names should remain executable through codemode, or codemode should reject names it cannot represent before listing them through its meta-tools.

## Impact

Any Toolcraft package that uses dot characters in a group name receives a code-mode interface that appears functional during discovery and schema generation but fails for every invocation of commands under that group.
