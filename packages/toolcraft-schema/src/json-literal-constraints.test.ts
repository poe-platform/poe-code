import { expect, it } from "vitest";
import { S, compileJsonSchema, toJsonSchema, validate } from "./index.js";

it.each([
  S.Json({ const: { ready: true }, nullable: true }),
  S.Json({ enum: [{ ready: true }, [1, 2]], nullable: true })
])("keeps nullable JSON literal validation consistent with its advertised schema", (schema) => {
  const compiled = compileJsonSchema(toJsonSchema(schema));
  for (const value of [null, { ready: true }, { ready: false }, [1, 2], [2, 1]]) {
    expect(compiled.validate(value).ok).toBe(validate(schema, value).ok);
  }
});

it("compares object literals independently of key order and preserves array order", () => {
  const schema = S.Json({ const: { a: 1, b: [true, null] } });
  expect(validate(schema, { b: [true, null], a: 1 }).ok).toBe(true);
  expect(validate(schema, { a: 1, b: [null, true] }).ok).toBe(false);
  expect(validate(schema, { a: 1, b: [true, null], extra: 1 }).ok).toBe(false);
});
