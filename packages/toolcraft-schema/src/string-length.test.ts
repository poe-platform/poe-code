import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, toJsonSchema, validate } from "./index.js";

const cases = [
  { value: "😀", minLength: 2, valid: false },
  { value: "😀", maxLength: 1, valid: true },
  { value: "😀a", minLength: 3, valid: false },
  { value: "😀a", maxLength: 1, valid: false },
  { value: "e\u0301", minLength: 2, maxLength: 2, valid: true },
  { value: "\ud800", minLength: 1, maxLength: 1, valid: true },
  { value: "ab", minLength: 2, maxLength: 2, valid: true },
  { value: "", maxLength: 0, valid: true }
];

describe.each(cases)("Unicode string length: %j", ({ value, minLength, maxLength, valid }) => {
  it("agrees with the exported JSON Schema evaluator", () => {
    const schema = S.String({ minLength, maxLength });
    const result = validate(schema, value);

    expect(compileJsonSchema(toJsonSchema(schema)).validate(value).ok).toBe(valid);
    expect(result.ok).toBe(valid);
    if (!result.ok) {
      expect(result.issues[0]?.received).toBe(`string with length ${[...value].length}`);
    }
  });

  it("applies the same constraints when constructing defaults", () => {
    const construct = () => S.String({ minLength, maxLength, default: value });

    if (valid) expect(construct).not.toThrow();
    else expect(construct).toThrow();
  });
});
