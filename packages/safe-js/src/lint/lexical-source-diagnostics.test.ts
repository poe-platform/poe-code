import { expect, it } from "vitest";
import { lint } from "./index.js";
import { parseExecutableModule } from "../parse/parser.js";

it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])("preserves lexical source diagnostics through lint for %j", line => {
  const source = `// 😀${line}/[${line}]/`;
  let expected: unknown;
  try { parseExecutableModule(source, "guest.ajs"); } catch (error) { expected = error; }
  expect(expected).toMatchObject({ name: "ParseError", filename: "guest.ajs", line: 2, column: 3 });
  for (const fix of [false, true] as const) {
    let actual: unknown;
    try { lint(source, fix ? { filename: "guest.ajs", fix } : { filename: "guest.ajs" }); }
    catch (error) { actual = error; }
    expect(actual).toEqual(expected);
    expect((actual as Error).stack).toBe(`ParseError: ${(actual as Error).message}`);
  }
});

it("keeps comment suppression and the escaped-regexp neighbor valid", () => {
  expect(lint('// 😀\r\nreturn eval("/\\\\n/.test(\\"\\\\n\\")")', { filename: "guest.ajs" })).toEqual([]);
});
