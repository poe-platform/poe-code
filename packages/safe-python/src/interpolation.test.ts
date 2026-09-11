import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { PythonSyntaxError } from "./source.js";

function stream(text: string): string[] {
  return [...lex(text)].map((token) => `${token.kind}:${"content" in token ? token.content : token.text}`);
}

describe("interpolated string tokenization", () => {
  it("decodes text escapes while retaining original content for tooling", () => {
    const token = [...lex(String.raw`f"{{\n\x41\uD800\U0001F40D\N{SNAKE}}}{x}"`)][1];
    expect(token).toMatchObject({ kind: "fstring-middle", value: Uint32Array.from([123, 10, 65, 0xd800, 0x1f40d, 0x1f40d, 125]) });
  });

  it("leaves raw escapes and backslashes before fields intact", () => {
    expect([...lex(String.raw`rf"\n\{x}"`)][1]).toMatchObject({ value: Uint32Array.from([92, 110, 92]) });
    expect([...lex(String.raw`f"\{x}"`)][1]).toMatchObject({ value: Uint32Array.from([92]) });
  });

  it("decodes format text and escaped universal newlines", () => {
    expect([...lex('f"{x:\\x3e10}"')][4]).toMatchObject({ value: Uint32Array.from([62, 49, 48]) });
    expect([...lex('f"a\\\r\nb"')][1]).toMatchObject({ value: Uint32Array.from([97, 98]), content: 'a\\\nb' });
  });

  it.each([String.raw`f"\x0"`, String.raw`f"\u12"`, String.raw`f"\U00110000"`, String.raw`f"\N{NO SUCH NAME}"`])("rejects invalid escape %s", text => {
    expect(() => [...lex(text)]).toThrow(SyntaxError);
  });
  it("reports the first invalid escape of each text chunk at its source position", () => {
    const warnings: Array<{ message: string; offset: number }> = [];
    Array.from(lex(String.raw`f"{{\q\z{x}\777"`, { onWarning: (message, position) => warnings.push({ message, offset: position.offset }) }));
    expect(warnings).toMatchObject([{ message: expect.stringContaining('"\\q"'), offset: 4 }, { message: expect.stringContaining("invalid octal"), offset: 11 }]);
    const malformed: string[] = [];
    expect(() => [...lex(String.raw`f"\q\xZ"`, { onWarning: message => malformed.push(message) })]).toThrow(SyntaxError);
    expect(malformed).toEqual([]);
  });
  it.each(["f", "F", "fr", "Rf", "t", "T", "tr", "Rt"])("reads %s strings and expression tokens", (prefix) => {
    const flavor = prefix.toLowerCase().includes("f") ? "fstring" : "tstring";
    expect(stream(`${prefix}'hello {name}!'`)).toEqual([
      `${flavor}-start:${prefix}'`, `${flavor}-middle:hello `, "operator:{", "name:name",
      "operator:}", `${flavor}-middle:!`, `${flavor}-end:'`, "newline:", "end:"
    ]);
  });

  it("collapses doubled braces in literal text without opening a field", () => {
    expect(stream('f"a{{b}}c"')).toEqual([
      'fstring-start:f"', "fstring-middle:a{b}c", 'fstring-end:"', "newline:", "end:"
    ]);
  });

  it("supports conversions, debug expressions, and nested format fields", () => {
    expect(stream('f"{value = !r:>{width}.{precision}f}"')).toEqual([
      'fstring-start:f"', "operator:{", "name:value", "operator:=", "operator:!", "name:r", "operator::",
      "fstring-middle:>", "operator:{", "name:width", "operator:}", "fstring-middle:.",
      "operator:{", "name:precision", "operator:}", "fstring-middle:f", "operator:}",
      'fstring-end:"', "newline:", "end:"
    ]);
  });

  it("treats a top-level colon as format syntax, including :=", () => {
    expect(stream('f"{x:=10}"')).toContain("fstring-middle:=10");
    expect(stream('f"{(x:=10)}"')).toContain("operator::=");
  });

  it("allows dictionaries, slices, strings, and nested f/t strings in fields", () => {
    expect(stream(`f"{ {'a': [1, 2]}['a'][1:] } {t"{x}"}"`)).toEqual([
      'fstring-start:f"', "operator:{", "operator:{", "string:'a'", "operator::", "operator:[",
      "integer:1", "operator:,", "integer:2", "operator:]", "operator:}", "operator:[", "string:'a'",
      "operator:]", "operator:[", "integer:1", "operator::", "operator:]", "operator:}",
      "fstring-middle: ", "operator:{", 'tstring-start:t"', "operator:{", "name:x", "operator:}",
      'tstring-end:"', "operator:}", 'fstring-end:"', "newline:", "end:"
    ]);
  });

  it("allows quote reuse, backslash continuations, comments, and physical newlines in fields", () => {
    expect(stream('f"{ "same quote" + \\\n "next" # comment\n}"')).toEqual([
      'fstring-start:f"', "operator:{", 'string:"same quote"', "operator:+", 'string:"next"',
      "operator:}", 'fstring-end:"', "newline:", "end:"
    ]);
  });

  it("protects braces in named escapes but not raw named-escape lookalikes", () => {
    expect(stream(String.raw`f"\N{SNAKE}{x}"`)).toContain(String.raw`fstring-middle:\N{SNAKE}`);
    expect(stream(String.raw`rf"\N{x}"`)).toEqual([
      'fstring-start:rf"', String.raw`fstring-middle:\N`, "operator:{", "name:x", "operator:}",
      'fstring-end:"', "newline:", "end:"
    ]);
  });

  it("retains escapes for later decoding and does not backslash-escape a field brace", () => {
    expect(stream(String.raw`f"\n\"\{x}"`)).toEqual([
      'fstring-start:f"', String.raw`fstring-middle:\n\"` + "\\", "operator:{", "name:x", "operator:}",
      'fstring-end:"', "newline:", "end:"
    ]);
  });

  it("normalizes triple-quoted newlines but retains original offsets and text", () => {
    const tokens = [...lex('f"""🙂\r\n{x}\r\n"""')];
    expect(tokens[1]).toMatchObject({
      kind: "fstring-middle", text: "🙂\r\n", content: "🙂\n",
      start: { offset: 4, line: 1, column: 4 }, end: { offset: 8, line: 2, column: 0 }
    });
    expect(tokens.map((token) => token.kind)).not.toContain("indent");
  });

  it("returns to normal indentation after a multiline field", () => {
    const tokens = [...lex('if a:\n  f"{x\n}"\n  y\nz')];
    expect(tokens.filter((token) => token.kind === "indent" || token.kind === "dedent").map((token) => token.kind))
      .toEqual(["indent", "dedent"]);
    expect(tokens.filter((token) => token.kind === "newline")).toHaveLength(4);
  });

  it("handles the deepest valid interpolation stack and rejects excess nesting", () => {
    let text = "x";
    for (let depth = 0; depth < 149; depth++) text = `f"{${text}}"`;
    expect([...lex(text)]).toHaveLength(599);
    expect(()=>[...lex(`f"{${text}}"`)]).toThrow("too many nested f-strings or t-strings");
  });

  it("supports format fields nested within other format fields", () => {
    expect(stream('f"{x:{y:{z}}}"')).toEqual([
      'fstring-start:f"', "operator:{", "name:x", "operator::", "operator:{", "name:y",
      "operator::", "operator:{", "name:z", "operator:}", "operator:}", "operator:}",
      'fstring-end:"', "newline:", "end:"
    ]);
  });

  it("rejects physical newlines in short-string format specifications", () => {
    expect(() => [...lex('f"{x:>10\nmore}"')]).toThrow(PythonSyntaxError);
    expect(stream('f"""{x:>10\nmore}"""')).toContain("fstring-middle:>10\nmore");
  });

  it.each(['f"}"', 'f"{x"', 'f"{x:10"', 'f"unterminated', 'f"a\nb"', 'f"{(]}"', '(f"{)}")'])(
    "rejects broken lexical boundaries in %s", (text) => {
      expect(() => [...lex(text)]).toThrow(PythonSyntaxError);
    }
  );
});
