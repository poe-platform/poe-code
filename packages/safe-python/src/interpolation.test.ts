import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { PythonSyntaxError } from "./source.js";

function stream(text: string): string[] {
  return [...lex(text)].map((token) => `${token.kind}:${"content" in token ? token.content : token.text}`);
}

describe("interpolated string tokenization", () => {
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

  it("handles deep nested interpolation with an explicit stack", () => {
    let text = "x";
    for (let depth = 0; depth < 300; depth++) text = `f"{${text}}"`;
    expect([...lex(text)]).toHaveLength(1203);
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
