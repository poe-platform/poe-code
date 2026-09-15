import { describe, expect, it } from "vitest";
import { S, validate, type AnySchema } from "./index.js";

const cases: Array<{ name: string; schema: AnySchema; expected: unknown }> = [
  { name: "string", schema: S.String({ default: "seed" }), expected: "seed" },
  { name: "empty string", schema: S.String({ default: "" }), expected: "" },
  { name: "number", schema: S.Number({ default: 2 }), expected: 2 },
  { name: "zero", schema: S.Number({ default: 0 }), expected: 0 },
  { name: "false", schema: S.Boolean({ default: false }), expected: false },
  { name: "enum", schema: S.Enum(["seed", "other"], { default: "seed" }), expected: "seed" },
  { name: "array", schema: S.Array(S.String(), { default: ["seed"] }), expected: ["seed"] },
  { name: "object", schema: S.Object({ items: S.Array(S.String()) }, { default: { items: ["seed"] } }), expected: { items: ["seed"] } },
  { name: "record", schema: { ...S.Record(S.String()), default: { label: "seed" } }, expected: { label: "seed" } },
  { name: "JSON", schema: { ...S.Json(), default: { items: ["seed"] } }, expected: { items: ["seed"] } },
  { name: "null", schema: S.Array(S.String(), { nullable: true, default: null }), expected: null }
];

describe.each(cases)("$name validation defaults", ({ schema: field, expected }) => {
  it("applies a required member's default only when requested", () => {
    const schema = S.Object({ value: field });
    expect(validate(schema, {}).ok).toBe(false);
    expect(validate(schema, {}, { defaults: "optional" }).ok).toBe(false);
    expect(validate(schema, {}, { defaults: "all" })).toEqual({ ok: true, value: { value: expected } });
  });

  it("preserves optional default behavior in both modes", () => {
    const schema = S.Object({ value: S.Optional(field) });
    expect(validate(schema, {})).toEqual({ ok: true, value: { value: expected } });
    expect(validate(schema, {}, { defaults: "all" })).toEqual({ ok: true, value: { value: expected } });
  });

  it("does not replace explicit undefined in a required member", () => {
    const schema = S.Object({ value: field });
    expect(validate(schema, { value: undefined }, { defaults: "all" }).ok).toBe(false);
  });
});

describe("required-default validation boundaries", () => {
  it("leaves absent optional parents absent", () => {
    const schema = S.Object({ settings: S.Optional(S.Object({ value: S.String({ default: "seed" }) })) });
    expect(validate(schema, {}, { defaults: "all" })).toEqual({ ok: true, value: {} });
  });

  it("still requires a parent without its own default", () => {
    const schema = S.Object({ settings: S.Object({ value: S.String({ default: "seed" }) }) });
    expect(validate(schema, {}, { defaults: "all" }).ok).toBe(false);
    expect(validate(schema, { settings: {} }, { defaults: "all" })).toEqual({ ok: true, value: { settings: { value: "seed" } } });
  });

  it("does not merge a whole-object default into an explicitly supplied partial object", () => {
    const schema = S.Object({ settings: S.Object({ required: S.String(), note: S.Optional(S.String()) }, { default: { required: "seed" } }) });
    expect(validate(schema, { settings: { note: "memo" } }, { defaults: "all" }).ok).toBe(false);
  });

  it("applies nested defaults separately to record entries and array items", () => {
    const original = ["seed"];
    const entry = S.Object({ values: S.Array(S.String(), { default: original }) });
    const schema = S.Record(S.Array(entry));
    const input = { first: [{}, {}], second: [{}] };
    const result = validate(schema, input, { defaults: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected defaulted entries");
    result.value.first![0]!.values.push("mutated");
    expect(result.value.first![1]!.values).toEqual(["seed"]);
    expect(result.value.second![0]!.values).toEqual(["seed"]);
    expect(original).toEqual(["seed"]);
    expect(input).toEqual({ first: [{}, {}], second: [{}] });
    expect(validate(schema, input, { defaults: "all" })).toEqual({ ok: true, value: { first: [{ values: ["seed"] }, { values: ["seed"] }], second: [{ values: ["seed"] }] } });
  });

  it.each([
    { name: "minimum", schema: { ...S.Number({ minimum: 1 }), default: 0 } },
    { name: "array bound", schema: { ...S.Array(S.String(), { minItems: 1 }), default: [] } },
    { name: "required object member", schema: { ...S.Object({ required: S.String() }), default: {} } }
  ])("validates an applied default against $name", ({ name, schema: field }) => {
    const result = validate(S.Object({ value: field }), {}, { defaults: "all" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid default rejection");
    expect(result.issues[0]!.path).toEqual(name === "required object member" ? ["value", "required"] : ["value"]);
    if (name !== "required object member") expect(result.issues[0]!.received).not.toBe("missing");
  });

  it.each(["oneOf", "union"] as const)("propagates default handling through %s branches", (kind) => {
    const left = S.Object({ left: S.String(), amount: S.Number({ default: 2 }) });
    const right = S.Object({ right: S.String() });
    const schema = kind === "oneOf" ? S.OneOf({ discriminator: "kind", branches: { left, right } }) : S.Union([left, right]);
    const input = { ...(kind === "oneOf" ? { kind: "left" } : {}), left: "ready" };
    expect(validate(schema, input, { defaults: "all" })).toEqual({ ok: true, value: { ...input, amount: 2 } });
  });

  it("rejects ambiguous union branches made valid by defaults", () => {
    const schema = S.Union([
      S.Object({ left: S.String() }, { additionalProperties: true }),
      S.Object({ right: S.String({ default: "seed" }) }, { additionalProperties: true })
    ]);
    expect(validate(schema, { left: "ready" }, { defaults: "all" }).ok).toBe(false);
  });
});
