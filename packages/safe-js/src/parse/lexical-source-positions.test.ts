import { expect, it } from "vitest";
import { createSourceSpan } from "../error/shape.js";
import { formatInterpreterError } from "../error/format.js";
import { lint } from "../lint/index.js";
import { parseExecutableModule } from "./parser.js";

// ECMA-262 edition 16 §12.3; columns/offsets follow the tokenizer's UTF-16 contract.
it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
  "preserves original diagnostic text and offsets across %j", separator => {
    const prefix = 'const value = "😀";';
    const source = prefix + separator + "const broken = );";
    expect(() => parseExecutableModule(source, "guest.ajs")).toThrow(expect.objectContaining({
      filename: "guest.ajs", line: 2, column: 16,
      excerpt: `1 | ${prefix}\n2 | const broken = );`,
      span: { start: { line: 2, column: 16, offset: prefix.length + separator.length + 15 },
        end: { line: 2, column: 17, offset: prefix.length + separator.length + 16 } }
    }));
    expect(() => lint(source, {filename: "guest.ajs"})).toThrow(expect.objectContaining({
      filename: "guest.ajs", line: 2, column: 16,
      span: {start: {line: 2, column: 16, offset: prefix.length + separator.length + 15},
        end: {line: 2, column: 17, offset: prefix.length + separator.length + 16}}
    }));
    expect(lint(prefix + separator + "const valid = 1;", {filename: "guest.ajs"})
      .filter(item => item.code === "AS001")).toEqual([]);
    expect(createSourceSpan(source, 2, 16, 2, 17)).toEqual({
      start: {line: 2, column: 16, offset: prefix.length + separator.length + 15},
      end: {line: 2, column: 17, offset: prefix.length + separator.length + 16}
    });
  }
);

it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
  "renders runtime diagnostic lines across %j", separator => {
    expect(formatInterpreterError("const value=1;" + separator + "missing()", {
      kind: "ReferenceError", filename: "guest.ajs", line: 2, column: 1, message: "missing"
    })).toContain("1 | const value=1;\n2 | missing()\n  | ^");
  }
);
