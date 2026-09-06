import { describe, expect, it } from "vitest";

import {
  parse,
  type NumericLiteral,
  type StringLiteral,
  type TemplateLiteral,
  type VariableDeclaration
} from "./parser.js";
import { formatParseError } from "./format-error.js";
import { collectComments, tokenize, type Token } from "./tokenizer.js";

function simplify(tokens: Token[]): Array<Record<string, unknown>> {
  return tokens.map((token) => ({
    type: token.type,
    value: token.value,
    start: token.start,
    end: token.end
  }));
}

function firstToken(source: string): Token {
  const token = tokenize(source)[0];
  expect(token).toBeDefined();
  return token;
}

function parseStringValue(raw: string): string {
  const statement = parse(`const value = ${raw};`) as VariableDeclaration;
  const init = statement.declarations[0]?.init;
  expect(init?.type).toBe("StringLiteral");
  return (init as StringLiteral).value;
}

function parseNumericValue(raw: string): number {
  const statement = parse(`const value = ${raw};`) as VariableDeclaration;
  const init = statement.declarations[0]?.init;
  expect(init?.type).toBe("NumericLiteral");
  return (init as NumericLiteral).value;
}

function parseTemplateValue(raw: string): TemplateLiteral {
  const expression = parse(raw);
  expect(expression.type).toBe("TemplateLiteral");
  return expression as TemplateLiteral;
}

describe("tokenize", () => {
  it("tokenizes keywords, identifiers, literals, punctuators, and modern operators", () => {
    expect(
      simplify(
        tokenize(
          [
            "const answer = foo?.bar ?? 12.5;",
            "let items = [...rest];",
            "if (true && value !== null) return `x ${name}`;"
          ].join("\n")
        )
      )
    ).toEqual([
      {
        type: "keyword",
        value: "const",
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 6, offset: 5 }
      },
      {
        type: "identifier",
        value: "answer",
        start: { line: 1, column: 7, offset: 6 },
        end: { line: 1, column: 13, offset: 12 }
      },
      {
        type: "punctuator",
        value: "=",
        start: { line: 1, column: 14, offset: 13 },
        end: { line: 1, column: 15, offset: 14 }
      },
      {
        type: "identifier",
        value: "foo",
        start: { line: 1, column: 16, offset: 15 },
        end: { line: 1, column: 19, offset: 18 }
      },
      {
        type: "punctuator",
        value: "?.",
        start: { line: 1, column: 19, offset: 18 },
        end: { line: 1, column: 21, offset: 20 }
      },
      {
        type: "identifier",
        value: "bar",
        start: { line: 1, column: 21, offset: 20 },
        end: { line: 1, column: 24, offset: 23 }
      },
      {
        type: "punctuator",
        value: "??",
        start: { line: 1, column: 25, offset: 24 },
        end: { line: 1, column: 27, offset: 26 }
      },
      {
        type: "numeric",
        value: "12.5",
        start: { line: 1, column: 28, offset: 27 },
        end: { line: 1, column: 32, offset: 31 }
      },
      {
        type: "punctuator",
        value: ";",
        start: { line: 1, column: 32, offset: 31 },
        end: { line: 1, column: 33, offset: 32 }
      },
      {
        type: "keyword",
        value: "let",
        start: { line: 2, column: 1, offset: 33 },
        end: { line: 2, column: 4, offset: 36 }
      },
      {
        type: "identifier",
        value: "items",
        start: { line: 2, column: 5, offset: 37 },
        end: { line: 2, column: 10, offset: 42 }
      },
      {
        type: "punctuator",
        value: "=",
        start: { line: 2, column: 11, offset: 43 },
        end: { line: 2, column: 12, offset: 44 }
      },
      {
        type: "punctuator",
        value: "[",
        start: { line: 2, column: 13, offset: 45 },
        end: { line: 2, column: 14, offset: 46 }
      },
      {
        type: "punctuator",
        value: "...",
        start: { line: 2, column: 14, offset: 46 },
        end: { line: 2, column: 17, offset: 49 }
      },
      {
        type: "identifier",
        value: "rest",
        start: { line: 2, column: 17, offset: 49 },
        end: { line: 2, column: 21, offset: 53 }
      },
      {
        type: "punctuator",
        value: "]",
        start: { line: 2, column: 21, offset: 53 },
        end: { line: 2, column: 22, offset: 54 }
      },
      {
        type: "punctuator",
        value: ";",
        start: { line: 2, column: 22, offset: 54 },
        end: { line: 2, column: 23, offset: 55 }
      },
      {
        type: "keyword",
        value: "if",
        start: { line: 3, column: 1, offset: 56 },
        end: { line: 3, column: 3, offset: 58 }
      },
      {
        type: "punctuator",
        value: "(",
        start: { line: 3, column: 4, offset: 59 },
        end: { line: 3, column: 5, offset: 60 }
      },
      {
        type: "keyword",
        value: "true",
        start: { line: 3, column: 5, offset: 60 },
        end: { line: 3, column: 9, offset: 64 }
      },
      {
        type: "punctuator",
        value: "&&",
        start: { line: 3, column: 10, offset: 65 },
        end: { line: 3, column: 12, offset: 67 }
      },
      {
        type: "identifier",
        value: "value",
        start: { line: 3, column: 13, offset: 68 },
        end: { line: 3, column: 18, offset: 73 }
      },
      {
        type: "punctuator",
        value: "!==",
        start: { line: 3, column: 19, offset: 74 },
        end: { line: 3, column: 22, offset: 77 }
      },
      {
        type: "keyword",
        value: "null",
        start: { line: 3, column: 23, offset: 78 },
        end: { line: 3, column: 27, offset: 82 }
      },
      {
        type: "punctuator",
        value: ")",
        start: { line: 3, column: 27, offset: 82 },
        end: { line: 3, column: 28, offset: 83 }
      },
      {
        type: "keyword",
        value: "return",
        start: { line: 3, column: 29, offset: 84 },
        end: { line: 3, column: 35, offset: 90 }
      },
      {
        type: "template",
        value: "`x ${name}`",
        start: { line: 3, column: 36, offset: 91 },
        end: { line: 3, column: 47, offset: 102 }
      },
      {
        type: "punctuator",
        value: ";",
        start: { line: 3, column: 47, offset: 102 },
        end: { line: 3, column: 48, offset: 103 }
      },
      {
        type: "eof",
        value: "",
        start: { line: 3, column: 48, offset: 103 },
        end: { line: 3, column: 48, offset: 103 }
      }
    ]);
  });

  it("tracks escaped newlines inside strings and templates", () => {
    const tokens = tokenize("'a\\n b'\n`x\n${y}`");

    expect(simplify(tokens)).toEqual([
      {
        type: "string",
        value: "'a\\n b'",
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 8, offset: 7 }
      },
      {
        type: "template",
        value: "`x\n${y}`",
        start: { line: 2, column: 1, offset: 8 },
        end: { line: 3, column: 6, offset: 16 }
      },
      {
        type: "eof",
        value: "",
        start: { line: 3, column: 6, offset: 16 },
        end: { line: 3, column: 6, offset: 16 }
      }
    ]);
  });

  it("rejects regular expression literals", () => {
    expect(() => tokenize("const pattern = /foo/;")).toThrowError(
      "Regular expression literals are not supported at line 1, column 17."
    );
  });

  it("covers JavaScript numeric literal edges used by agent scripts", () => {
    expect(firstToken("1_000_000")).toMatchObject({
      type: "numeric",
      value: "1_000_000"
    });
    expect(parseNumericValue("1_000_000")).toBe(1000000);

    expect(() => tokenize("const bad = 1__000;")).toThrowError(
      "Invalid decimal numeric literal at line 1, column 14."
    );
    expect(() => tokenize("const bad = 1_;")).toThrowError(
      "Invalid decimal numeric literal at line 1, column 14."
    );

    expect(firstToken("_1")).toMatchObject({
      type: "identifier",
      value: "_1"
    });

    expect(parseNumericValue("0x1F")).toBe(31);
    expect(parseNumericValue("0X1F")).toBe(31);
    expect(parseNumericValue("0o17")).toBe(15);
    expect(parseNumericValue("0O17")).toBe(15);
    expect(parseNumericValue("0b1010")).toBe(10);
    expect(parseNumericValue("0B1010")).toBe(10);

    expect(() => tokenize("const legacy = 017;")).toThrowError(
      "Legacy octal numeric literals are not supported in strict mode at line 1, column 16."
    );
    expect(() => tokenize("const invalid = 0_1;")).toThrowError(
      "Invalid decimal numeric literal at line 1, column 18."
    );

    expect(parseNumericValue("1e3")).toBe(1000);
    expect(parseNumericValue("1E3")).toBe(1000);
    expect(parseNumericValue("1e+3")).toBe(1000);
    expect(parseNumericValue("1e-3")).toBe(0.001);
    expect(() => tokenize("const bad = 1e;")).toThrowError(
      "Invalid decimal numeric literal at line 1, column 14."
    );

    expect(parseNumericValue(".5")).toBe(0.5);
    expect(parseNumericValue("5.")).toBe(5);
    expect(parseNumericValue("5.5e2")).toBe(550);

    expect(tokenize("const answer = 1n;")[3]).toMatchObject({ type: "numeric", value: "1n" });
    expect(parseNumericValue("0xFFFFFFFFFFFFFFFF")).toBe(Number("0xFFFFFFFFFFFFFFFF"));
    expect(() => tokenize("const bad = 1abc;")).toThrowError(
      "Invalid number at line 1, column 14."
    );
  });

  it("allows division operators inside template expressions", () => {
    expect(simplify(tokenize("const value = `total: ${count / 2}`;"))).toEqual([
      {
        type: "keyword",
        value: "const",
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 6, offset: 5 }
      },
      {
        type: "identifier",
        value: "value",
        start: { line: 1, column: 7, offset: 6 },
        end: { line: 1, column: 12, offset: 11 }
      },
      {
        type: "punctuator",
        value: "=",
        start: { line: 1, column: 13, offset: 12 },
        end: { line: 1, column: 14, offset: 13 }
      },
      {
        type: "template",
        value: "`total: ${count / 2}`",
        start: { line: 1, column: 15, offset: 14 },
        end: { line: 1, column: 36, offset: 35 }
      },
      {
        type: "punctuator",
        value: ";",
        start: { line: 1, column: 36, offset: 35 },
        end: { line: 1, column: 37, offset: 36 }
      },
      {
        type: "eof",
        value: "",
        start: { line: 1, column: 37, offset: 36 },
        end: { line: 1, column: 37, offset: 36 }
      }
    ]);
  });

  it("tokenizes tagged templates", () => {
    expect(simplify(tokenize("render`value`;"))).toEqual([
      {
        type: "identifier",
        value: "render",
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 7, offset: 6 }
      },
      {
        type: "template",
        value: "`value`",
        start: { line: 1, column: 7, offset: 6 },
        end: { line: 1, column: 14, offset: 13 }
      },
      {
        type: "punctuator",
        value: ";",
        start: { line: 1, column: 14, offset: 13 },
        end: { line: 1, column: 15, offset: 14 }
      },
      {
        type: "eof",
        value: "",
        start: { line: 1, column: 15, offset: 14 },
        end: { line: 1, column: 15, offset: 14 }
      }
    ]);
  });

  it("rejects regex literals after control flow conditions", () => {
    expect(() => tokenize("if (ready) /foo/.test(value);")).toThrowError(
      "Regular expression literals are not supported at line 1, column 12."
    );
  });

  it("rejects numeric literals with invalid trailing characters", () => {
    expect(() => tokenize("const bad = 1foo;")).toThrowError(
      "Invalid number at line 1, column 14."
    );
    expect(() => tokenize("const octal = 0o78;")).toThrowError(
      "Invalid number at line 1, column 18."
    );
  });

  it("rejects unterminated block comments even when the file ends with slash", () => {
    expect(() => tokenize("/* comment /")).toThrowError(
      "Unterminated block comment at line 1, column 1."
    );
  });

  it("terminates line comments at LF and resumes tokenization on the next line", () => {
    const tokens = tokenize("// comment\nx");
    const comments = collectComments("// comment\nx");

    expect(tokens[0]).toMatchObject({
      type: "identifier",
      value: "x",
      start: { line: 2, column: 1, offset: "// comment\n".length }
    });
    expect(comments).toEqual([
      {
        type: "line",
        value: " comment",
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 11, offset: 10 }
      }
    ]);
  });

  it("treats CRLF as one line ending after line comments", () => {
    const tokens = tokenize("// comment\r\nx");
    const comments = collectComments("// comment\r\nx");

    expect(tokens[0]).toMatchObject({
      type: "identifier",
      value: "x",
      start: { line: 2, column: 1, offset: "// comment\r\n".length }
    });
    expect(comments[0]).toMatchObject({
      type: "line",
      value: " comment",
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 11, offset: 10 }
    });
  });

  it("terminates a line comment at EOF without requiring a trailing newline", () => {
    expect(collectComments("// comment")).toEqual([
      {
        type: "line",
        value: " comment",
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 11, offset: 10 }
      }
    ]);
  });

  it("does not nest block comments", () => {
    expect(() => tokenize("/* a /* b */ c */")).toThrowError(
      "Unexpected block comment terminator at line 1, column 16."
    );
  });

  it("reports unterminated block comments at the opening delimiter", () => {
    expect(() => tokenize("/* unterminated")).toThrowError(
      "Unterminated block comment at line 1, column 1."
    );
  });

  it("treats mixed CRLF and LF line endings as one line each", () => {
    const tokens = tokenize("a\r\nb\nc");

    expect(tokens[0]).toMatchObject({
      type: "identifier",
      value: "a",
      start: { line: 1, column: 1, offset: 0 }
    });
    expect(tokens[1]).toMatchObject({
      type: "identifier",
      value: "b",
      start: { line: 2, column: 1, offset: 3 }
    });
    expect(tokens[2]).toMatchObject({
      type: "identifier",
      value: "c",
      start: { line: 3, column: 1, offset: 5 }
    });
  });

  it("rejects HTML-style comment delimiters because Agent Script is not Browser-ES", () => {
    expect(() => tokenize("<!-- comment")).toThrowError(
      "HTML-style comments are not supported in Agent Script at line 1, column 1."
    );
    expect(() => tokenize("--> comment")).toThrowError(
      "HTML-style comments are not supported in Agent Script at line 1, column 1."
    );
  });

  it("ends block comments at the next terminator even when it appears inside comment text", () => {
    expect(() => tokenize('/* "*/" */ x')).toThrowError(
      "Unterminated string literal at line 1, column 7."
    );
  });

  it("formats unterminated block comment errors at the opening comment span", () => {
    const source = ["const value = 1;", "  /* unterminated"].join("\n");

    expect(
      formatParseError(
        source,
        "script.agent.ts",
        new Error("Unterminated block comment at line 2, column 3.")
      )
    ).toMatchObject({
      line: 2,
      column: 3,
      excerpt: ["1 | const value = 1;", "2 |   /* unterminated"].join("\n"),
      caret: "  |   ^"
    });
  });

  it("allows numeric literals with trailing decimal points before property access", () => {
    expect(simplify(tokenize("const value = 1..toString();"))).toEqual([
      {
        type: "keyword",
        value: "const",
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 6, offset: 5 }
      },
      {
        type: "identifier",
        value: "value",
        start: { line: 1, column: 7, offset: 6 },
        end: { line: 1, column: 12, offset: 11 }
      },
      {
        type: "punctuator",
        value: "=",
        start: { line: 1, column: 13, offset: 12 },
        end: { line: 1, column: 14, offset: 13 }
      },
      {
        type: "numeric",
        value: "1.",
        start: { line: 1, column: 15, offset: 14 },
        end: { line: 1, column: 17, offset: 16 }
      },
      {
        type: "punctuator",
        value: ".",
        start: { line: 1, column: 17, offset: 16 },
        end: { line: 1, column: 18, offset: 17 }
      },
      {
        type: "identifier",
        value: "toString",
        start: { line: 1, column: 18, offset: 17 },
        end: { line: 1, column: 26, offset: 25 }
      },
      {
        type: "punctuator",
        value: "(",
        start: { line: 1, column: 26, offset: 25 },
        end: { line: 1, column: 27, offset: 26 }
      },
      {
        type: "punctuator",
        value: ")",
        start: { line: 1, column: 27, offset: 26 },
        end: { line: 1, column: 28, offset: 27 }
      },
      {
        type: "punctuator",
        value: ";",
        start: { line: 1, column: 28, offset: 27 },
        end: { line: 1, column: 29, offset: 28 }
      },
      {
        type: "eof",
        value: "",
        start: { line: 1, column: 29, offset: 28 },
        end: { line: 1, column: 29, offset: 28 }
      }
    ]);
  });

  it("decodes unicode escapes in identifiers", () => {
    expect(firstToken("\\u0041BC")).toMatchObject({
      type: "identifier",
      value: "ABC"
    });

    expect(firstToken("fo\\u006f")).toMatchObject({
      type: "identifier",
      value: "foo"
    });

    expect(firstToken("\\u{61}")).toMatchObject({
      type: "identifier",
      value: "a"
    });
  });

  it("rejects unicode escapes that are not valid identifier starts", () => {
    expect(() => tokenize("\\u{1F600}")).toThrowError(
      "Invalid identifier escape at line 1, column 1."
    );
  });

  it("reports malformed unicode escapes in strings at the escape", () => {
    expect(() => tokenize('"\\u00"')).toThrowError("Invalid unicode escape at line 1, column 2.");
  });

  it("matches V8 string unicode escape behavior", () => {
    expect(parseStringValue('"\\0"').codePointAt(0)).toBe(0);
    expect(parseStringValue('"\\0"')).toHaveLength(1);

    expect([...parseStringValue('"😀"')]).toEqual(["😀"]);

    const loneHighSurrogate = parseStringValue('"\\uD83D"');
    expect(loneHighSurrogate).toHaveLength(1);
    expect(loneHighSurrogate.charCodeAt(0)).toBe(0xd83d);
  });

  it("rejects invalid unicode code point escapes", () => {
    expect(() => tokenize("\\u{110000}")).toThrowError(
      "Invalid unicode escape at line 1, column 4."
    );

    expect(() => tokenize("\\u{}")).toThrowError("Invalid unicode escape at line 1, column 1.");
  });

  it("handles string and template literal escape edges", () => {
    expect(parseStringValue("'\\n'")).toBe("\n");
    expect(parseStringValue('"\\n"')).toBe("\n");

    const newlineTemplate = parseTemplateValue("`\\n`");
    expect(newlineTemplate.quasis[0]?.value).toEqual({
      raw: "\\n",
      cooked: "\n"
    });

    expect(parseStringValue("'\\x4A'")).toBe("J");
    expect(() => tokenize("'\\x'")).toThrowError("Invalid hex escape at line 1, column 2.");
    expect(() => tokenize("'\\x4'")).toThrowError("Invalid hex escape at line 1, column 2.");

    expect(parseStringValue("'\\0'")).toBe("\0");
    expect(parseStringValue("'\\0a'")).toBe("\0a");
    expect(() => tokenize("'\\01'")).toThrowError(
      "Legacy octal escape sequences are not supported at line 1, column 2."
    );

    expect(parseStringValue('"a\\\n"')).toBe("a");

    expect(() => tokenize("'unterminated")).toThrowError(
      "Unterminated string literal at line 1, column 1."
    );

    const nestedTemplate = parseTemplateValue("`${1 + `nested`}`");
    expect(nestedTemplate.expressions[0]).toMatchObject({
      type: "BinaryExpression",
      right: {
        type: "TemplateLiteral",
        quasis: [
          {
            value: {
              raw: "nested",
              cooked: "nested"
            }
          }
        ]
      }
    });

    expect(() => tokenize("`${")).toThrowError(
      "Unterminated template expression at line 1, column 2."
    );

    const escapedTemplate = parseTemplateValue("`\\$\\``");
    expect(escapedTemplate.quasis[0]?.value).toEqual({
      raw: "\\$\\`",
      cooked: "$`"
    });

    const crlfTemplate = parseTemplateValue("`a\r\nb`");
    expect(crlfTemplate.quasis[0]?.value).toEqual({
      raw: "a\r\nb",
      cooked: "a\nb"
    });

    expect(parseStringValue(`"a\u2028b"`)).toBe("a\u2028b");
    expect(parseStringValue(`"a\u2029b"`)).toBe("a\u2029b");
  });
});
