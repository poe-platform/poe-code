import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { writeGlossary } from "./glossary.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {}, clock: { now: () => 0 },
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 1000, workbookWork: 10000 }
};
// Independent CPython posixpath.basename/splitext results, as used by gnome_glossary.py.
const cases = [
  ["fr.po", "fr"], ["archive.fr.po", "archive.fr"], [".fr.po", ".fr"],
  ["..po", "..po"], ["...po", "...po"], ["....", "...."], ["..", ".."], [".", "."],
  [".fr", ".fr"], ["...fr", "...fr"], ["...fr.po", "...fr"], ["fr.", "fr"], ["fr", "fr"],
  ["/parent.dot/..po", "..po"], ["/parent.dot/.../fr.po", "fr"], ["/parent.dot/", ""],
  ["/", ""], ["", ""], ["parent\\fr.po", "parent\\fr"], ["é.po", "é"]
] as const;
it.each(cases)("selects the Python filename language for %s", async (filename, language) => {
  const rows = [["Term", "Definition", language, "."], ["hello", "greeting", "selected", "wrong"]];
  const book: Workbook = { sheets: [{ id: "s", name: "Terms", cells: rows.flatMap((row, r) =>
    row.map((value, column) => ({ row: r, column, value: { kind: "string", value } }))) }] };
  const output = new TextDecoder().decode(await writeGlossary(book, [], { ...context, outputFilename: filename }));
  expect(output).toContain(`"Language-Team: LANGUAGE <${language}@li.org>\\n"`);
  expect(output).toContain('msgid "hello"\nmsgstr "selected"\n');
  expect(output).not.toContain('msgstr "wrong"');
});
it("charges a long leading-dot basename to the work budget before requesting the clock", async () => {
  let clockCalls = 0;
  const book: Workbook = { sheets: [{ id: "s", name: "Terms", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Term" } }
  ] }] };
  await expect(writeGlossary(book, [], { ...context, outputFilename: ".".repeat(1000) + "po",
    limits: { ...context.limits, workbookWork: 100 }, clock: { now() { clockCalls++; return 0; } }
  })).rejects.toMatchObject({ code: "resource-limit" });
  expect(clockCalls).toBe(0);
});
