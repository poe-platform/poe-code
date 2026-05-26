# Toolcraft codemode dotted command name is discoverable but not executable

## Summary

`toolcraft-codemode` accepts and advertises an SDK-scoped command whose name contains a dot, such as `read.secret`, but its execution adapter treats dots in the command path as nested SDK member separators. Even with no conflicting groups or commands, `search` and `get_schemas` expose the command while `execute` cannot invoke it.

## Reproduction

From the repository root, run a disposable Vitest probe with one dotted command name:

```sh
cat > /tmp/toolcraft-codemode-dotted-command-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";

describe("codemode dotted command", () => {
  it("advertises a lone dotted SDK command but cannot execute it", async () => {
    const root = defineGroup({
      name: "ops",
      children: [defineCommand({ name: "read.secret", description: "dotted command", scope: ["sdk"], params: S.Object({}), handler: async () => "secret" })]
    });
    const sdk = createSDK(codeMode(root)) as {
      search(input: { query: string; detail: "full" }): Promise<Array<{ path: string }>>;
      getSchemas(input: { names: string[] }): Promise<Record<string, unknown>>;
      execute(input: { source: string }): Promise<unknown>;
    };
    const search = await sdk.search({ query: "read.secret", detail: "full" });
    const schemas = await sdk.getSchemas({ names: ["read.secret"] });
    const execution = await sdk.execute({ source: 'import * as ops from "ops";\nreturn await ops["read.secret"]({});' });
    console.log(JSON.stringify({ search, schemas, execution }));
    expect(search.map((entry) => entry.path)).toEqual(["read.secret"]);
    expect(schemas).toHaveProperty("read.secret");
    expect(execution).toMatchObject({ ok: false, kind: "runtime", error: { message: 'SDK member "read.secret" is not callable.' } });
  });
});
EOF
cp /tmp/toolcraft-codemode-dotted-command-probe.test.ts packages/toolcraft-codemode/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-codemode/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The dotted command is returned by discovery and schema lookup, but execution fails with a missing SDK member error:

```text
{"search":[{"path":"read.secret","description":"dotted command","schema":{"type":"object","properties":{},"required":[]}}],"schemas":{"read.secret":{"description":"dotted command","params":{"type":"object","properties":{},"required":[]}}},"execution":{"ok":false,"kind":"runtime","error":{"message":"SDK member \"read.secret\" is not callable.","stack":"TypeError: SDK member \"read.secret\" is not callable.\n    at read.secret (line 2, column 14)"}}}
✓ packages/toolcraft-codemode/src/__probe__.test.ts > codemode dotted command > advertises a lone dotted SDK command but cannot execute it
```

`packages/toolcraft-codemode/src/tree.ts:65` through `packages/toolcraft-codemode/src/tree.ts:71` publish the command's raw dotted name as its codemode path. During execution, `packages/toolcraft-codemode/src/host-modules.ts:99` through `packages/toolcraft-codemode/src/host-modules.ts:121` split that path on every `.` and seek nested SDK members instead of accessing the actual SDK member generated from the command name.

## Expected Behavior

A valid SDK-scoped command advertised by codemode should be callable through `execute`, regardless of separator characters in its Toolcraft name, or codemode should reject unsupported names before advertising them.

## Impact

Packages using dotted command names receive a misleading codemode surface: models can find the tool and retrieve its schema, but every attempted invocation through the intended code-mode path fails at runtime even though the underlying SDK command exists.
