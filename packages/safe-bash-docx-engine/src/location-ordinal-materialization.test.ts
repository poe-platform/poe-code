import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentBudget, openDocumentLocations } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true])
it(`one ordinal materializes one resource while broad listing retains match bounds; ${strict}`, async () => {
  const table = (value: string) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const input = await textFixture(table("First 日本 עברית") + table("Second é 🌊"), {}, strict);
  const memory = Volume.fromJSON({ "/input": "" }); memory.writeFileSync("/input", input);
  const original = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const document = await openDocumentLocations(original, { ...textContext, budget: new DocumentBudget({ matches: 1 }) });
  expect(() => document.at("table", 1)).not.toThrow();
  const first = document.at("table", 1), second = document.at("table", 2);
  expect(first.positions.table).toBe(1); expect(second.positions.table).toBe(2);
  expect(first.value.path).toEqual([0, 0]); expect(second.value.path).toEqual([0, 1]);
  expect(document.resolve(second.token, "table").token).toBe(second.token);
  expect(() => document.at("table", 3)).toThrowError(expect.objectContaining({ code: "missing-selection" }));
  expect(() => document.list("table")).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
