import { describe, expect, it } from "vitest";
import { isIdentifierStart, isIdentifierContinue, readIdentifier } from "./identifiers.js";
import { PythonSource, PythonSyntaxError } from "./source.js";

describe("Python Unicode identifier characters", () => {
  it.each(["a", "Z", "_", "λ", "變", "𝒙", "℘", "ᢅ", "\u{105c0}"])(
    "accepts %s at the beginning and within a name", (character) => {
      expect(isIdentifierStart(character.codePointAt(0)!)).toBe(true);
      expect(isIdentifierContinue(character.codePointAt(0)!)).toBe(true);
    }
  );

  it.each(["0", "٩", "\u0301", "·", "\u203f", "\u200c", "\u200d"])(
    "accepts %s only within a name", (character) => {
      expect(isIdentifierStart(character.codePointAt(0)!)).toBe(false);
      expect(isIdentifierContinue(character.codePointAt(0)!)).toBe(true);
    }
  );

  it.each([" ", "-", "🙂", "\uFEFF", "\ud800", "\0", "²"])(
    "rejects %j in either position", (character) => {
      expect(isIdentifierStart(character.codePointAt(0)!)).toBe(false);
      expect(isIdentifierContinue(character.codePointAt(0)!)).toBe(false);
    }
  );

  it.each([-1, 0x110000, NaN, Infinity, 65.5, 0x105c0 + 0.5])(
    "rejects invalid code point %s", (point) => {
      expect(isIdentifierStart(point)).toBe(false);
      expect(isIdentifierContinue(point)).toBe(false);
    }
  );

  it("keeps raw spelling for keyword recognition before parser normalization", () => {
    const source = new PythonSource("ｉｆ 𝒙_2\u0301");
    expect(readIdentifier(source)).toEqual({
      kind: "name", text: "ｉｆ", start: { offset: 0, line: 1, column: 0 },
      end: { offset: 2, line: 1, column: 2 }
    });
    source.advance();
    expect(readIdentifier(source)).toEqual({
      kind: "name", text: "𝒙_2\u0301", start: { offset: 3, line: 1, column: 3 },
      end: { offset: 8, line: 1, column: 7 }
    });
  });

  it.each(["", "1name", "\u0301name", "🙂"])("requires an identifier start in %j", (text) => {
    expect(() => readIdentifier(new PythonSource(text))).toThrow(PythonSyntaxError);
  });

  it("leaves delimiters and invalid characters to the lexer", () => {
    for (const suffix of ["(", ":", "\n", "🙂"]) {
      const source = new PythonSource(`name${suffix}`);
      expect(readIdentifier(source).text).toBe("name");
      expect(source.peek()).toBe(suffix);
    }
  });

  it("accepts Unicode join controls within names as CPython 3.14 does", () => {
    expect(readIdentifier(new PythonSource("a\u200cb\u200dc")).text).toBe("a\u200cb\u200dc");
  });
});
