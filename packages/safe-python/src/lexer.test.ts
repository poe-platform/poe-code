import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { PythonSyntaxError } from "./source.js";
import * as safePython from "./index.js";

function tokens(text: string): string[] {
  return [...lex(text)].map((token) => `${token.kind}:${token.text}`);
}

describe("Python token stream", () => {
  it("is available through the package entry point", () => {
    expect(safePython).toHaveProperty("lex", lex);
  });
  it("connects names, operators, exact numeric values, and suite boundaries", () => {
    expect(tokens("if 𝒙 >= 2:\n    total += 0x_ff\n    pass\ndone = True")).toEqual([
      "name:if", "name:𝒙", "operator:>=", "integer:2", "operator::", "newline:\n",
      "indent:    ", "name:total", "operator:+=", "integer:0x_ff", "newline:\n",
      "name:pass", "newline:\n", "dedent:", "name:done", "operator:=", "name:True", "newline:", "end:"
    ]);
    expect([...lex("9007199254740993")][0]).toMatchObject({ kind: "integer", value: 9007199254740993n });
  });

  it("ignores blank and comment-only lines without changing indentation", () => {
    expect(tokens("# heading\nif True:\n    # comment\n\n    x\n  # misleading indent\ny\n")).toEqual([
      "name:if", "name:True", "operator::", "newline:\n", "indent:    ",
      "name:x", "newline:\n", "dedent:", "name:y", "newline:\n", "end:"
    ]);
  });

  it("joins bracketed expressions across comments, blank lines, and indentation", () => {
    expect(tokens("x = (\n  1 + # comment\n\n       2\n)\n")).toEqual([
      "name:x", "operator:=", "operator:(", "integer:1", "operator:+", "integer:2", "operator:)", "newline:\n", "end:"
    ]);
  });

  it("joins explicit continuation lines without introducing indentation", () => {
    expect(tokens("x = 1 + \\\r\n        2\n")).toEqual([
      "name:x", "operator:=", "integer:1", "operator:+", "integer:2", "newline:\n", "end:"
    ]);
  });

  it("preserves pre-continuation indentation when the first line contains only a backslash", () => {
    expect(tokens("if True:\n    \\\n  x\n")).toEqual([
      "name:if", "name:True", "operator::", "newline:\n", "indent:    ", "name:x", "newline:\n", "dedent:", "end:"
    ]);
  });

  it.each(["#comment\n", "\n", "  #comment\n"])(
    "ignores indentation on an explicitly continued blank logical line ending with %j", (ending) => {
      expect(tokens(`if a:\n    x\n  \\\n${ending}    y`)).toEqual([
        "name:if", "name:a", "operator::", "newline:\n", "indent:    ",
        "name:x", "newline:\n", "name:y", "newline:", "dedent:", "end:"
      ]);
    }
  );

  it("integrates string prefixes and multiline literals without false suite tokens", () => {
    const result = [...lex("value = r'\\n' b'\\xff' U'''a\r\nb'''\n")];
    expect(result.map((token) => token.kind)).toEqual(["name", "operator", "string", "bytes", "string", "newline", "end"]);
    expect(result[2]).toMatchObject({ value: Uint32Array.from([92, 110]) });
    expect(result[3]).toMatchObject({ value: Uint8Array.from([255]) });
    expect(result[4]).toMatchObject({ value: Uint32Array.from([97, 10, 98]) });
  });

  it("does not confuse longer names with string prefixes", () => {
    expect(tokens("rub rb_value r b u")).toEqual([
      "name:rub", "name:rb_value", "name:r", "name:b", "name:u", "newline:", "end:"
    ]);
  });

  it.each(["**=", "//=", ">>=", "<<=", "...", "**", "//", "<<", ">>", "<=", ">=", "==", "!=", ":=", "->", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@="])(
    "uses longest-match operator %s", (operator) => {
      expect(tokens(`a ${operator} b`)).toEqual(["name:a", `operator:${operator}`, "name:b", "newline:", "end:"]);
    }
  );

  it("distinguishes decimal points, attributes, ellipses, and unary signs", () => {
    expect(tokens("-.5 + 1.0.real ...")).toEqual([
      "operator:-", "float:.5", "operator:+", "float:1.0", "operator:.", "name:real", "operator:...", "newline:", "end:"
    ]);
  });

  it.each(["", "# only", " \t\f\n", "\n\n"])("emits only EOF for %j", (text) => {
    expect(tokens(text)).toEqual(["end:"]);
  });

  it("flushes multiple suites at EOF after the implicit final newline", () => {
    expect(tokens("if a:\n  if b:\n    c").slice(-4)).toEqual(["newline:", "dedent:", "dedent:", "end:"]);
  });

  it.each(["(", "[1", "{1: 2", "([)]", ")", "x = 1 \\ ", "x = 1 \\", "x = 1 \\\n", "$", "x\u00a0y"])(
    "rejects invalid lexical structure %j", (text) => {
      expect(() => [...lex(text)]).toThrow(PythonSyntaxError);
    }
  );

  it("keeps filename and opening delimiter location in unclosed-delimiter errors", () => {
    expect(() => [...lex("\n  (1", { filename: "open.py" })]).toThrow(expect.objectContaining({
      filename: "open.py", position: { offset: 3, line: 2, column: 2 }
    }));
  });

  it("propagates indentation errors", () => {
    expect(() => [...lex("if a:\n    b\n  c")]).toThrow(expect.objectContaining({ name: "IndentationError" }));
    expect(() => [...lex("if a:\n\tb\n        c")]).toThrow(expect.objectContaining({ name: "TabError" }));
  });

  it("reports warnings through the caller's callback", () => {
    const warnings: string[] = [];
    expect([...lex("1if True else 2\n'\\q'", { onWarning: (message) => warnings.push(message) })]).toHaveLength(9);
    expect(warnings).toHaveLength(2);
  });

  it("is lazy and does not inspect later syntax until requested", () => {
    const stream = lex("a\n$");
    expect(stream.next().value).toMatchObject({ kind: "name", text: "a" });
    expect(stream.next().value).toMatchObject({ kind: "newline" });
    expect(() => stream.next()).toThrow(PythonSyntaxError);
  });
});
