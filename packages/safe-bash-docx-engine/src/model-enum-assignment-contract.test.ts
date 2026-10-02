import { expect, it } from "vitest";
import { Document, applyStyleModelBatch, WD_ORIENT, WD_SECTION_START } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";

it.each([
  ["orientation", WD_ORIENT.LANDSCAPE],
  ["start_type", WD_SECTION_START.EVEN_PAGE]
] as const)("accepts the schema-validated %s enum through SDK model assignment", async (property, value) => {
  const input = await textFixture('<w:sectPr/>');
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
    { operation: "model.section.Sections.__getitem__.get", receiver: { resultHandle: "sections" }, arguments: { index: 0 }, resultHandle: "section" },
    { operation: `model.section.Section.${property}.set`, receiver: { resultHandle: "section" }, arguments: { value: JSON.parse(JSON.stringify(value)) } },
    { operation: `model.section.Section.${property}.get`, receiver: { resultHandle: "section" }, arguments: {} }
  ] };
  const expected = await Document(input, textContext);
  if (value.enum === "WD_ORIENTATION") expected.sections.at(0).orientation = value;
  else expected.sections.at(0).start_type = value;
  const result = await applyStyleModelBatch(input, batch, textContext);
  expect(result.results.at(-1)?.value).toEqual(expected.sections.at(0)[property]);
  expect(result.affected).toBeGreaterThan(0);
  const wrongFamily = structuredClone(batch);
  wrongFamily.operations[2]!.arguments = { value: { enum: "WD_BREAK_TYPE", name: "PAGE" } };
  await expect(applyStyleModelBatch(input, wrongFamily, textContext)).rejects.toThrow();
  const reset = structuredClone(batch);
  reset.operations[2]!.arguments = { value: null };
  const resetResult = await applyStyleModelBatch(input, reset, textContext);
  expect(resetResult.results.at(-1)?.value).toEqual(property === "orientation" ? WD_ORIENT.PORTRAIT : WD_SECTION_START.NEW_PAGE);
});
