import { expect, it } from "vitest";
import { Document, DocumentPartView, StylePartView, XmlPartView, PackURI, WD_STYLE_TYPE, StaleHandleError } from "./index.js";
import type { Styles } from "./styles-model.js";
import { textFixture, textContext, w, r } from "../tests/fixtures/text.js";

async function owners() {
  const primary = await Document(await textFixture("<w:p/>"), textContext);
  const secondary = await DocumentPartView.load("/word/secondary.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body><w:p/><w:sectPr/></w:body></w:document>`), primary.part.package);
  return { primary, secondary, document: secondary.document };
}

it("uses the owning document style domain for paragraphs, runs and tables", async () => {
  const { primary, secondary, document } = await owners();
  primary.styles.add_style("Primary", WD_STYLE_TYPE.PARAGRAPH);
  expect(document.styles.equals(primary.styles)).toBe(false);
  const paragraphStyle = document.styles.add_style("Secondary", WD_STYLE_TYPE.PARAGRAPH);
  const characterStyle = document.styles.add_style("Secondary Run", WD_STYLE_TYPE.CHARACTER);
  const tableStyle = document.styles.add_style("Secondary Table", WD_STYLE_TYPE.TABLE);
  expect(secondary.styles).toBe(document.styles);
  const paragraph = document.add_paragraph("Owned", "Secondary");
  expect(paragraph.style?.equals(paragraphStyle)).toBe(true);
  const run = paragraph.add_run(" Run", "Secondary Run");
  expect(run.style?.equals(characterStyle)).toBe(true);
  const inserted = paragraph.insert_paragraph_before("Before", "Secondary");
  expect(inserted.style?.equals(paragraphStyle)).toBe(true);
  const table = document.add_table(1, 1, "Secondary Table");
  expect(table.style?.equals(tableStyle)).toBe(true);
  const nestedParagraph = table.cell(0, 0).add_paragraph("Nested", "Secondary");
  expect(nestedParagraph.style?.equals(paragraphStyle)).toBe(true);
  expect(() => { paragraph.style = "Primary"; }).toThrow();
  expect(primary.styles.has("Secondary")).toBe(false);
  expect(primary.paragraphs).toHaveLength(1);
});

it("reuses a shared styles part without registering a second style owner", async () => {
  const { primary, secondary, document } = await owners();
  const styles = primary.styles;
  secondary.rels.add_relationship(`${r}/styles`, styles.part, "rId10");
  expect(document.styles).toBe(styles);
  expect(secondary.styles).toBe(styles);
});

it("uses an already admitted default styles part as the document style owner", async () => {
  const { primary, secondary, document } = await owners();
  const part = StylePartView.default(primary.part.package);
  secondary.rels.add_relationship(`${r}/styles`, part, "rId10");
  expect(document.styles).toBe(part.styles);
  expect(secondary.styles).toBe(part.styles);
});

it("retains the canonical styles owner when package parts are inspected before document styles", async () => {
  const { primary, secondary, document } = await owners();
  const part = await XmlPartView.load("/word/secondary-styles.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    new TextEncoder().encode(`<w:styles xmlns:w="${w}"/>`), primary.part.package);
  secondary.rels.add_relationship(`${r}/styles`, part, "rId10");
  primary.part.rels.add_relationship("urn:secondary", secondary, "rId50");
  expect(primary.part.package.parts).toContain(part);
  expect(document.styles.part).toBe(part);
  expect(document.styles.part).toBeInstanceOf(StylePartView);
});

it("rolls back all style domains and invalidates a newly materialized styles owner", async () => {
  const { primary, document } = await owners();
  const original = primary.styles.add_style("Original", WD_STYLE_TYPE.PARAGRAPH);
  let escaped: Styles | undefined;
  expect(() => primary.store.transaction(() => {
    primary.styles.add_style("Rolled Back", WD_STYLE_TYPE.PARAGRAPH);
    escaped = document.styles;
    escaped.add_style("Discarded", WD_STYLE_TYPE.PARAGRAPH);
    throw new Error("Rollback");
  })).toThrow("Rollback");
  expect(primary.styles.has("Rolled Back")).toBe(false);
  expect(primary.styles.at("Original").equals(original)).toBe(true);
  expect(() => escaped!.part.blob).toThrow(StaleHandleError);
  expect(document.styles.has("Discarded")).toBe(false);
});

it("preserves materialized style owner handles after inherited part renaming", async () => {
  const { primary } = await owners();
  const styles = primary.styles;
  const original = styles.add_style("Original", WD_STYLE_TYPE.PARAGRAPH);
  styles.part.partname = new PackURI("/word/renamed-styles.xml");
  expect(primary.styles).toBe(styles);
  expect(styles.has("Original")).toBe(true);
  expect(primary.styles.at("Original").equals(original)).toBe(true);
  styles.add_style("Added After Rename", WD_STYLE_TYPE.CHARACTER);
  expect(primary.styles.has("Added After Rename")).toBe(true);
});

it("does not reuse a renamed styles authority when its old part name is allocated again", async () => {
  const { primary, secondary, document } = await owners();
  const styles = primary.styles;
  const oldName = styles.part.partname;
  styles.add_style("Original", WD_STYLE_TYPE.PARAGRAPH);
  styles.part.partname = new PackURI("/word/moved-styles.xml");
  const replacement = await XmlPartView.load(oldName,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    new TextEncoder().encode(`<w:styles xmlns:w="${w}"/>`), primary.part.package);
  expect(replacement).not.toBe(styles.part);
  secondary.rels.add_relationship(`${r}/styles`, replacement, "rId10");
  expect(document.styles.part).toBe(replacement);
  expect(document.styles.has("Original")).toBe(false);
  document.styles.add_style("Replacement", WD_STYLE_TYPE.PARAGRAPH);
  expect(styles.has("Original")).toBe(true);
  expect(styles.has("Replacement")).toBe(false);
});

it("uses secondary style definitions in its header and comment stories", async () => {
  const { primary, document } = await owners();
  const style = document.styles.add_style("Secondary Story", WD_STYLE_TYPE.PARAGRAPH);
  const header = document.sections.at(0).header;
  header.is_linked_to_previous = false;
  const paragraph = header.add_paragraph("Header", "Secondary Story");
  expect(paragraph.style?.equals(style)).toBe(true);
  const comment = document.comments.add_comment("Comment");
  expect(document.styles.has("Comment Text")).toBe(true);
  expect(primary.styles.has("Comment Text")).toBe(false);
  comment.paragraphs[0]!.style = "Secondary Story";
  expect(comment.paragraphs[0]!.style?.equals(style)).toBe(true);
});
