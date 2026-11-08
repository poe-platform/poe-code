import { expect, it } from "vitest";
import { lint } from "../lint/index.js";
import { formatParseError } from "./format-error.js";
import { parseExecutableModule } from "./parser.js";

it.each(["a", "𐐀", "𐐀".repeat(200)])("renders the original token after %j", identifier => {
  const prefix = `const ${identifier} = `;
  const source = prefix + ");";
  for (const parse of [
    () => parseExecutableModule(source, "guest.ajs"),
    () => lint(source, { filename: "guest.ajs" })
  ]) {
    let diagnostic;
    try { parse(); } catch (error) { diagnostic = error; }
    expect(diagnostic).toMatchObject({
      filename: "guest.ajs", column: prefix.length + 1,
      span: { start: { offset: prefix.length } }
    });
    const { excerpt, caret } = diagnostic as { excerpt: string; caret: string };
    const content = excerpt.slice(4);
    expect(content).toContain(");");
    expect(caret).toBe("  | " + " ".repeat(Array.from(content.slice(0, content.indexOf(")"))).length) + "^");
    expect(Array.from(content).every(character => {
      const point = character.codePointAt(0)!;
      return point < 0xd800 || point > 0xdfff;
    })).toBe(true);
    expect(Array.from(content).length).toBeLessThanOrEqual(120);
  }
});

it.each(["a", "𐐀", "𐐀".repeat(200)])("accepts the neighboring declaration %j", identifier => {
  const source = `const ${identifier} = 1;`;
  expect(() => parseExecutableModule(source, "guest.ajs")).not.toThrow();
  expect(lint(source, { filename: "guest.ajs" }).filter(item => item.code === "AS001")).toEqual([]);
});

it("marks an astral span with one code-point caret and retains UTF-16 offsets", () => {
  const diagnostic = formatParseError("a𐐀z", "guest.ajs", new SyntaxError("invalid at line 1, column 2 to line 1, column 4."));
  expect(diagnostic.caret).toBe("  |  ^");
  expect(diagnostic.span).toEqual({
    start: { line: 1, column: 2, offset: 1 }, end: { line: 1, column: 4, offset: 3 }
  });
});
