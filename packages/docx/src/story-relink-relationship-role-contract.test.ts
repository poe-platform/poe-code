import { expect, it } from "vitest";
import { Document, applyStyleModelBatch } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { storyRelinkRoleFixture } from "../tests/fixtures/story-relink-role-public.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const story of ["header", "footer"] as const) for (const variant of ["default", "first", "even"] as const)
for (const route of ["model", "sdk"] as const)
it(`${route} relink refuses another role's internal relationship and retains every part; ${kind}; ${story}/${variant}; strict=${strict}`, async () => {
  const { memory, bytes, parts, member } = await storyRelinkRoleFixture({ strict, kind, story, variant });
  const document = await Document(bytes, textContext), owner = document.sections[1]![member];
  const beforeParts = document.part.package.parts.map(part => [part.partname, part.blob]);
  const beforeRelationshipXml = document.part.rels.xml;
  const beforeRelationships = [...document.part.rels.items()].map(([id, edge]) => [id, edge.reltype, edge.target_ref, edge.target_part.blob]);
  expect(() => owner.part).toThrow("Invalid story binding");
  if (route === "model") {
    expect(() => { owner.is_linked_to_previous = true; }).toThrow("Invalid story binding");
  } else {
    await expect(applyStyleModelBatch(bytes, { version: 1, operations: [
      { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
      { operation: `model.section.Section.${member}.get`, receiver: { resultHandle: "sections", index: 1 }, arguments: {}, resultHandle: "story" },
      { operation: `model.section.${story === "header" ? "_Header" : "_Footer"}.is_linked_to_previous.set`, receiver: { resultHandle: "story" }, arguments: { value: true } }
    ] }, textContext)).rejects.toThrow("Invalid story binding");
  }
  expect(owner.is_linked_to_previous).toBe(false);
  expect(document.sections[1]!.page_width?.twips).toBe(12240);
  expect(document.part.blob).toEqual(parts.get("word/document.xml"));
  expect(document.part.package.parts.map(part => [part.partname, part.blob])).toEqual(beforeParts);
  expect(document.part.rels.xml).toBe(beforeRelationshipXml);
  expect([...document.part.rels.items()].map(([id, edge]) => [id, edge.reltype, edge.target_ref, edge.target_part.blob])).toEqual(beforeRelationships);
  await expect(document.save({async write(chunk){memory.appendFileSync("/out",chunk);}})).rejects.toMatchObject({ code: "invalid-package" });
  expect(memory.readFileSync("/out")).toEqual(Buffer.alloc(0));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(bytes));
});
