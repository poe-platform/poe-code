# Toolcraft schema OneOf discriminator field publishes input runtime rejects

## Summary

The exported `toolcraft-schema` `S.OneOf()` builder permits a branch to declare its own field using the configured discriminator key. JSON Schema serialization then replaces that declared field contract with the branch name literal, while runtime validation still enforces the original branch field schema. The resulting published contract can tell clients to send an input that the same schema rejects.

## Reproduction

From the repository root, create and run this disposable Vitest probe:

```sh
cat > packages/toolcraft-schema/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, toJsonSchema, validate } from "./index.js";

describe("oneOf discriminator branch field collision", () => {
  it("advertises an injected discriminator value that runtime rejects against the branch field", () => {
    const schema = S.OneOf({
      discriminator: "kind",
      branches: {
        text: S.Object({
          kind: S.Enum(["custom"] as const),
          value: S.String()
        })
      }
    });
    const published = toJsonSchema(schema);
    const advertisedInput = { kind: "text", value: "hello" };
    const result = validate(schema, advertisedInput);

    console.log(JSON.stringify({ published, result }));
    expect((published.oneOf?.[0] as { properties: { kind: { enum: string[] } } }).properties.kind.enum).toEqual(["text"]);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false ? result.issues[0]?.path : undefined).toEqual(["kind"]);
  });
});
EOF
npm exec -- vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
rm packages/toolcraft-schema/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"published":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["text"]},"value":{"type":"string"}},"required":["kind","value"]}]},"result":{"ok":false,"issues":[{"path":["kind"],"expected":"one of custom","received":"text","message":"Expected one of custom at kind, got text"}]}}
```

## Observed Behavior

A validly constructed `OneOf` schema has one branch named `text` whose object shape declares `kind: S.Enum(["custom"])`. Its serialized JSON Schema advertises that branch as requiring `kind: "text"`. Supplying exactly that advertised input to `validate()` fails with an issue at `kind`, because runtime validation still expects the branch-declared value `"custom"`.

`OneOf()` performs only a non-empty-branches check at `packages/toolcraft-schema/src/oneof.ts:20` through `packages/toolcraft-schema/src/oneof.ts:36`; it does not reject a branch object that already declares the selected discriminator. During serialization, `withInjectedDiscriminator()` in `packages/toolcraft-schema/src/index.ts:274` through `packages/toolcraft-schema/src/index.ts:295` spreads branch properties and then overwrites `[discriminator]` with an enum containing the branch name. During runtime validation, `walkOneOf()` selects the branch using the submitted discriminator and then calls `walkObject()` with an injected discriminator at `packages/toolcraft-schema/src/validate.ts:306` through `packages/toolcraft-schema/src/validate.ts:350`; however, `walkObject()` validates all declared branch fields first at `packages/toolcraft-schema/src/validate.ts:260` through `packages/toolcraft-schema/src/validate.ts:304`, so the original `kind: S.Enum(["custom"])` check rejects the serialized contract's `"text"` value before the injected property can normalize output.

## Expected Behavior

`S.OneOf()` should reject branches that declare the discriminator key themselves, or define one consistent conflict rule shared by JSON Schema emission and runtime validation. Every input advertised as satisfying a serialized `OneOf` branch should be accepted by `validate()` under the same schema object.

## Impact

Tool authors can successfully publish a discriminated tool-input schema that clients cannot satisfy in practice. MCP clients and generated forms may send the documented branch discriminator and receive validation failures from the server, making integrations appear broken even though they followed the emitted contract.
