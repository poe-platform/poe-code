# Toolcraft schema JSON Schema omits explicit proto property

## Summary

`toolcraft-schema` permits object schemas to declare an own property named `__proto__`, but `toJsonSchema()` constructs its `properties` table as a plain object and assigns to that special key. The generated schema lists `__proto__` as required while silently omitting its property definition, producing a contradictory and incomplete JSON Schema document.

## Reproduction

From the repository root, run a disposable Vitest probe that creates a schema shape with an explicit own `__proto__` field and converts it to JSON Schema:

```sh
cat > /tmp/toolcraft-schema-json-schema-proto-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, toJsonSchema } from "./index.js";

describe("toolcraft-schema explicit proto JSON Schema", () => {
  it("omits an explicit __proto__ field from generated JSON Schema properties", () => {
    const shape = Object.create(null) as Record<string, ReturnType<typeof S.String>>;
    shape["__proto__"] = S.String();
    const json = toJsonSchema(S.Object(shape));
    console.log(JSON.stringify({ json, ownsProto: Object.hasOwn(json.properties ?? {}, "__proto__"), required: json.required }));
    expect(json.required).toEqual(["__proto__"]);
    expect(Object.hasOwn(json.properties ?? {}, "__proto__")).toBe(false);
  });
});
EOF
cp /tmp/toolcraft-schema-json-schema-proto-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The JSON Schema conversion includes the field in `required` but does not contain an own schema entry for that required field:

```text
{"json":{"type":"object","properties":{},"required":["__proto__"]},"ownsProto":false,"required":["__proto__"]}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema explicit proto JSON Schema > omits an explicit __proto__ field from generated JSON Schema properties
```

`packages/toolcraft-schema/src/index.ts:413` through `packages/toolcraft-schema/src/index.ts:429` build `properties` as a normal `{}` and assign `properties[key] = toJsonSchema(propertySchema)` while independently appending the key to `required`. Assignment at `__proto__` modifies the plain object's prototype instead of storing an own schema property.

## Expected Behavior

`toJsonSchema()` should serialize every declared object property as an own `properties` entry, including `__proto__`, or reject unsupported schema keys rather than generate a schema whose required-property list has no matching definition.

## Impact

Consumers publishing Toolcraft schemas to JSON Schema/MCP clients can emit incomplete contracts for accepted schema definitions. Clients see a required key with no declared schema, causing validation disagreement or making an intended input field impossible to describe reliably.
