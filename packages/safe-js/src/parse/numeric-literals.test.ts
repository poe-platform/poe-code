import { describe, expect, it } from "vitest";

import { run } from "../run.js";
import { parse } from "./parser.js";
import { tokenize } from "./tokenizer.js";

describe("numeric literal separators", () => {
  it.each<[string, number]>([
    ["1_000_000", 1000000],
    ["1.2_5", 1.25],
    [".2_5", 0.25],
    ["0.0_1", 0.01],
    ["1e1_0", 1e10],
    ["1E+1_0", 1e10],
    ["1e-1_0", 1e-10],
    ["1_2.3_4e+0_2", 1234],
    ["0xFF_FF", 65535],
    ["0Xf_f", 255],
    ["0b10_01", 9],
    ["0B1_0", 2],
    ["0o7_7", 63],
    ["0O1_0", 8]
  ])("preserves the value and raw spelling of %s", (source, value) => {
    expect(parse(source)).toMatchObject({
      type: "NumericLiteral",
      raw: source,
      value
    });
  });

  it.each([
    "1_",
    "1__0",
    "0_1",
    "1_.0",
    "1._0",
    ".1_",
    ".1__0",
    "1_e2",
    "1e_2",
    "1e+_2",
    "1e2_",
    "1e2__0",
    "0x_FF",
    "0xFF_",
    "0xF__F",
    "0b_1",
    "0b1_",
    "0b1__0",
    "0b1_2",
    "0o_7",
    "0o7_",
    "0o7__1",
    "0o7_8"
  ])("rejects invalid separator placement in %s", (source) => {
    expect(() => parse(source)).toThrow();
  });
});

describe("conditional leading-dot numeric literals", () => {
  it.each(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"])(
    "tokenizes ? and .%s separately with exact positions",
    (digit) => {
      const tokens = tokenize(`enabled?.${digit}:0`);
      expect(tokens[1]).toEqual({
        type: "punctuator",
        value: "?",
        start: { line: 1, column: 8, offset: 7 },
        end: { line: 1, column: 9, offset: 8 }
      });
      expect(tokens[2]).toEqual({
        type: "numeric",
        value: `.${digit}`,
        start: { line: 1, column: 9, offset: 8 },
        end: { line: 1, column: 11, offset: 10 }
      });
    }
  );

  it.each<[string, number]>([
    [".5", 0.5],
    [".1_25", 0.125],
    [".1_25e+2", 12.5],
    [".5E-0_1", 0.05]
  ])("parses the consequent %s as a numeric literal", (raw, value) => {
    expect(parse(`enabled?${raw}:0`)).toMatchObject({
      type: "ConditionalExpression",
      test: { type: "Identifier", name: "enabled" },
      consequent: { type: "NumericLiteral", raw, value },
      alternate: { type: "NumericLiteral", value: 0 }
    });
  });

  it("parses conditional fractions inside template interpolation", () => {
    expect(parse("`value=${enabled?.1_25e+2:0}`")).toMatchObject({
      type: "TemplateLiteral",
      expressions: [
        {
          type: "ConditionalExpression",
          consequent: { type: "NumericLiteral", raw: ".1_25e+2", value: 12.5 }
        }
      ]
    });
  });

  it.each(["enabled?.5", "enabled?.5:", "enabled?.5_:0", "enabled?.5e_2:0"])(
    "still rejects malformed or incomplete expressions: %s",
    (source) => {
      expect(() => parse(source)).toThrow();
    }
  );

  it.each(["value?.member", "value?.[.5]", "value?.(.5)", "value?._5"])(
    "preserves optional chaining when no decimal digit follows: %s",
    (source) => {
      expect(tokenize(source)[1]).toMatchObject({ type: "punctuator", value: "?." });
      expect(() => parse(source)).not.toThrow();
    }
  );

  it.each<[string, unknown]>([
    ["return true?.1_25e+2:0;", 12.5],
    ["return false?.1_25e+2:0;", 0],
    ["return true?.5:missing();", 0.5],
    ["return `value=${true?.5:0}`;", "value=0.5"]
  ])("evaluates through the existing interpreter: %s", async (source, value) => {
    const result = await run(source);
    expect(result.ok).toBe(true);
    expect(result.returnValue).toBe(value);
  });
});
