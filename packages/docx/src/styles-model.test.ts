import { expect, it } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, WD_STYLE_TYPE, CharacterStyle } from "./styles-model.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";
import { inspectDocumentStyles } from "./styles.js";

it("provides live named style collections, inherited formatting interfaces and async owned-byte save", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const base = model.styles.add_style("Marsh base", WD_STYLE_TYPE.PARAGRAPH);
  const detail = model.styles.add_style("Marsh detail", WD_STYLE_TYPE.TABLE);
  expect(detail.type).toEqual(WD_STYLE_TYPE.TABLE);
  expect(detail.builtin).toBe(false);
  detail.font.bold = false;
  detail.paragraph_format.keep_with_next = true;
  base.font.italic = true;
  expect(model.styles.has("Marsh base")).toBe(true);
  expect((model.styles.at("Marsh base") as CharacterStyle).font.italic).toBe(true);
  expect([...model.styles].map(s => s.name)).toEqual(["Normal", "Marsh base", "Marsh detail"]);
  expect(model.styles.length).toBe(3);
  const volume = Volume.fromJSON({ "/out": "" });
  await model.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  const read = await inspectDocumentStyles(new Uint8Array(volume.readFileSync("/out") as Buffer), { name: "Marsh detail" }, textContext);
  expect(read.styles[0]).toMatchObject({ direct: { bold: false, keepWithNext: true } });
});

it("retains exact aliases, name lookup errors, default type fallback and deleted-handle invalidation", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Heading 1", WD_STYLE_TYPE.PARAGRAPH, true);
  expect(style.name).toBe("Heading 1");
  expect(style.builtin).toBe(true);
  expect(model.styles.at("Heading 1").style_id).toBe(style.style_id);
  expect(model.styles.get_by_id("absent", WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Normal");
  expect(model.styles.get_style_id(null, WD_STYLE_TYPE.PARAGRAPH)).toBe(null);
  expect(() => model.styles.at("Absent")).toThrow();
  expect(() => model.styles.at(0 as unknown as string)).toThrow(TypeError);
  expect(() => model.styles.add_style("Heading 1", WD_STYLE_TYPE.CHARACTER)).toThrow();
  style.name = "Section label";
  expect(model.styles.has("Heading 1")).toBe(false);
  expect(model.styles.at("Section label").style_id).toBe(style.style_id);
  style.delete();
  expect(() => style.font.bold).toThrow();
});

it("keeps base ownership, nullable visibility, next fallback and priority semantics", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const first = model.styles.add_style("First", WD_STYLE_TYPE.PARAGRAPH);
  const next = model.styles.add_style("Next", WD_STYLE_TYPE.PARAGRAPH);
  first.base_style = next;
  first.next_paragraph_style = next;
  expect(first.base_style?.name).toBe("Next");
  expect(first.next_paragraph_style.name).toBe("Next");
  first.next_paragraph_style = first;
  expect(first.next_paragraph_style.name).toBe("First");
  first.priority = 0;
  first.hidden = true;
  first.hidden = null;
  first.unhide_when_used = true;
  expect(first.hidden).toBe(false);
  expect(first.priority).toBe(0);
  first.priority = null;
  expect(first.priority).toBe(null);
  const other = await openDocumentStyleModel(undefined, textContext);
  expect(() => { first.base_style = other.styles.at("Normal"); }).toThrow();
  expect(() => { next.base_style = first; }).toThrow();
});

it("creates latent collection on access, distinguishes defaults and nullable individual entries, and invalidates deletes", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const latent = model.styles.latent_styles;
  expect(latent.length).toBe(0);
  expect(latent.default_to_hidden).toBe(false);
  latent.default_to_hidden = true;
  latent.default_priority = 0;
  latent.load_count = 0;
  const entry = latent.add_latent_style("Heading 3");
  expect(entry.name).toBe("Heading 3");
  expect(entry.hidden).toBe(null);
  entry.hidden = false;
  entry.priority = 0;
  expect(latent.at("Heading 3").hidden).toBe(false);
  entry.hidden = null;
  expect(entry.hidden).toBe(null);
  expect(latent.default_to_hidden).toBe(true);
  expect([...latent].map(s => s.name)).toEqual(["Heading 3"]);
  entry.delete();
  expect(latent.length).toBe(0);
  expect(() => entry.priority).toThrow();
});

it("does not acquire host resources when opening caller bytes and preserves unknown style metadata", async () => {
  const bytes = await textFixture(paragraph("Coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="character" w:styleId="Mark"><w:name w:val="Mark"/><w:aliases w:val="retained"/></w:style></w:styles>` } });
  const original = bytes.slice();
  const model = await openDocumentStyleModel(bytes, textContext);
  (model.styles.at("Mark") as CharacterStyle).font.small_caps = true;
  expect(bytes).toEqual(original);
  const volume = Volume.fromJSON({ "/out": "" });
  await model.save({ async write(part) { volume.appendFileSync("/out", part); } });
  expect((await inspectDocumentStyles(new Uint8Array(volume.readFileSync("/out") as Buffer), {}, textContext)).styles[0]?.direct.smallCaps).toBe(true);
});

it("reads and edits imported formatting with inherited namespace bindings", async () => {
  const bytes = await textFixture(paragraph("Coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="character" w:styleId="Mark"><w:name w:val="Mark"/><w:rPr><w:b/></w:rPr></w:style></w:styles>` } });
  const model = await openDocumentStyleModel(bytes, textContext);
  const style = model.styles.at("Mark") as CharacterStyle;
  expect(style.font.bold).toBe(true);
  style.font.italic = false;
  expect(style.font.bold).toBe(true);
  expect(style.font.italic).toBe(false);
});

it("invalidates every latent handle after another wrapper deletes and recreates its name", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const original = model.styles.latent_styles.add_latent_style("Coast");
  model.styles.latent_styles.at("Coast").delete();
  const replacement = model.styles.latent_styles.add_latent_style("Coast");
  replacement.hidden = true;
  expect(() => original.name).toThrow();
  expect(() => original.hidden).toThrow();
  expect(replacement.hidden).toBe(true);
});

it("shares bounded part identity and compares independently acquired live views", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Mark", WD_STYLE_TYPE.CHARACTER);
  const again = model.styles.at("Mark") as CharacterStyle;
  expect(style.equals(again)).toBe(true);
  expect(style.font.equals(again.font)).toBe(true);
  expect(style.part).toBe(model.styles.part);
  expect(style.font.part).toBe(style.part);
  expect(style.part.partname).toBe("/word/styles.xml");
  const bytes = style.part.blob;
  bytes.fill(0);
  expect(style.part.blob[0]).toBe(60);
});

it("keeps duplicate latent entries distinct while named lookup returns the first", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const latent = model.styles.latent_styles;
  const first = latent.add_latent_style("Caption"), second = latent.add_latent_style("Caption");
  first.hidden = false; second.hidden = true;
  expect(latent.length).toBe(2);
  expect(latent.at("Caption").hidden).toBe(false);
  expect([...latent].map(entry => entry.hidden)).toEqual([false, true]);
  first.delete();
  expect(() => first.hidden).toThrow();
  expect(second.hidden).toBe(true);
  expect(latent.at("Caption").hidden).toBe(true);
});
