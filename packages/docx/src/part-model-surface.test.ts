import { expect, it } from "vitest";
import { Volume } from "memfs";
import { CommentsPartView, SettingsPartView, HeaderPart, FooterPart, StoryPart } from "./package-view.js";
import { Document } from "./document-model.js";
import { WD_STYLE_TYPE } from "./formatting-values.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { Emu } from "./formatting-values.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";

it("returns the primary document and shared live owners from its document part", async () => {
  const document = await Document(await textFixture("<w:p/>"), textContext);
  const part = document.part;
  expect(part.document).toBe(document);
  expect(part.styles).toBe(document.styles);
  expect(part.settings).toBe(document.settings);
  expect(part.inline_shapes).toBe(document.inline_shapes);
  expect(part.core_properties).toBe(document.core_properties);
  expect(part.comments.store).toBe(document.store);
  const comment = part.comments.add_comment("Shared comment");
  expect((comment.part as CommentsPartView).comments.get(comment.comment_id)!.text).toBe("Shared comment");
  expect((part.settings.part as SettingsPartView).settings).toBe(document.settings);
  part.document.add_paragraph("Bound owner");
  expect(document.paragraphs.at(-1)!.text).toBe("Bound owner");
  const fs = Volume.fromJSON({ "/saved": "" });
  const saving = part.save({ async write(bytes) { fs.appendFileSync("/saved", bytes); } });
  expect(saving).toBeInstanceOf(Promise);
  await saving;
  const loaded = await Document(new Uint8Array(fs.readFileSync("/saved") as Uint8Array), textContext);
  expect(loaded.paragraphs.at(-1)!.text).toBe("Bound owner");
});

it("resolves story styles by ID and returns default absence consistently", async () => {
  const document = await Document(await textFixture("<w:p/>"), textContext);
  const style = document.styles.add_style("Survey", WD_STYLE_TYPE.PARAGRAPH);
  const returned = document.part.get_style(style.style_id, WD_STYLE_TYPE.PARAGRAPH)!;
  expect(returned.style_id).toBe(style.style_id);
  expect(returned.collection).toBe(document.styles);
  expect(document.part.get_style_id(style, WD_STYLE_TYPE.PARAGRAPH)).toBe(style.style_id);
  expect(document.part.get_style(null, WD_STYLE_TYPE.CHARACTER)!.style_id).toBe("DefaultParagraphFont");
  expect(document.part.get_style_id(null, WD_STYLE_TYPE.CHARACTER)).toBeNull();
});

it("computes the next story drawing ID from all existing unqualified IDs", async () => {
  const document = await Document(await textFixture('<w:p id="5"><w:r id="17"><w:t>Original</w:t></w:r></w:p>'), textContext);
  expect(document.part.next_id).toBe(18);
  expect(document.part.next_id).toBe(18);
  expect(document.paragraphs[0]!.text).toBe("Original");
});


it("admits story image relationships and returns detached bounded inline XML", async () => {
  const document = await Document(await textFixture("<w:p/>"), textContext);
  const pending = document.part.get_or_add_image(rasterPng(8, 4));
  expect(pending).toBeInstanceOf(Promise);
  const [id, image] = await pending;
  expect(document.part.related_parts.get(id)!.package).toBe(document.part.package);
  expect(image.px_width).toBe(8);
  const [repeatId] = await document.part.get_or_add_image(rasterPng(8, 4));
  expect(repeatId).toBe(id);
  const inline = await document.part.new_pic_inline(rasterPng(8, 4), Emu(800), null);
  expect(inline.localName).toBe("inline");
  expect([...inline.children.find(node => node.localName === "extent")!.attributes].find(([name]) => name.localName === "cx")![1]).toBe("800");
  expect([...inline.children.find(node => node.localName === "extent")!.attributes].find(([name]) => name.localName === "cy")![1]).toBe("400");
  expect(document.inline_shapes.length).toBe(0);
  expect(document.paragraphs).toHaveLength(1);
});

it("rejects invalidated story image handles before adding media", async () => {
  const document = await Document();
  const header = document.sections.at(0).header;
  const stale = header.part;
  header.is_linked_to_previous = true;
  const before = document.store.snapshot();
  await expect((stale as import("./package-view.js").StoryPart).get_or_add_image(rasterPng(8, 4))).rejects.toThrow();
  expect(document.store.snapshot()).toEqual(before);
});

it("creates typed standalone story defaults and attaches header and footer owners", async () => {
  const document = await Document();
  const [header, headerId] = document.part.add_header_part();
  const [footer, footerId] = document.part.add_footer_part();
  expect(document.part.header_part(headerId)).toBe(header);
  expect(document.part.footer_part(footerId)).toBe(footer);
  expect(header.element.localName).toBe("hdr");
  expect(footer.element.localName).toBe("ftr");
  expect(header.element.children.map(node => node.localName)).toEqual(["p"]);
  expect(header.package).toBe(document.part.package);
  expect(header.get_style(null, WD_STYLE_TYPE.PARAGRAPH)!.style_id).toBe("Normal");
});


it("constructs original part defaults without attaching or sharing owner authority", async () => {
  const document = await Document();
  const owner = document.part.package;
  const before = [...document.part.rels];
  const header = HeaderPart.new(owner);
  const footer = FooterPart.new(owner);
  const comments = CommentsPartView.default(owner);
  const settings = SettingsPartView.default(owner);
  expect([header.element.localName, footer.element.localName, comments.element.localName, settings.element.localName]).toEqual(["hdr", "ftr", "comments", "settings"]);
  expect([header, footer, comments, settings].every(part => part.package === owner)).toBe(true);
  expect([...document.part.rels]).toEqual(before);
});

it("rejects style lookup through an invalidated story handle", async () => {
  const document = await Document();
  const header = document.sections.at(0).header;
  const stale = header.part as StoryPart;
  header.is_linked_to_previous = true;
  expect(() => stale.get_style(null, WD_STYLE_TYPE.PARAGRAPH)).toThrow();
  expect(() => stale.get_style_id(null, WD_STYLE_TYPE.PARAGRAPH)).toThrow();
});

it("binds standalone settings and comments to their actual returned parts", async () => {
  const document = await Document();
  const settings = SettingsPartView.default(document.part.package);
  settings.settings.odd_and_even_pages_header_footer = true;
  expect(settings.settings.part).toBe(settings);
  expect(document.settings.odd_and_even_pages_header_footer).toBe(false);
  const comments = CommentsPartView.default(document.part.package);
  const comment = comments.comments.add_comment("Standalone");
  expect(comment.part).toBe(comments);
  expect(document.comments.length).toBe(0);
});

it("drops an unreferenced header relationship and invalidates its removed part", async () => {
  const document = await Document();
  const [header, id] = document.part.add_header_part();
  document.part.drop_header_part(id);
  expect(document.part.rels.has(id)).toBe(false);
  expect(document.part.package.parts).not.toContain(header);
  expect(() => header.element.localName).toThrow();
});

it("keeps a removed header handle invalid after its name is allocated again", async () => {
  const document = await Document();
  const header = document.sections.at(0).header;
  const stale = header.part;
  const name = stale.partname.toString();
  header.is_linked_to_previous = true;
  const replacement = header.part;
  expect(replacement.partname.toString()).toBe(name);
  expect(replacement).not.toBe(stale);
  expect(() => stale.blob).toThrow();
});

it("retains a header referenced by an admitted dormant part when its document relationship is dropped", async () => {
  const document = await Document();
  const [header, id] = document.part.add_header_part();
  const { StylePartView } = await import("./styles-model.js");
  const dormant = StylePartView.default(document.part.package);
  const retainedId = dormant.relate_to(header, "urn:retained-owner");
  document.part.drop_header_part(id);
  expect(document.part.rels.has(id)).toBe(false);
  expect(dormant.rels.at(retainedId).target_part).toBe(header);
  expect(header.element.localName).toBe("hdr");
});

it("opens a package with the canonical live document graph", async () => {
  const source = await Document();
  source.add_paragraph("Package graph");
  const fs = Volume.fromJSON({ "/package": "" });
  await source.save({ async write(bytes) { fs.appendFileSync("/package", bytes); } });
  const { PackageView } = await import("./package-view.js");
  const packageView = await PackageView.open(new Uint8Array(fs.readFileSync("/package") as Uint8Array));
  const document = packageView.main_document_part.document;
  expect(document.part.package).toBe(packageView);
  expect(document.paragraphs.at(-1)!.text).toBe("Package graph");
  document.add_paragraph("Live state");
  expect(packageView.main_document_part.document.paragraphs.at(-1)!.text).toBe("Live state");
});

it("roots a loaded secondary document and its section stories in the actual document part", async () => {
  const primary = await Document();
  const { DocumentPartView } = await import("./package-view.js");
  const secondary = await DocumentPartView.load("/word/secondary.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", new TextEncoder().encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Secondary</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'), primary.part.package);
  const document = secondary.document;
  expect(document).not.toBe(primary);
  expect(document.part).toBe(secondary);
  expect(document.element.tag).toEqual(secondary.element.tag);
  expect(document.paragraphs[0]!.text).toBe("Secondary");
  document.add_paragraph("Additional");
  expect(document.paragraphs.at(-1)!.text).toBe("Additional");
  expect(primary.paragraphs.map(paragraph => paragraph.text)).not.toContain("Additional");
  const section = document.sections.at(0);
  expect(section.part).toBe(secondary);
  section.header.add_paragraph("Secondary header");
  expect([...secondary.rels.values()].some(edge => edge.reltype.endsWith("/header"))).toBe(true);
  expect([...primary.part.rels.values()].some(edge => edge.reltype.endsWith("/header"))).toBe(false);
  document.settings.odd_and_even_pages_header_footer = true;
  expect(primary.settings.odd_and_even_pages_header_footer).toBe(false);
  const ownStyle = document.styles.add_style("Secondary paragraph", WD_STYLE_TYPE.PARAGRAPH);
  expect(primary.styles.has("Secondary paragraph")).toBe(false);
  expect(secondary.get_style(ownStyle.style_id, WD_STYLE_TYPE.PARAGRAPH)!.collection).toBe(document.styles);
  expect(secondary.get_style_id(ownStyle, WD_STYLE_TYPE.PARAGRAPH)).toBe(ownStyle.style_id);
  document.comments.add_comment("Secondary comment");
  expect(primary.comments.length).toBe(0);
  expect(document.comments.length).toBe(1);
});


it("returns a new current document view after renaming and leaves prior document handles invalid", async () => {
  const document = await Document();
  document.add_paragraph("Current root");
  const part = document.part;
  part.partname = "/word/renamed-document.xml";
  const current = part.document;
  expect(current).not.toBe(document);
  expect(current.part).toBe(part);
  expect(current.store.document).toBe(current);
  expect(current.paragraphs.at(-1)!.text).toBe("Current root");
  expect(() => document.paragraphs).toThrow();
});
