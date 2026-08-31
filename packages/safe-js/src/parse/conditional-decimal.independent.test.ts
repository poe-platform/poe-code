import { describe, expect, it } from "vitest";

import { run } from "../run.js";
import { parse } from "./parser.js";
import { tokenize } from "./tokenizer.js";

describe("independent conditional decimal review", () => {
  it("preserves CRLF, tab, numeric spelling, and EOF locations", () => {
    const source = "\r\n\tenabled?.1_25e+2:0";
    const tokens = tokenize(source);
    expect(tokens[1]).toEqual({
      type: "punctuator",
      value: "?",
      start: { line: 2, column: 9, offset: 10 },
      end: { line: 2, column: 10, offset: 11 }
    });
    expect(tokens[2]).toEqual({
      type: "numeric",
      value: ".1_25e+2",
      start: { line: 2, column: 10, offset: 11 },
      end: { line: 2, column: 18, offset: 19 }
    });
    expect(tokens.at(-1)).toEqual({
      type: "eof",
      value: "",
      start: { line: 2, column: 20, offset: 21 },
      end: { line: 2, column: 20, offset: 21 }
    });
    for (const token of tokens) {
      expect(source.slice(token.start.offset, token.end.offset)).toBe(token.value);
    }
  });

  it.each(["", "_5", "$5", "é", "\\u0061", "[.5]", "(.5)", " _5", "\n_5", "/*x*/_5"])(
    "retains optional-chain token for nondecimal suffix %j",
    (suffix) => {
      expect(tokenize(`value?.${suffix}`)[1]).toEqual({
        type: "punctuator",
        value: "?.",
        start: { line: 1, column: 6, offset: 5 },
        end: { line: 1, column: 8, offset: 7 }
      });
    }
  );

  it.each([
    "value?. 5:0",
    "value?.\n5:0",
    "value?./*x*/5:0",
    "value?.٥:0",
    "value?.５:0",
    "value?.\\u0035:0",
    "value?.5n:0",
    "value?.5foo:0",
    "value?.5\\u0061:0",
    "value?.5e+:0",
    "value?.5__0:0",
    "value?.5_e1:0",
    "value?.5e1_:0",
    "value?.5e+_1:0",
    "value?.5 = 1:0"
  ])("rejects malformed decimal or optional chain %s", (source) => {
    expect(() => parse(source)).toThrow();
  });

  it.each<[string, unknown]>([
    ["const enabled = true; return [enabled?.5:0, enabled?.1_25e+2:0];", [0.5, 12.5]],
    ["const enabled = false; return [enabled?.5:0, enabled?.1_25e+2:0];", [0, 0]],
    ["return [true ?/*x*/.5:0, true?\n.5:0, true?.5/*x*/:0];", [0.5, 0.5, 0.5]],
    ["return [true?.0_0e+0_1:1, true?.5/2:0, true?.5.toString():0];", [0, 0.25, "0.5"]],
    ["return [false?.1:true?.2:.3, true?false?.1:.2:.3];", [0.2, 0.2]],
    ["return `outer=${true?`inner=${false?.1:.2}`:0}`;", "outer=inner=0.2"],
    ["return `x=${true?.5/2:0}, y=${({value:.5})?.value}`;", "x=0.25, y=0.5"],
    [
      "const object = { value: .5, method(amount) { return this.value + amount; } }; return [object?.method?.(.5), object?.['value']];",
      [1, 0.5]
    ],
    [
      "let calls = 0; const value = null; function tick() { calls++; return .5; } const results = [value?.[tick()], value?.(tick()), value?.method(tick())]; return [results, calls];",
      [[undefined, undefined, undefined], 0]
    ],
    [
      "let calls = 0; function condition() { calls++; return true; } function fail() { throw 'unselected'; } return [condition()?.5:fail(), false?.5 + fail():.25, calls];",
      [0.5, 0.25, 1]
    ]
  ])("executes without changing branch or chain semantics: %s", async (source, expected) => {
    await expect(run(source, { modules: {} })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });
});
