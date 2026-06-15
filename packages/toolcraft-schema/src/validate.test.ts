import { describe, expect, expectTypeOf, it } from "vitest";
import { S, validate } from "toolcraft-schema";
import type { ValidationResult } from "toolcraft-schema";

describe("validate", () => {
  it("validates every builder and applies defaults for missing optionals", () => {
    const schema = S.Object({
      name: S.String({ minLength: 2 }),
      count: S.Optional(S.Number({ default: 3, minimum: 1 })),
      enabled: S.Boolean(),
      role: S.Enum(["admin", "user"] as const),
      tags: S.Array(S.String(), { minItems: 1 }),
      settings: S.Record(S.Boolean()),
      payload: S.Json(),
      omitted: S.Optional(S.String())
    });

    const result = validate(schema, {
      name: "Ada",
      enabled: true,
      role: "admin",
      tags: ["core"],
      settings: { verbose: false },
      payload: { nested: [1, "two", null] }
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "Ada",
        count: 3,
        enabled: true,
        role: "admin",
        tags: ["core"],
        settings: { verbose: false },
        payload: { nested: [1, "two", null] }
      }
    });
    expectTypeOf(result).toMatchTypeOf<
      ValidationResult<{
        name: string;
        count?: number;
        enabled: boolean;
        role: "admin" | "user";
        tags: string[];
        settings: Record<string, boolean>;
        payload: string | number | boolean | null | { [key: string]: unknown } | unknown[];
        omitted?: string;
      }>
    >();
  });

  it("validates oneOf and union schemas", () => {
    const oneOfSchema = S.OneOf({
      discriminator: "kind",
      branches: {
        text: S.Object({ value: S.String() }),
        count: S.Object({ value: S.Number() })
      }
    });
    const unionSchema = S.Union([
      S.Object({ email: S.String() }),
      S.Object({ phone: S.String(), extension: S.Optional(S.Number({ default: 100 })) })
    ]);

    expect(validate(oneOfSchema, { kind: "text", value: "hello" })).toEqual({
      ok: true,
      value: { kind: "text", value: "hello" }
    });
    expect(validate(unionSchema, { phone: "555-0100" })).toEqual({
      ok: true,
      value: { phone: "555-0100", extension: 100 }
    });
    expect(validate(unionSchema, { email: 12 })).toEqual({
      ok: false,
      issues: [
        {
          path: ["email"],
          expected: "string",
          received: "integer",
          message: "Expected string at email, got integer"
        }
      ]
    });
  });

  it("reports union branches tried when no branch matches", () => {
    const schema = S.Union([
      S.Object({ email: S.String() }),
      S.Object({ phone: S.String(), extension: S.Optional(S.Number()) })
    ]);

    expect(validate(schema, { name: "Ada" })).toEqual({
      ok: false,
      issues: [
        {
          path: [],
          expected: "exactly one union branch",
          received: "0 matching branches",
          message:
            "No union branch matched at value. Tried 2 branches. Expected one of: email | phone."
        }
      ]
    });
  });

  it("reports matching union branches when multiple branches match", () => {
    const schema = S.Union([
      S.Object({ email: S.String() }, { additionalProperties: true }),
      S.Object({ phone: S.String() }, { additionalProperties: true }),
      S.Object({ email: S.String(), phone: S.String() })
    ]);

    expect(validate(schema, { email: "ada@example.com", phone: "555-0100" })).toEqual({
      ok: false,
      issues: [
        {
          path: [],
          expected: "exactly one union branch",
          received: "3 matching branches",
          message:
            "Expected exactly one union branch at value, but matched more than one branch: email | phone | email+phone"
        }
      ]
    });
  });

  it("reports received and missing oneOf discriminators", () => {
    const schema = S.OneOf({
      discriminator: "kind",
      branches: {
        text: S.Object({ value: S.String() }),
        count: S.Object({ value: S.Number() })
      }
    });

    expect(validate(schema, { kind: "audio", value: "hello" })).toEqual({
      ok: false,
      issues: [
        {
          path: ["kind"],
          expected: "one of text, count",
          received: "audio",
          message: 'Expected one of text, count at kind, got "audio"'
        }
      ]
    });

    expect(validate(schema, { value: "hello" })).toEqual({
      ok: false,
      issues: [
        {
          path: ["kind"],
          expected: "one of text, count",
          received: "missing",
          message: 'Missing discriminator "kind" at value. Expected one of: text, count.'
        }
      ]
    });
  });

  it("omits missing optionals without defaults", () => {
    const schema = S.Object({
      required: S.String(),
      maybe: S.Optional(S.Boolean()),
      fallback: S.Optional(S.String({ default: "defaulted" }))
    });

    expect(validate(schema, { required: "value" })).toEqual({
      ok: true,
      value: {
        required: "value",
        fallback: "defaulted"
      }
    });
    expect(validate(S.Optional(S.String()), undefined)).toEqual({
      ok: true,
      value: undefined
    });
  });

  it("accumulates nested issues and rejects additional object properties", () => {
    const schema = S.Object({
      user: S.Object({
        name: S.String({ minLength: 3 }),
        retries: S.Number({ minimum: 1 }),
        tags: S.Array(S.String(), { minItems: 2 }),
        mode: S.Enum(["fast", "safe"] as const)
      })
    });

    const result = validate(schema, {
      user: {
        name: "Al",
        retries: 0,
        tags: [],
        mode: "slow",
        extra: true
      },
      rootExtra: 1
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: ["user", "name"],
          expected: "string with length at least 3",
          received: "string with length 2",
          message: "Expected string with length at least 3 at user.name, got string with length 2"
        },
        {
          path: ["user", "retries"],
          expected: "number greater than or equal to 1",
          received: "0",
          message: "Expected number greater than or equal to 1 at user.retries, got 0"
        },
        {
          path: ["user", "tags"],
          expected: "array with at least 2 items",
          received: "array with 0 items",
          message: "Expected array with at least 2 items at user.tags, got array with 0 items"
        },
        {
          path: ["user", "mode"],
          expected: "one of fast, safe",
          received: "slow",
          message: "Expected one of fast, safe at user.mode, got slow"
        },
        {
          path: ["user", "extra"],
          expected: "no additional properties",
          received: "unknown property",
          message: "Expected no additional properties at user.extra, got unknown property"
        },
        {
          path: ["rootExtra"],
          expected: "no additional properties",
          received: "unknown property",
          message: "Expected no additional properties at rootExtra, got unknown property"
        }
      ]
    });
  });

  it("returns all item and record value issues", () => {
    const schema = S.Object({
      items: S.Array(S.Number({ minimum: 10 })),
      flags: S.Record(S.Boolean())
    });

    expect(validate(schema, { items: [1, "two"], flags: { ok: true, bad: "no" } })).toEqual({
      ok: false,
      issues: [
        {
          path: ["items", "0"],
          expected: "number greater than or equal to 10",
          received: "1",
          message: "Expected number greater than or equal to 10 at items.0, got 1"
        },
        {
          path: ["items", "1"],
          expected: "number",
          received: "string",
          message: "Expected number at items.1, got string"
        },
        {
          path: ["flags", "bad"],
          expected: "boolean",
          received: "string",
          message: "Expected boolean at flags.bad, got string"
        }
      ]
    });
  });

  it("enforces upper bounds and string patterns", () => {
    const schema = S.Object({
      code: S.String({ maxLength: 4, pattern: "^[A-Z]+$" }),
      score: S.Number({ maximum: 5 }),
      values: S.Array(S.Boolean(), { maxItems: 1 })
    });

    expect(validate(schema, { code: "abcde", score: 6, values: [true, false] })).toEqual({
      ok: false,
      issues: [
        {
          path: ["code"],
          expected: "string with length at most 4",
          received: "string with length 5",
          message: "Expected string with length at most 4 at code, got string with length 5"
        },
        {
          path: ["code"],
          expected: "string matching pattern ^[A-Z]+$",
          received: "abcde",
          message: "Expected string matching pattern ^[A-Z]+$ at code, got abcde"
        },
        {
          path: ["score"],
          expected: "number less than or equal to 5",
          received: "6",
          message: "Expected number less than or equal to 5 at score, got 6"
        },
        {
          path: ["values"],
          expected: "array with at most 1 items",
          received: "array with 2 items",
          message: "Expected array with at most 1 items at values, got array with 2 items"
        }
      ]
    });
  });

  it("preserves additional object properties when the object schema allows them", () => {
    const schema = S.Object(
      {
        name: S.String()
      },
      { additionalProperties: true }
    );

    expect(validate(schema, { name: "Ada", title: "engineer" })).toEqual({
      ok: true,
      value: {
        name: "Ada",
        title: "engineer"
      }
    });
  });

  it("reports missing required values and invalid JSON payloads without throwing", () => {
    const schema = S.Object({
      required: S.String(),
      payload: S.Json()
    });

    expect(validate(schema, { payload: { bad: undefined } })).toEqual({
      ok: false,
      issues: [
        {
          path: ["required"],
          expected: "string",
          received: "missing",
          message: "Expected string at required, got missing"
        },
        {
          path: ["payload"],
          expected: "JSON value",
          received: "object",
          message: "Expected JSON value at payload, got object"
        }
      ]
    });
  });

  it("rejects non-finite numbers and cyclic JSON values without throwing", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(validate(S.Number(), Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(validate(S.Json(), cyclic).ok).toBe(false);
  });

  it("validates and clones defaults on each optional application", () => {
    expect(() =>
      S.Object({
        names: S.Optional(S.Array(S.String({ minLength: 2 }), { default: ["x"] }))
      })
    ).toThrow("default must satisfy schema");

    const validSchema = S.Object({
      names: S.Optional(S.Array(S.String(), { default: ["seed"] }))
    });
    const first = validate(validSchema, {});
    const second = validate(validSchema, {});
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      first.value.names?.push("changed");
      expect(second.value.names).toEqual(["seed"]);
    }
  });

  it("preserves explicit proto keys without mutating result prototypes", () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.name = "Ada";
    Object.defineProperty(input, "__proto__", { enumerable: true, value: "declared" });
    const declaredShape = Object.create(null) as {
      name: ReturnType<typeof S.String>;
      __proto__: ReturnType<typeof S.String>;
    };
    declaredShape.name = S.String();
    Object.defineProperty(declaredShape, "__proto__", { enumerable: true, value: S.String() });
    const declared = validate(S.Object(declaredShape), input);

    const additionalInput = Object.create(null) as Record<string, unknown>;
    additionalInput.name = "Ada";
    Object.defineProperty(additionalInput, "__proto__", {
      enumerable: true,
      value: { polluted: true }
    });
    const additional = validate(
      S.Object({ name: S.String() }, { additionalProperties: true }),
      additionalInput
    );

    const recordInput = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(recordInput, "__proto__", { enumerable: true, value: "value" });
    const record = validate(S.Record(S.String()), recordInput);

    for (const result of [declared, additional, record]) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.hasOwn(result.value, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
      }
    }
  });
});
