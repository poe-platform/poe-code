# Tiny stdio MCP schema omits explicit proto property definition

## Summary

`tiny-stdio-mcp-server` accepts a tool input-schema definition containing an own field named `__proto__`, but `defineSchema()` stores output properties in a normal object. The generated MCP input schema marks `__proto__` as required while omitting its definition from `properties`, producing an inconsistent published tool contract.

## Reproduction

From the repository root, run a disposable Vitest probe that builds a schema definition with an explicit own `__proto__` property:

```sh
cat > /tmp/tiny-stdio-mcp-schema-proto-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { defineSchema } from "./schema.js";

describe("tiny stdio MCP schema __proto__", () => {
  it("requires an explicit __proto__ field but omits its schema definition", () => {
    const definition = Object.create(null) as Record<string, { type: "string" }>;
    definition["__proto__"] = { type: "string" };
    const schema = defineSchema(definition);
    console.log(JSON.stringify({ schema, ownsProto: Object.hasOwn(schema.properties ?? {}, "__proto__") }));
    expect(schema.required).toEqual(["__proto__"]);
    expect(Object.hasOwn(schema.properties ?? {}, "__proto__")).toBe(false);
  });
});
EOF
cp /tmp/tiny-stdio-mcp-schema-proto-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The emitted schema requires `__proto__` but publishes no own `properties.__proto__` entry:

```text
{"schema":{"type":"object","properties":{},"required":["__proto__"]},"ownsProto":false}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP schema __proto__ > requires an explicit __proto__ field but omits its schema definition
```

`packages/tiny-stdio-mcp-server/src/schema.ts:39` through `packages/tiny-stdio-mcp-server/src/schema.ts:59` initialize `properties` as `{}` and assign each declared field through `properties[key] = ...` while separately adding required names. Assignment at `__proto__` changes the plain object's prototype rather than creating an own schema field.

## Expected Behavior

Every accepted input-field definition should be emitted as an own JSON Schema `properties` entry, including special JavaScript property names, or unsupported definitions should be rejected before a contradictory schema is advertised.

## Impact

MCP tools built on this schema helper can expose required inputs that clients cannot discover or validate correctly from the server's own schema. Special-key fields silently disappear from the machine-readable tool contract.
