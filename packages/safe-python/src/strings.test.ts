import { describe, expect, it } from "vitest";
import { readString } from "./strings.js";
import { PythonSource, PythonSyntaxError } from "./source.js";

describe("Python non-interpolated string literals", () => {
  it.each([
    ["''", ""], ['"hello"', "hello"], ["u'hello'", "hello"], ["U'🙂'", "🙂"],
    [String.raw`'\a\b\f\n\r\t\v\\\'\"'`, "\x07\b\f\n\r\t\v\\'\""],
    [String.raw`'\0\12\1234'`, "\0\nS4"], [String.raw`'\x41\u03bb\U0001f40d'`, "Aλ🐍"],
    [String.raw`'\N{LATIN CAPITAL LETTER A}\N{SNAKE}\N{LF}'`, "A🐍\n"],
    [String.raw`'\N{cjk unified ideograph-4e00}\N{hangul syllable ga}'`, "一가"],
    ["'''one\r\ntwo\rthree\nfour'''", "one\ntwo\nthree\nfour"],
    ['"""one"two""three"""', 'one"two""three'],
    ["'one\\\r\ntwo'", "onetwo"], ["'one\\\rtwo'", "onetwo"],
    [String.raw`r'\n\x41\N{SNAKE}'`, String.raw`\n\x41\N{SNAKE}`],
    [String.raw`R'can\'t'`, String.raw`can\'t`],
    ["r'a\\\r\nb'", "a\\\nb"],
    [String.raw`'\q\8'`, String.raw`\q\8`]
  ])("decodes %s", (text, expected) => {
    const source = new PythonSource(text);
    const token = readString(source);
    expect(token.kind).toBe("string");
    expect([...token.value]).toEqual(Array.from(expected, (character) => character.codePointAt(0)));
    expect(token.text).toBe(text);
    expect(source.done).toBe(true);
  });

  it("preserves escaped surrogate code points separately from astral characters", () => {
    const token = readString(new PythonSource(String.raw`'\ud800\udc00𐀀\U0000d800'`));
    expect([...token.value]).toEqual([0xd800, 0xdc00, 0x10000, 0xd800]);
  });

  it.each([
    ["b''", []], ["B'abc'", [97, 98, 99]],
    [String.raw`b'\x00\xff\377'`, [0, 255, 255]],
    [String.raw`br'\n'`, [92, 110]], [String.raw`Rb'\n'`, [92, 110]],
    [String.raw`b'\u0041'`, [92, 117, 48, 48, 52, 49]],
    [String.raw`b'\U00000041'`, [92, 85, 48, 48, 48, 48, 48, 48, 52, 49]],
    [String.raw`b'\N{A}'`, [92, 78, 123, 65, 125]],
    ["b'''a\r\nb'''", [97, 10, 98]], ["b'a\\\nb'", [97, 98]]
  ])("decodes bytes %s", (text, expected) => {
    const token = readString(new PythonSource(text));
    expect(token.kind).toBe("bytes");
    expect(token.value).toBeInstanceOf(Uint8Array);
    expect([...token.value]).toEqual(expected);
  });

  it("warns about overlarge octal escapes while preserving Python's values", () => {
    const warnings: string[] = [];
    const token = readString(new PythonSource(String.raw`'\400\777'`), (message) => warnings.push(message));
    expect([...token.value]).toEqual([256, 511]);
    expect(warnings).toHaveLength(1);
    expect([...readString(new PythonSource(String.raw`b'\400\777'`)).value]).toEqual([0, 255]);
  });

  it("reports only the first invalid escape warning for each literal", () => {
    const source = new PythonSource("\n'\\q\\z'", "escapes.py");
    source.advance();
    const warnings: unknown[] = [];
    readString(source, (message, position) => warnings.push({ message, position }));
    expect(warnings).toEqual([{
      message: '"\\q" is an invalid escape sequence. Such sequences will not work in the future. Did you mean "\\\\q"? A raw string is also an option.',
      position: { offset: 2, line: 2, column: 1 }
    }]);
  });

  it("does not warn about non-ASCII escaped characters", () => {
    const warnings: string[] = [];
    const token = readString(new PythonSource(String.raw`'\é\🙂'`), (message) => warnings.push(message));
    expect([...token.value]).toEqual([92, 233, 92, 0x1f642]);
    expect(warnings).toEqual([]);
    readString(new PythonSource(String.raw`'\é\q'`), (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"\\q"');
  });

  it.each([String.raw`'\q\x'`, "'\\q", "b'\\qé'"])(
    "does not emit escape warnings for a failed literal %s", (text) => {
      const warnings: string[] = [];
      expect(() => readString(new PythonSource(text), (message) => warnings.push(message))).toThrow(PythonSyntaxError);
      expect(warnings).toEqual([]);
    }
  );

  it.each([
    "'unterminated", "'line\nbreak'", "'''unterminated", "r'\\'", "'ends\\",
    "b'é'", "br'é'", "b'\\é'", "b'🙂'", "br'\\🙂'",
    String.raw`'\x'`, String.raw`'\x0'`, String.raw`'\xGG'`,
    String.raw`'\u123'`, String.raw`'\U0000000'`, String.raw`'\U00110000'`,
    String.raw`'\N'`, String.raw`'\N{}'`, String.raw`'\N{unknown}'`,
    String.raw`'\N{KEYCAP DIGIT ONE}'`, String.raw`'\N{SNAKE'`,
    "ur'bad'", "bu'bad'", "r 'bad'", "rr'bad'"
  ])("rejects malformed literal %s", (text) => {
    expect(() => readString(new PythonSource(text))).toThrow(PythonSyntaxError);
  });

  it("stops at the first literal, leaving concatenation to the parser", () => {
    const source = new PythonSource("'one' 'two'");
    expect([...readString(source).value]).toEqual([111, 110, 101]);
    expect(source.position).toEqual({ offset: 5, line: 1, column: 5 });
  });

  it("retains original source spans through normalized newlines", () => {
    const source = new PythonSource("\r\n'''🙂\r\na'''", "text.py");
    source.advance();
    expect(readString(source)).toMatchObject({
      start: { offset: 2, line: 2, column: 0 },
      end: { offset: 13, line: 3, column: 4 }
    });
  });
});
