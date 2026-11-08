import { describe, expect, it } from "vitest";
import { S, toJsonSchema, toJsonSchemaDocument, type AnySchema, type JsonSchema } from "./index.js";

const factories = [
  { name: "array", create: () => S.Array(S.String(), { default: ["seed"] }) },
  { name: "JSON", create: () => ({ ...S.Json(), default: { nested: { tags: ["seed"] } } }) },
  { name: "record", create: () => ({ ...S.Record(S.Array(S.String())), default: { entry: ["seed"] } }) },
  { name: "object", create: () => S.Object({ tags: S.Array(S.String()) }, { default: { tags: ["seed"] } }) },
  { name: "object array", create: () => S.Array(S.Object({ tags: S.Array(S.String()) }), { default: [{ tags: ["seed"] }] }) }
];

const placements: Array<{
  name: string;
  wrap: (schema: AnySchema) => AnySchema;
  select: (schema: JsonSchema) => JsonSchema;
}> = [
  { name: "root", wrap: (schema) => schema, select: (schema) => schema },
  { name: "optional property", wrap: (schema) => S.Object({ payload: S.Optional(schema) }), select: (schema) => schema.properties!.payload! },
  { name: "array item", wrap: (schema) => S.Array(schema), select: (schema) => schema.items! },
  { name: "record value", wrap: (schema) => S.Record(schema), select: (schema) => schema.additionalProperties as JsonSchema },
  { name: "discriminated property", wrap: (schema) => S.OneOf({ discriminator: "kind", branches: { data: S.Object({ payload: schema }) } }), select: (schema) => schema.oneOf![0]!.properties!.payload! },
  { name: "union property", wrap: (schema) => S.Union([S.Object({ payload: schema })]), select: (schema) => schema.oneOf![0]!.properties!.payload! }
];

function mutateArrays(value: unknown): void {
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string")) {
      value.push("changed");
    } else {
      value.forEach(mutateArrays);
    }
  } else if (value !== null && typeof value === "object") {
    Object.values(value).forEach(mutateArrays);
  }
}

describe.each([
  { name: "toJsonSchema", render: toJsonSchema },
  { name: "toJsonSchemaDocument", render: toJsonSchemaDocument }
])("$name default ownership", ({ render }) => {
  describe.each(placements)("$name", ({ wrap, select }) => {
    it.each(factories)("isolates mutable $name defaults from the descriptor and other renderings", ({ create }) => {
      const field = create();
      const original = structuredClone(field.default);
      const schema = wrap(field);
      const first = render(schema);
      const second = render(schema);
      const firstDefault = select(first).default;
      const secondDefault = select(second).default;

      expect(firstDefault).toEqual(original);
      expect(secondDefault).toEqual(original);
      mutateArrays(firstDefault);

      expect(firstDefault).not.toEqual(original);
      expect(field.default).toEqual(original);
      expect(secondDefault).toEqual(original);
      expect(select(render(schema)).default).toEqual(original);
      expect(firstDefault).not.toBe(field.default);
      expect(secondDefault).not.toBe(firstDefault);
    });
  });

  it.each(["object", "discriminated", "union"] as const)("deep-clones $0 branch defaults", (kind) => {
    const defaultValue = { tags: ["seed"] };
    const branch = S.Object({ tags: S.Array(S.String()) }, { default: defaultValue });
    const schema = kind === "object" ? branch : kind === "discriminated"
      ? S.OneOf({ discriminator: "kind", branches: { data: branch } })
      : S.Union([branch]);
    const generated = render(schema);
    const metadata = kind === "object" ? generated : generated.oneOf![0]!;
    const expected = kind === "discriminated" ? { tags: ["seed"], kind: "data" } : { tags: ["seed"] };
    expect(metadata.default).toEqual(expected);

    mutateArrays(metadata.default);

    expect(defaultValue).toEqual({ tags: ["seed"] });
    expect(branch.default).toBe(defaultValue);
    const next = render(schema);
    expect((kind === "object" ? next : next.oneOf![0]!).default).toEqual(expected);
  });

  it("isolates a shared descriptor used by sibling properties", () => {
    const field = S.Array(S.String(), { default: ["seed"] });
    const generated = render(S.Object({ first: field, second: field }));
    mutateArrays(generated.properties!.first!.default);
    expect(generated.properties!.second!.default).toEqual(["seed"]);
    expect(field.default).toEqual(["seed"]);
  });

  it("preserves internal aliases in a separately owned default graph", () => {
    const shared = { tags: ["seed"] };
    const defaultValue = { first: shared, second: shared };
    const schema = S.Object({}, { additionalProperties: true, default: defaultValue });
    const generated = render(schema).default as typeof defaultValue;
    expect(generated.first).toBe(generated.second);
    generated.first.tags.push("changed");
    expect(shared.tags).toEqual(["seed"]);
    expect(generated.second.tags).toEqual(["seed", "changed"]);
  });

  it.each([
    S.String({ default: "" }), S.Number({ default: 0 }), S.Boolean({ default: false }),
    S.Object({}, { nullable: true, default: null }), S.String()
  ])("preserves scalar, null, and missing default metadata %#", (schema) => {
    const generated = render(schema);
    if (schema.default === undefined) expect(generated).not.toHaveProperty("default");
    else expect(generated.default).toBe(schema.default);
  });
});
