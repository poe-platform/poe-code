import { describe, expect, it } from "vitest";
import { S, validate, type AnySchema, type ValidationOptions } from "./index.js";

const noDefaults: ValidationOptions = { defaults: "none" };

describe("validation without applying defaults", () => {
  const fields: Array<{ name: string; schema: AnySchema }> = [
    { name: "string", schema: S.String({ default: "seed" }) },
    { name: "number", schema: S.Number({ default: 2 }) },
    { name: "boolean", schema: S.Boolean({ default: false }) },
    { name: "enum", schema: S.Enum(["first", "second"], { default: "first" }) },
    { name: "array", schema: S.Array(S.String(), { default: ["seed"] }) },
    { name: "object", schema: S.Object({ display_name: S.String() }, { default: { display_name: "seed" } }) },
    { name: "record", schema: { ...S.Record(S.String()), default: { entry: "seed" } } },
    { name: "JSON", schema: { ...S.Json(), default: null } }
  ];

  it.each(fields)("does not apply an omitted optional $name default", ({ schema }) => {
    expect(validate(S.Object({ value: S.Optional(schema) }), {}, noDefaults)).toEqual({ ok: true, value: {} });
  });

  it.each(fields)("does not apply an explicit undefined optional $name default", ({ schema }) => {
    expect(validate(S.Object({ value: S.Optional(schema) }), { value: undefined }, noDefaults)).toEqual({ ok: true, value: {} });
  });

  it.each(fields)("still requires an omitted non-optional $name field", ({ schema }) => {
    expect(validate(S.Object({ value: schema }), {}, noDefaults).ok).toBe(false);
  });

  it("does not read an unused nested default", () => {
    const child = S.Number({ default: 2, maximum: 10 });
    const schema = S.Object({ visible_name: S.String(), optional_count: S.Optional(child) });
    child.default = 20;
    const value = { visible_name: "present" };

    expect(validate(schema, value, noDefaults)).toEqual({ ok: true, value });
    expect(validate(schema, value).ok).toBe(false);
    expect(value).toEqual({ visible_name: "present" });
  });

  it("retains optional undefined array entries without inserting defaults", () => {
    const schema = S.Array(S.Optional(S.String({ default: "seed" })));
    expect(validate(schema, [undefined, "given"], noDefaults)).toEqual({ ok: true, value: [undefined, "given"] });
  });

  it("propagates through records and nested optional wrappers", () => {
    const schema = S.Record(S.Object({ value: S.Optional(S.Optional(S.String({ default: "seed" }))) }));
    expect(validate(schema, { first: {}, second: {} }, noDefaults)).toEqual({ ok: true, value: { first: {}, second: {} } });
  });

  it.each(["oneOf", "union"] as const)("propagates through %s branches", (kind) => {
    const left = S.Object({ left: S.String(), count: S.Optional(S.Number({ default: 2 })) });
    const right = S.Object({ right: S.String() });
    const schema = kind === "oneOf" ? S.OneOf({ discriminator: "kind", branches: { left, right } }) : S.Union([left, right]);
    const value = { ...(kind === "oneOf" ? { kind: "left" } : {}), left: "ready" };
    expect(validate(schema, value, noDefaults)).toEqual({ ok: true, value });
  });

  it("still validates supplied constraints and required nested members", () => {
    const schema = S.Object({ value: S.Object({ count: S.Number({ default: 2, maximum: 10 }) }) });
    expect(validate(schema, { value: { count: 20 } }, noDefaults).ok).toBe(false);
    expect(validate(schema, { value: {} }, noDefaults).ok).toBe(false);
    expect(validate(schema, { value: { count: 3 } }, noDefaults)).toEqual({ ok: true, value: { value: { count: 3 } } });
  });

  it("does not use a root optional default", () => {
    expect(validate(S.Optional(S.String({ default: "seed" })), undefined, noDefaults)).toEqual({ ok: true, value: undefined });
  });
});
