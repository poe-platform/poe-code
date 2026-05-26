# Pipeline plan proto MCP server disappears during parse

## Summary

The exported `@poe-code/pipeline` `parsePlan()` API cannot preserve a plan MCP server named `__proto__`. A valid YAML plan containing that server parses successfully, but the parsed `plan.mcp` object has no own `__proto__` entry; the configured server object is installed as its JavaScript prototype instead.

## Reproduction

From the repository root, add a disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePlan } from "./plan/parser.js";

describe("pipeline special MCP server names", () => {
  it("drops a declared __proto__ MCP server while parsing the plan", () => {
    const plan = parsePlan([
      "mcp:",
      "  __proto__:",
      "    command: custom-server",
      "tasks: []",
      ""
    ].join("\n"));

    expect(Object.hasOwn(plan.mcp ?? {}, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(plan.mcp ?? {})).toEqual({ command: "custom-server" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline special MCP server names > drops a declared __proto__ MCP server while parsing the plan
```

Remove the disposable probe after running it.

## Observed Behavior

`parsePlan()` accepts the YAML MCP entry and returns a plan whose `mcp` map does not contain an own `__proto__` server. Its prototype equals `{ command: "custom-server" }`. `parseMcpConfig()` in `packages/pipeline/src/plan/parser.ts` creates `result` as a normal object and writes parsed dynamic MCP names with `result[name] = server`, so the accepted special key triggers prototype mutation instead of preserving declared plan data.

## Expected Behavior

Plan parsing should preserve every accepted MCP declaration as an own entry in `plan.mcp`, including data keys such as `__proto__`, or reject unsupported server names during validation. Parsing a valid plan must not silently reinterpret a configured server as object prototype state.

## Impact

Pipeline plans can silently lose required MCP tool servers before execution begins. Runs based on those plans start without explicitly configured tools while parsing reports no error, and the parsed configuration object carries attacker- or author-controlled prototype state.
