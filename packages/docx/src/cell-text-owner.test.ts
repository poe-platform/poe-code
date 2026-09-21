import { expect, it } from "vitest";
import { Document, StaleHandleError } from "./index.js";
import { textContext, textFixture, table } from "../tests/fixtures/text.js";

it("retains cell properties and annotation markers while replacing paragraphs and runs", async () => {
  const document = await Document(await textFixture(table([
    '<w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr><w:p><w:bookmarkStart w:id="1" w:name="Anchor"/><w:commentRangeStart w:id="2"/><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t><w:footnoteRef/></w:r><w:commentRangeEnd w:id="2"/><w:bookmarkEnd w:id="1"/></w:p><w:p><w:r><w:t>Later</w:t></w:r></w:p>'
  ])), textContext);
  const owner = document.tables[0]!;
  const cell = owner.cell(0, 0);
  const paragraph = cell.paragraphs[0]!;
  const bookmark = paragraph.element.children[0]!;
  const run = paragraph.runs[0]!;
  const note = run.element.children.find(n => n.localName === "footnoteRef")!;
  cell.text = "New\tLine\nNext";
  expect(cell.table).toBe(owner);
  expect(owner.cell(0, 0)).toBe(cell);
  expect(cell.width?.twips).toBe(1440);
  expect(cell.paragraphs).toHaveLength(1);
  expect(cell.text).toBe("New\tLine\nNext");
  expect(cell.paragraphs[0]!.element.children.map(n => n.localName)).toEqual([
    "bookmarkStart", "commentRangeStart", "r", "r", "commentRangeEnd", "bookmarkEnd"
  ]);
  expect(note.localName).toBe("footnoteRef");
  expect(bookmark.localName).toBe("bookmarkStart");
  expect(() => paragraph.text).toThrow(StaleHandleError);
  expect(() => run.text).toThrow(StaleHandleError);
  cell.text = "";
  expect(cell.paragraphs).toHaveLength(1);
  expect(cell.text).toBe("");
  expect(note.localName).toBe("footnoteRef");
});

it("rejects malformed annotation ranges without replacing live cell owners", async () => {
  const document = await Document(await textFixture(table([
    '<w:p><w:bookmarkEnd w:id="1"/><w:r><w:t>Keep</w:t></w:r><w:bookmarkStart w:id="1" w:name="Anchor"/></w:p>'
  ])), textContext);
  const cell = document.tables[0]!.cell(0, 0);
  const paragraph = cell.paragraphs[0]!;
  const run = paragraph.runs[0]!;
  expect(() => { cell.text = "Rejected"; }).toThrow("annotation markers");
  expect(cell.text).toBe("Keep");
  expect(cell.paragraphs[0]).toBe(paragraph);
  expect(run.text).toBe("Keep");
});
