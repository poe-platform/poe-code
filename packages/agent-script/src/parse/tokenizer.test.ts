import { describe, expect, it } from "vitest";

import { tokenize, type Token } from "./tokenizer.js";

function simplify(tokens: Token[]): Array<Record<string, unknown>> {
  return tokens.map(token => ({
    type: token.type,
    value: token.value,
    start: token.start,
    end: token.end
  }));
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

  it("rejects bigint literals", () => {
    expect(() => tokenize("const answer = 1n;")).toThrowError(
      "BigInt literals are not supported at line 1, column 17."
    );
  });

  it("allows division operators inside template expressions", () => {
    expect(
      simplify(tokenize("const value = `total: ${count / 2}`;"))
    ).toEqual([
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

  it("rejects tagged templates", () => {
    expect(() => tokenize("render`value`;")).toThrowError(
      "Tagged template literals are not supported at line 1, column 7."
    );
  });

  it("rejects regex literals after control flow conditions", () => {
    expect(() => tokenize("if (ready) /foo/.test(value);")).toThrowError(
      "Regular expression literals are not supported at line 1, column 12."
    );
  });

  it("rejects numeric literals with invalid trailing characters", () => {
    expect(() => tokenize("const bad = 1foo;")).toThrowError(
      "Invalid numeric literal at line 1, column 14."
    );
    expect(() => tokenize("const octal = 0o78;")).toThrowError(
      "Invalid numeric literal at line 1, column 18."
    );
  });

  it("rejects unterminated block comments even when the file ends with slash", () => {
    expect(() => tokenize("/* comment /")).toThrowError(
      "Unterminated block comment at line 1, column 1."
    );
  });

  it("allows numeric literals with trailing decimal points before property access", () => {
    expect(
      simplify(tokenize("const value = 1..toString();"))
    ).toEqual([
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
});
