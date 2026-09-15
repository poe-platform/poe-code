import { describe, expect, it } from "vitest";
import { S, validate, type AnySchema } from "./index.js";

const requiredItems: Array<{ name: string; schema: AnySchema; value: unknown }> = [
  { name: "string", schema: S.String(), value: "ready" },
  { name: "number", schema: S.Number(), value: 1 },
  { name: "boolean", schema: S.Boolean(), value: true },
  { name: "enum", schema: S.Enum(["ready", "done"]), value: "ready" },
  { name: "object", schema: S.Object({ value: S.String() }), value: { value: "ready" } },
  { name: "record", schema: S.Record(S.String()), value: { key: "ready" } },
  { name: "array", schema: S.Array(S.String()), value: ["ready"] },
  { name: "json", schema: S.Json(), value: { ready: true } },
  { name: "nullable", schema: S.String({ nullable: true }), value: null }
];

describe.each([false, true])("sparse arrays nested=%s", (nested) => {
  describe.each(requiredItems)("$name items", ({ schema: itemSchema, value }) => {
    it.each([0, 1, 2])("validates missing index %s like explicit undefined", (hole) => {
      const items = Array.from({ length: 3 }, () => structuredClone(value));
      const schema = nested ? S.Object({ items: S.Array(itemSchema) }) : S.Array(itemSchema);
      expect(validate(schema, nested ? { items } : items).ok).toBe(true);
      const explicit = [...items];
      explicit[hole] = undefined;
      delete items[hole];
      const actual = validate(schema, nested ? { items } : items);
      expect(actual.ok).toBe(false);
      expect(actual).toEqual(validate(schema, nested ? { items: explicit } : explicit));
      if (actual.ok) throw new Error("Expected invalid missing item");
      expect(actual.issues.some((issue) => issue.path.join(".") === [...(nested ? ["items"] : []), String(hole)].join("."))).toBe(true);
      expect(Object.hasOwn(items, hole)).toBe(false);
    });
  });
});

describe("sparse optional items", () => {
  it.each([false, true])("normalizes missing optional items, defaulted=%s", (defaulted) => {
    const item = S.Optional(S.String(defaulted ? { default: "seed" } : {}));
    const items = Array(3);
    const result = validate(S.Array(item), items);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected optional items");
    expect(result.value).toStrictEqual(Array.from({ length: 3 }, () => defaulted ? "seed" : undefined));
    expect(Object.hasOwn(items, 0)).toBe(false);
  });

  it("clones defaults independently for each missing optional item", () => {
    const original = ["seed"];
    const result = validate(S.Array(S.Optional(S.Array(S.String(), { default: original }))), Array(2));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected defaulted items");
    expect(result.value).toStrictEqual([["seed"], ["seed"]]);
    expect(result.value[0]).not.toBe(result.value[1]);
    result.value[0]!.push("changed");
    expect(result.value[1]).toEqual(["seed"]);
    expect(original).toEqual(["seed"]);
  });
});

describe.each(["direct", "nested array", "object"])("JSON holes in %s", (placement) => {
  it.each([0, 1, 2])("rejects missing index %s", (hole) => {
    const items: unknown[] = [null, "ready", 1];
    delete items[hole];
    const value = placement === "direct" ? items : placement === "nested array" ? [items] : { items };
    expect(validate(S.Json(), value).ok).toBe(false);
    expect(validate(S.Json(), JSON.parse(JSON.stringify(value))).ok).toBe(true);
  });
});

describe("indexed array data", () => {
  it.each([false, true])("does not use a custom iterator, invalid=%s", (invalid) => {
    const items = [invalid ? 42 : "ready"];
    Object.defineProperty(items, Symbol.iterator, { value: function* () { yield invalid ? "ready" : 42; } });
    const result = validate(S.Array(S.String()), items);
    expect(result.ok).toBe(!invalid);
    if (result.ok) expect(result.value).toEqual(["ready"]);
  });

  it("does not delegate item validation to an overridden map method", () => {
    const items = [42];
    Object.defineProperty(items, "map", { value: () => ["ready"] });
    expect(validate(S.Array(S.String()), items).ok).toBe(false);
  });

  it("does not delegate JSON validation to an overridden every method", () => {
    const items = [undefined];
    Object.defineProperty(items, "every", { value: () => true });
    expect(validate(S.Json(), items).ok).toBe(false);
  });

  it("rejects a required-item array default containing a hole", () => {
    expect(() => S.Array(S.String(), { default: Array(1) })).toThrow();
  });
});
