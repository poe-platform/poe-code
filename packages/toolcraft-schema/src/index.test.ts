import { describe, expect, expectTypeOf, it } from "vitest";
import { S, toJsonSchema } from "toolcraft-schema";
import type {
  ArraySchema,
  BooleanSchema,
  EnumSchema,
  JsonSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  Static,
  StringSchema,
} from "toolcraft-schema";

describe("toolcraft-schema", () => {
  it("exports typed builders from the package root", () => {
    const stringSchema = S.String({ description: "Name", default: "guest" });
    const numberSchema = S.Number({ description: "Count", default: 3 });
    const booleanSchema = S.Boolean({ description: "Enabled", default: false });
    const enumSchema = S.Enum(["admin", "user"] as const, {
      description: "Role",
      default: "admin",
    });
    const arraySchema = S.Array(S.String(), {
      description: "Tags",
      default: ["a", "b"],
    });
    const objectSchema = S.Object({
      name: S.String(),
    });
    const optionalSchema = S.Optional(S.String());

    expect(stringSchema.kind).toBe("string");
    expect(numberSchema.kind).toBe("number");
    expect(booleanSchema.kind).toBe("boolean");
    expect(enumSchema.kind).toBe("enum");
    expect(arraySchema.kind).toBe("array");
    expect(objectSchema.kind).toBe("object");
    expect(optionalSchema.kind).toBe("optional");

    expectTypeOf(stringSchema).toMatchTypeOf<StringSchema>();
    expectTypeOf(numberSchema).toMatchTypeOf<NumberSchema>();
    expectTypeOf(booleanSchema).toMatchTypeOf<BooleanSchema>();
    expectTypeOf(enumSchema).toMatchTypeOf<EnumSchema<readonly ["admin", "user"]>>();
    expectTypeOf(arraySchema).toMatchTypeOf<ArraySchema<StringSchema>>();
    expectTypeOf(objectSchema).toMatchTypeOf<ObjectSchema<{ name: StringSchema }>>();
    expectTypeOf(optionalSchema).toMatchTypeOf<OptionalSchema<StringSchema>>();
  });

  it("infers static types for nested objects, arrays, enums, and optional properties", () => {
    const ignoredSchema = S.Object({
      name: S.String(),
      count: S.Number({ default: 1 }),
      enabled: S.Boolean({ default: true }),
      role: S.Enum(["admin", "user"] as const),
      tags: S.Array(S.String()),
      metadata: S.Optional(
        S.Object({
          retries: S.Number(),
          active: S.Optional(S.Boolean()),
        })
      ),
    });

    expectTypeOf<Static<typeof ignoredSchema>>().toEqualTypeOf<{
      name: string;
      count: number;
      enabled: boolean;
      role: "admin" | "user";
      tags: string[];
      metadata?: {
        retries: number;
        active?: boolean;
      };
    }>();
  });

  it("infers undefined for optional non-object schemas", () => {
    const ignoredSchema = S.Optional(S.Array(S.Boolean()));

    expectTypeOf<Static<typeof ignoredSchema>>().toEqualTypeOf<boolean[] | undefined>();
  });

  it("infers static types for optional object properties without leaking undefined into present values", () => {
    const ignoredSchema = S.Object({
      requiredValue: S.String(),
      optionalValue: S.Optional(S.Number()),
    });

    expectTypeOf<Static<typeof ignoredSchema>>().toEqualTypeOf<{
      requiredValue: string;
      optionalValue?: number;
    }>();
  });

  it("serializes primitive schemas to JSON Schema", () => {
    expect(toJsonSchema(S.String({ description: "Name", default: "guest" }))).toEqual({
      type: "string",
      description: "Name",
      default: "guest",
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Number({ description: "Count", default: 3 }))).toEqual({
      type: "number",
      description: "Count",
      default: 3,
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Boolean({ description: "Enabled", default: false }))).toEqual({
      type: "boolean",
      description: "Enabled",
      default: false,
    } satisfies JsonSchema);
  });

  it("serializes nullable schemas and preserves non-validating JSON Schema metadata", () => {
    expect(
      toJsonSchema(
        S.String({
          nullable: true,
          minLength: 3,
          maxLength: 40,
          pattern: "^[a-z]+$",
          format: "date-time",
        })
      )
    ).toEqual({
      type: "string",
      nullable: true,
      minLength: 3,
      maxLength: 40,
      pattern: "^[a-z]+$",
      format: "date-time",
    } satisfies JsonSchema);

    expect(
      toJsonSchema(
        S.Number({
          jsonType: "integer",
          minimum: 1,
          maximum: 100,
        })
      )
    ).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 100,
    } satisfies JsonSchema);

    expect(
      toJsonSchema(
        S.Array(S.String(), {
          minItems: 1,
          maxItems: 4,
        })
      )
    ).toEqual({
      type: "array",
      items: {
        type: "string",
      },
      minItems: 1,
      maxItems: 4,
    } satisfies JsonSchema);
  });

  it("serializes integer-flavored number schemas as JSON Schema integers", () => {
    expect(toJsonSchema(S.Number({ description: "Count", default: 3, jsonType: "integer" }))).toEqual({
      type: "integer",
      description: "Count",
      default: 3,
    } satisfies JsonSchema);
  });

  it("serializes enum schemas with enum values and defaults", () => {
    expect(
      toJsonSchema(
        S.Enum(["admin", "user", "guest"] as const, {
          description: "Role",
          default: "user",
        })
      )
    ).toEqual({
      type: "string",
      enum: ["admin", "user", "guest"],
      description: "Role",
      default: "user",
    } satisfies JsonSchema);
  });

  it("serializes integer-flavored enums as JSON Schema integers", () => {
    expect(
      toJsonSchema(
        S.Enum([1, 2, 3] as const, {
          description: "Status code",
          default: 2,
          jsonType: "integer",
        })
      )
    ).toEqual({
      type: "integer",
      enum: [1, 2, 3],
      description: "Status code",
      default: 2,
    } satisfies JsonSchema);
  });

  it("serializes nullable enums with null in the advertised enum list", () => {
    expect(
      toJsonSchema(
        S.Enum(["off", "auto", "forced"] as const, {
          nullable: true,
        })
      )
    ).toEqual({
      type: "string",
      enum: ["off", "auto", "forced", null],
      nullable: true,
    } satisfies JsonSchema);
  });

  it("serializes numeric, boolean, and mixed enums to JSON Schema", () => {
    expect(toJsonSchema(S.Enum([1, 2, 3] as const))).toEqual({
      type: "number",
      enum: [1, 2, 3],
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Enum([true, false] as const))).toEqual({
      type: "boolean",
      enum: [true, false],
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Enum(["enabled", false] as const))).toEqual({
      enum: ["enabled", false],
    } satisfies JsonSchema);
  });

  it("serializes array schemas with nested item schemas", () => {
    expect(
      toJsonSchema(
        S.Array(S.Number({ description: "Single value" }), {
          description: "Values",
          default: [1, 2, 3],
        })
      )
    ).toEqual({
      type: "array",
      items: {
        type: "number",
        description: "Single value",
      },
      description: "Values",
      default: [1, 2, 3],
    } satisfies JsonSchema);
  });

  it("serializes nested object schemas and tracks required keys from optional wrappers", () => {
    const schema = S.Object({
      name: S.String({ description: "Display name" }),
      enabled: S.Optional(S.Boolean({ default: true })),
      nested: S.Object({
        port: S.Number({ default: 5432 }),
        secure: S.Optional(S.Boolean()),
      }),
    });

    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name",
        },
        enabled: {
          type: "boolean",
          default: true,
        },
        nested: {
          type: "object",
          properties: {
            port: {
              type: "number",
              default: 5432,
            },
            secure: {
              type: "boolean",
            },
          },
          required: ["port"],
        },
      },
      required: ["name", "nested"],
    } satisfies JsonSchema);
  });

  it("serializes empty object schemas with an empty required array", () => {
    expect(toJsonSchema(S.Object({}))).toEqual({
      type: "object",
      properties: {},
      required: [],
    } satisfies JsonSchema);
  });

  it("serializes object schemas with additionalProperties metadata", () => {
    expect(
      toJsonSchema(
        S.Object(
          {
            name: S.String(),
          },
          { additionalProperties: false }
        )
      )
    ).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string",
        },
      },
      required: ["name"],
      additionalProperties: false,
    } satisfies JsonSchema);
  });

  it("treats double-wrapped optional object properties as optional", () => {
    const schema = S.Object({
      maybeName: S.Optional(S.Optional(S.String({ default: "guest" }))),
    });

    expectTypeOf<Static<typeof schema>>().toEqualTypeOf<{
      maybeName?: string | undefined;
    }>();

    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        maybeName: {
          type: "string",
          default: "guest",
        },
      },
      required: [],
    } satisfies JsonSchema);
  });

  it("serializes top-level optional schemas as the underlying JSON Schema", () => {
    expect(toJsonSchema(S.Optional(S.String({ default: "value" })))).toEqual({
      type: "string",
      default: "value",
    } satisfies JsonSchema);
  });

  it("stores labels on an enum schema and exposes them for lookup", () => {
    const schema = S.Enum(["admin", "user"] as const, {
      labels: { admin: "Administrator", user: "Regular User" }
    });

    expect(schema.labels).toEqual({ admin: "Administrator", user: "Regular User" });
    expect(schema.labels?.["admin"]).toBe("Administrator");
    expect(schema.labels?.["guest"]).toBeUndefined();
  });

  it("rejects empty enums at runtime for JavaScript callers", () => {
    expect(() => S.Enum([] as unknown as [string])).toThrow("Enum schema requires at least one value");
  });

  it("rejects duplicate enum values at runtime", () => {
    expect(() => S.Enum(["admin", "admin"] as const)).toThrow(
      "Enum schema values must be unique"
    );
  });
});
