import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, StylePartView, CharacterStyle, ParagraphStyle, PackURI, WD_STYLE_TYPE, readDocumentArchive, openDocumentStyleModel } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

it("creates an original live default styles part in an admitted owner without an existing styles relationship", async () => {
  const document = await Document(await textFixture('<w:p><w:r><w:t>Keep</w:t></w:r></w:p>'), textContext);
  const owner = document.part.package;
  const originalRelationships = [...document.part.rels.values()].map(edge => edge.rId);
  const part = StylePartView.default(owner);
  expect(part).toBeInstanceOf(StylePartView);
  expect(part.package).toBe(owner);
  expect(part.styles.part).toBe(part);
  expect(part.styles.default(WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Normal");
  expect(part.styles.default(WD_STYLE_TYPE.CHARACTER)?.name).toBe("Default Paragraph Font");
  expect(part.styles.default(WD_STYLE_TYPE.TABLE)?.name).toBe("Normal Table");
  expect([...document.part.rels.values()].map(edge => edge.rId)).toEqual(originalRelationships);
  const style = part.styles.add_style("Harbor", WD_STYLE_TYPE.CHARACTER);
  expect(style).toBeInstanceOf(CharacterStyle);
  (style as CharacterStyle).font.bold = true;
  expect((part.styles.at("Harbor") as CharacterStyle).font.bold).toBe(true);
  const other = StylePartView.default(owner);
  expect(other).not.toBe(part);
  expect(other.partname.toString()).not.toBe(part.partname.toString());
  expect(other.styles.has("Harbor")).toBe(false);
  part.partname = new PackURI("/word/renamed-styles.xml");
  expect(part.styles.at("Harbor").equals(style)).toBe(true);
  (style as CharacterStyle).font.italic = true;
  expect((part.styles.at("Harbor") as CharacterStyle).font.italic).toBe(true);
  const volume = Volume.fromJSON({ "/saved": "" });
  await document.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
  const archive = await readDocumentArchive(new Uint8Array(volume.readFileSync("/saved") as Buffer), textContext);
  expect(new TextDecoder().decode(archive.members.find(member => member.name === part.partname.membername)!.bytes)).toContain("Harbor");
  expect(document.paragraphs[0]!.text).toBe("Keep");
});

it("keeps freshly created style factories separate from an existing admitted style-only owner", async () => {
  const model = await openDocumentStyleModel(await textFixture("<w:p/>"), textContext);
  const original = model.styles.part;
  const part = StylePartView.default(model.package);
  expect(part).not.toBe(original);
  expect(part.styles.part).toBe(part);
  expect(part.package).toBe(model.package);
  expect(part.styles.default(WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Normal");
  const style = part.styles.add_style("Detached", WD_STYLE_TYPE.PARAGRAPH);
  expect(style).toBeInstanceOf(ParagraphStyle);
  (style as ParagraphStyle).font.italic = true;
  expect(part.styles.at("Detached").equals(style)).toBe(true);
  expect(model.styles.has("Detached")).toBe(false);
  expect([...model.package.main_document_part.rels.values()].find(edge =>
    edge.reltype.endsWith("/styles"))!.target_part).toBe(original);
});
