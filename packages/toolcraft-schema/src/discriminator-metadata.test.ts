import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, toJsonSchema, validate } from "./index.js";

describe.each(["kind", "delivery_kind"])("discriminator metadata: %s", (discriminator) => {
  it.each(["absent", "object", "authoritative", "nullable object", "null"])("transforms %s branch defaults without changing the source", (scenario) => {
    const defaultValue = scenario === "absent" ? undefined : scenario === "null" ? null : {
      title: "Ada",
      ...(scenario === "authoritative" ? { [discriminator]: "wrong" } : {})
    };
    const branch = S.Object({ title: S.String() }, {
      nullable: scenario === "nullable object" || scenario === "null",
      additionalProperties: scenario === "authoritative",
      ...(defaultValue === undefined ? {} : { default: defaultValue })
    });
    const original = structuredClone(branch);
    const schema = S.OneOf({ discriminator, branches: { text: branch } });
    const generated = toJsonSchema(schema);
    const projected = generated.oneOf?.[0];
    if (projected === undefined) throw new Error("Expected a generated branch");
    expect(generated).not.toHaveProperty("default");
    expect(projected).not.toHaveProperty("nullable");
    if (defaultValue === undefined || defaultValue === null) {
      expect(projected).not.toHaveProperty("default");
    } else {
      expect(projected.default).toEqual({ title: "Ada", [discriminator]: "text" });
      expect(compileJsonSchema(projected).validate(projected.default).ok).toBe(true);
      expect(validate(schema, projected.default).ok).toBe(true);
      expect(projected.default).not.toBe(defaultValue);
    }
    expect(validate(schema, null).ok).toBe(false);
    expect(compileJsonSchema(generated).validate(null).ok).toBe(false);
    expect(compileJsonSchema(generated).validate({ title: "Ada", [discriminator]: "text" }).ok).toBe(true);
    expect(branch).toStrictEqual(original);
    expect(branch.default).toBe(defaultValue);
  });
});

describe.each(["oneOf", "union"])("%s branch nullability", (kind) => {
  describe.each([1, 2])("with %s nullable branches", (count) => {
    it.each([false, true])("preserves parent nullable=%s independently of branch metadata", (nullable) => {
      const branch = S.Object({ title: S.String() }, { nullable: true, default: null });
      const branches = Array.from({ length: count }, (_, index) => S.Object({ [`title${index}`]: S.String() }, { nullable: true, default: null }));
      const choice = kind === "oneOf"
        ? S.OneOf({ discriminator: "kind", branches: Object.fromEntries(branches.map((entry, index) => [`branch${index}`, entry])) })
        : S.Union(branches);
      const schema = { ...choice, nullable };
      const generated = toJsonSchema(schema);
      expect(validate(schema, null).ok).toBe(nullable);
      expect(compileJsonSchema(generated).validate(null).ok).toBe(nullable);
      for (const projected of generated.oneOf ?? []) {
        expect(projected).not.toHaveProperty("nullable");
        expect(projected).not.toHaveProperty("default");
      }
      expect(generated.oneOf).toHaveLength(count + (nullable ? 1 : 0));
      if (nullable) expect(generated.oneOf?.at(-1)).toEqual({ enum: [null] });
      expect(toJsonSchema(branch)).toMatchObject({ nullable: true, default: null });
    });
  });
});
