import { describe, expect, it } from "vitest";
import { readNumber } from "./numbers.js";
import { PythonSource, PythonSyntaxError } from "./source.js";

describe("Python numeric literals", () => {
  it.each([
    ["0", 0n], ["000_000", 0n], ["123", 123n],
    ["9_007_199_254_740_993", 9007199254740993n],
    ["0b1010_0011", 163n], ["0B_1", 1n],
    ["0o755", 493n], ["0O_7_0", 56n],
    ["0xDead_Beef", 3735928559n], ["0X_FF", 255n]
  ])("reads exact integer %s", (text, value) => {
    const source = new PythonSource(text);
    expect(readNumber(source)).toEqual({
      kind: "integer", value, text,
      start: { offset: 0, line: 1, column: 0 },
      end: { offset: text.length, line: 1, column: text.length }
    });
    expect(source.done).toBe(true);
  });

  it.each([
    ["1.", 1], [".5", 0.5], ["0.0", 0], ["00_12.5", 12.5],
    ["01e2", 100], ["1e+2", 100], ["1E-2", 0.01],
    ["1_2.3_4e5_6", 12.34e56], [".5e1", 5],
    ["1.e2", 100], ["1e999", Infinity], ["1e-999", 0],
    ["5e-324", Number.MIN_VALUE]
  ])("reads float %s", (text, value) => {
    const source = new PythonSource(text);
    expect(readNumber(source)).toMatchObject({ kind: "float", value, text });
    expect(source.done).toBe(true);
  });

  it.each([
    ["2j", 2], ["00_12J", 12], [".5j", 0.5],
    ["1.e2J", 100], ["1_2.3_4e-5j", 0.0001234],
    ["1e999j", Infinity], ["9007199254740993j", 9007199254740992]
  ])("reads imaginary %s", (text, value) => {
    const source = new PythonSource(text);
    expect(readNumber(source)).toMatchObject({ kind: "imaginary", value, text });
    expect(source.done).toBe(true);
  });

  it.each([
    "01", "0_1", "000123", "0b", "0b_", "0b2", "0b102", "0b1j",
    "0o8", "0o78", "0x", "0x__1", "0x1g", "0x1j", "0x1_",
    "1_", "1__2", "1_.0", "1._0", "1.0_", "1e", "1e+", "1e-",
    "1e_2", "1e+_2", "1e2_", "1j_", "1j2", "2abc"
  ])("rejects malformed literal %s", (text) => {
    const source = new PythonSource(text, "invalid.py");
    expect(() => readNumber(source)).toThrow(PythonSyntaxError);
  });

  it.each(["+", "-", "*", "/", ")", ",", "]", "\n", " ", "#comment"])(
    "leaves following %j for the lexer", (suffix) => {
      const source = new PythonSource(`123${suffix}`);
      expect(readNumber(source).value).toBe(123n);
      expect(source.text.slice(source.position.offset)).toBe(suffix);
    }
  );

  it("preserves source spans after Unicode and CRLF", () => {
    const source = new PythonSource("🙂\r\n  0X_FF + 1", "source.py");
    for (let count = 0; count < 4; count++) source.advance();
    expect(readNumber(source)).toEqual({
      kind: "integer", value: 255n, text: "0X_FF",
      start: { offset: 6, line: 2, column: 2 },
      end: { offset: 11, line: 2, column: 7 }
    });
  });

  it("reports the start of an invalid literal in its original file", () => {
    const source = new PythonSource("\r\n01", "number.py");
    source.advance();
    expect(() => readNumber(source)).toThrow(expect.objectContaining({
      filename: "number.py", position: { offset: 2, line: 2, column: 0 }
    }));
  });

  it("leaves a float's attribute dot unconsumed", () => {
    const source = new PythonSource("1.0.real");
    expect(readNumber(source)).toMatchObject({ kind: "float", value: 1, text: "1.0" });
    expect(source.peek()).toBe(".");
  });

  it("leaves a hexadecimal integer's attribute dot unconsumed", () => {
    const source = new PythonSource("0xff.real");
    expect(readNumber(source)).toMatchObject({ kind: "integer", value: 255n, text: "0xff" });
    expect(source.peek()).toBe(".");
  });

  it.each(["1if", "1else", "1and", "1or", "1in", "1is", "1not", "1for", "1.0if", "1jif", "0x1if"])(
    "preserves Python's deprecated keyword adjacency in %s", (text) => {
      const source = new PythonSource(`${text} `);
      const warnings: string[] = [];
      const token = readNumber(source, (message) => warnings.push(message));
      expect(token.value).toBe(token.kind === "integer" ? 1n : 1);
      expect(warnings).toHaveLength(1);
      expect(source.peek() >= "a" && source.peek() <= "z").toBe(true);
    }
  );

  it.each(["1iffy", "1elsewhere", "1android", "1orange", "1inside", "1island", "1nothing", "1format"])(
    "does not mistake a name for an adjacent keyword in %s", (text) => {
      expect(() => readNumber(new PythonSource(text))).toThrow(PythonSyntaxError);
    }
  );

  it.each(["", ".", "-1", "+1", "NaN", "inf", "١"])(
    "does not treat %j as an unsigned numeric token", (text) => {
      expect(() => readNumber(new PythonSource(text))).toThrow(PythonSyntaxError);
    }
  );
});
