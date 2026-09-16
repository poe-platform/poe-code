import { expect, it } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, WD_STYLE_TYPE, CharacterStyle, ParagraphStyle } from "./styles-model.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";
import type { XmlElementView } from "./xml-element-view.js";
import { readPackage } from "../tests/assertions.js";
import { enumValue, enumFromValue, enumFromXml, enumXml } from "./formatting-values.js";

const metadata = { hidden: "semiHidden", locked: "locked", quick_style: "qFormat", unhide_when_used: "unhideWhenUsed" } as const;
const types = ["paragraph", "character", "table", "numbering"] as const;
const lexical = [undefined, "0", "1", "on", "off", "true", "false"] as const;
const definition = (id: string, type = "paragraph", inner = "", attributes = "") => `<w:style w:styleId="${id}"${type ? ` w:type="${type}"` : ""}${attributes}><w:name w:val="${id}"/>${inner}</w:style>`;
const child = (node: XmlElementView, name: string) => node.children.find(item => item.namespace === w && item.localName === name);
const attr = (node: XmlElementView | undefined, name = "val") => [...(node?.attributes ?? [])].find(([item]) => item.namespaceURI === w && item.localName === name)?.[1];
async function model(content: string, body = paragraph("Estuary survey")) {
  const bytes = await textFixture(body, { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${content}</w:styles>` } });
  const volume = Volume.fromJSON({ "/sample.docx": Buffer.from(bytes) });
  return openDocumentStyleModel(new Uint8Array(volume.readFileSync("/sample.docx") as Buffer), textContext);
}

it.each(Object.entries(metadata))("reads every concrete %s lexical state on all inherited style classes", async (property, tag) => {
  const contents = types.flatMap(type => lexical.map((value, index) => definition(`${type}${index}`, type, `<w:${tag}${value === undefined ? "" : ` w:val="${value}"`}/>`)));
  contents.push(...types.map(type => definition(`${type}Absent`, type)));
  const { styles } = await model(contents.join(""));
  for (const type of types) {
    expect(styles.at(`${type}Absent`)[property as keyof typeof metadata]).toBe(false);
    for (const [index, value] of lexical.entries()) expect(styles.at(`${type}${index}`)[property as keyof typeof metadata]).toBe(value === undefined || ["1", "on", "true"].includes(value));
  }
});
it.each(Object.entries(metadata))("sets and removes concrete %s without disturbing other metadata", async (property, tag) => {
  const { styles } = await model(types.map(type => definition(type, type, '<w:aliases w:val="retain"/>')).join("") + lexical.map((value, index) => definition(`Lexical${index}`, "paragraph", `<w:${tag}${value === undefined ? "" : ` w:val="${value}"`}/>`)).join(""));
  for (const [index] of lexical.entries()) {
    const style = styles.at(`Lexical${index}`), key = property as keyof typeof metadata;
    for (const value of [true, false, null] as const) { style[key] = value; expect(style[key]).toBe(value === true); expect(child(style.element, tag) !== undefined).toBe(value === true); }
  }
  for (const type of types) {
    const style = styles.at(type), key = property as keyof typeof metadata;
    for (const value of [true, false, null, true] as const) {
      style[key] = value;
      expect(style[key]).toBe(value === true);
      expect(child(style.element, tag) !== undefined).toBe(value === true);
      expect(attr(child(style.element, "aliases"))).toBe("retain");
    }
    expect(() => { style[key] = "yes" as unknown as boolean; }).toThrow(TypeError);
  }
});
it("retains nullable names and IDs across every style class", async () => {
  const { styles } = await model(types.map(type => definition(type, type)).join(""));
  const handles = [...styles];
  for (const style of handles) {
    style.name = null; expect(style.name).toBeNull(); expect(child(style.element, "name")).toBeUndefined();
    style.name = "Local label"; expect(style.name).toBe("Local label");
    style.name = "Heading 1"; expect(attr(child(style.element, "name"))).toBe("Heading 1");
    style.style_id = "NewIdentity"; expect(style.style_id).toBe("NewIdentity");
    style.style_id = null; expect(style.style_id).toBeNull(); expect(attr(style.element, "styleId")).toBeUndefined();
    style.style_id = null; expect(style.style_id).toBeNull();
  }
});
it.each([null, ""])("uses the default for an absent lookup ID even when a style has ID %s", async id => {
  const { styles } = await model(definition("Detail") + definition("Default", "paragraph", "", ' w:default="1"'));
  styles.at("Detail").style_id = id;
  expect(styles.get_by_id(id, WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Default");
  expect(styles.get_by_id(id, WD_STYLE_TYPE.CHARACTER)).toBeNull();
});
it("distinguishes builtin metadata and omitted paragraph type from style names", async () => {
  const { styles } = await model(lexical.map((value, index) => definition(`Mark${index}`, "paragraph", "", value === undefined ? "" : ` w:customStyle="${value}"`)).join("") + definition("Unspecified", ""));
  for (const [index, value] of lexical.entries()) expect(styles.at(`Mark${index}`).builtin).toBe(!["1", "on", "true"].includes(value ?? "0"));
  const missingType = styles.at("Unspecified");
  expect(missingType.type).toEqual(WD_STYLE_TYPE.PARAGRAPH);
});
it("roundtrips nullable priority on all concrete style classes", async () => {
  const { styles } = await model(types.map(type => definition(type, type)).join(""));
  for (const style of styles) {
    expect(style.priority).toBeNull();
    for (const value of [42, 24, 0, null]) { style.priority = value; expect(style.priority).toBe(value); }
    expect(child(style.element, "uiPriority")).toBeUndefined();
  }
});
it("resolves base absence and dangling references then replaces and clears bases", async () => {
  const { styles } = await model(definition("Root") + definition("Other") + definition("Detail", "paragraph", '<w:basedOn w:val="Missing"/>'));
  const detail = styles.at("Detail") as CharacterStyle;
  expect(detail.base_style).toBeNull();
  for (const name of ["Root", "Other"]) { detail.base_style = styles.at(name); expect(detail.base_style?.name).toBe(name); }
  detail.base_style = null; expect(detail.base_style).toBeNull(); expect(child(detail.element, "basedOn")).toBeUndefined();
});
it("resolves next absent dangling and nonparagraph references to self and resets self assignments", async () => {
  const { styles } = await model(definition("Body") + definition("Char", "character") + definition("Valid", "paragraph", '<w:next w:val="Body"/>') + definition("Dangling", "paragraph", '<w:next w:val="Missing"/>') + definition("Wrong", "paragraph", '<w:next w:val="Char"/>'));
  expect((styles.at("Valid") as ParagraphStyle).next_paragraph_style.name).toBe("Body");
  for (const name of ["Body", "Dangling", "Wrong"]) expect((styles.at(name) as ParagraphStyle).next_paragraph_style.name).toBe(name);
  const style = styles.at("Valid") as ParagraphStyle;
  for (const value of [null, style]) { style.next_paragraph_style = value; expect(style.next_paragraph_style.name).toBe("Valid"); expect(child(style.element, "next")).toBeUndefined(); }
});
it("chooses the last type default and distinguishes lookup fallback from invalid assignment", async () => {
  const { styles } = await model(definition("First", "paragraph", "", ' w:default="1"') + definition("Last", "paragraph", "", ' w:default="1"') + definition("Detail") + definition("Character", "character"));
  expect(styles.default(WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Last");
  expect(styles.default(WD_STYLE_TYPE.TABLE)).toBeNull();
  for (const id of [null, "", "Unknown", "Character"]) expect(styles.get_by_id(id, WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Last");
  expect(styles.get_by_id("Detail", WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Detail");
  for (const value of [null, "Last", styles.at("Last")]) expect(styles.get_style_id(value, WD_STYLE_TYPE.PARAGRAPH)).toBeNull();
  for (const value of ["Detail", styles.at("Detail")]) expect(styles.get_style_id(value, WD_STYLE_TYPE.PARAGRAPH)).toBe("Detail");
  expect(() => styles.get_style_id("Character", WD_STYLE_TYPE.PARAGRAPH)).toThrow(TypeError);
  expect(() => styles.get_style_id("Missing", WD_STYLE_TYPE.PARAGRAPH)).toThrow();
});
it("warns on deprecated ID fallback while preferring exact names and keeping membership name-only", async () => {
  const document = await model(definition("Legacy", "paragraph").replace('w:val="Legacy"', 'w:val="Readable"') + definition("Named", "paragraph").replace('w:val="Named"', 'w:val="Legacy"'));
  expect(document.styles.at("Legacy").style_id).toBe("Named");
  document.styles.at("Legacy").delete();
  expect(document.styles.has("Legacy")).toBe(false);
  expect(document.styles.at("Legacy").name).toBe("Readable");
  expect((document as unknown as { warnings: readonly { code: string }[] }).warnings).toContainEqual(expect.objectContaining({ code: "deprecated-style-id-lookup" }));
});

const latentDefaults = { default_to_hidden: "defSemiHidden", default_to_locked: "defLockedState", default_to_quick_style: "defQFormat", default_to_unhide_when_used: "defUnhideWhenUsed" } as const;
it.each(Object.entries(latentDefaults))("reads and sets latent default %s with strict boolean semantics", async (property, attribute) => {
  const key = property as keyof typeof latentDefaults;
  for (const value of lexical) {
    const { styles } = await model(`<w:latentStyles${value === undefined ? "" : ` w:${attribute}="${value}"`}/>`);
    const latent = styles.latent_styles;
    expect(latent[key]).toBe(["1", "on", "true"].includes(value ?? "0"));
    for (const next of [true, false]) { latent[key] = next; expect(latent[key]).toBe(next); }
    for (const bad of [null, "true", 1]) expect(() => { latent[key] = bad as unknown as boolean; }).toThrow(TypeError);
  }
});
it.each(Object.entries(metadata))("reads and resets latent override %s independently of defaults", async (property, attribute) => {
  const key = property as keyof typeof metadata;
  const { styles } = await model(`<w:latentStyles w:defSemiHidden="1">${lexical.map((value, index) => `<w:lsdException w:name="Latent${index}"${value === undefined ? "" : ` w:${attribute}="${value}"`}/>`).join("")}</w:latentStyles>`);
  const latent = styles.latent_styles;
  for (const [index, value] of lexical.entries()) {
    const entry = latent.at(`Latent${index}`);
    expect(entry[key]).toBe(value === undefined ? null : ["1", "on", "true"].includes(value));
    for (const next of [false, true, null] as const) { entry[key] = next; expect(entry[key]).toBe(next); }
  }
  expect(latent.default_to_hidden).toBe(true);
});
it("roundtrips nullable latent priority and load count without inventing application defaults", async () => {
  const { styles } = await model('<w:latentStyles><w:lsdException w:name="Coastal"/></w:latentStyles>');
  const latent = styles.latent_styles, entry = latent.at("Coastal");
  expect(latent.default_priority).toBeNull(); expect(latent.load_count).toBeNull(); expect(entry.priority).toBeNull();
  for (const value of [42, 24, 0, null]) {
    latent.default_priority = value; latent.load_count = value; entry.priority = value;
    expect(latent.default_priority).toBe(value); expect(latent.load_count).toBe(value); expect(entry.priority).toBe(value);
  }
});
it("uses keyed latent lookup with exact aliases and ordered live collections", async () => {
  const { styles } = await model('<w:latentStyles/>');
  const latent = styles.latent_styles;
  expect(latent.length).toBe(0); expect([...latent]).toEqual([]);
  for (const [index, name] of ["Caption", "Heading 1", "Exact Label"].entries()) { latent.add_latent_style(name); expect(latent.length).toBe(index + 1); expect([...latent]).toHaveLength(index + 1); }
  expect(latent.length).toBe(3); expect([...latent].map(entry => entry.name)).toEqual(["Caption", "Heading 1", "Exact Label"]);
  expect(latent.at("heading 1").name).toBe("Heading 1");
  expect(() => latent.at("exact label")).toThrow(); expect(() => latent.at(0 as unknown as string)).toThrow(TypeError);
  latent.at("Heading 1").delete(); expect([...latent].map(entry => entry.name)).toEqual(["Caption", "Exact Label"]);
});
it("retains empty and ordered defined collections and all built-in name aliases", async () => {
  for (const count of [0, 1, 2, 3]) {
    const { styles } = await model(Array.from({ length: count }, (_, index) => definition(`Label${index}`)).join(""));
    expect(styles.length).toBe(count);
    expect([...styles].map(style => style.name)).toEqual(Array.from({ length: count }, (_, index) => `Label${index}`));
  }
  const { styles } = await model("");
  const aliases = ["Caption", "Header", "Footer", ...Array.from({ length: 9 }, (_, index) => `Heading ${index + 1}`)];
  for (const alias of aliases) {
    const style = styles.add_style(alias, WD_STYLE_TYPE.PARAGRAPH, true);
    expect(style.name).toBe(alias); expect(attr(child(style.element, "name"))).toBe(alias.toLowerCase());
    expect(styles.has(alias)).toBe(true); expect(styles.at(alias).style_id).toBe(style.style_id);
  }
  const exact = styles.add_style("Mixed Case", WD_STYLE_TYPE.CHARACTER);
  expect(styles.has("mixed case")).toBe(false); expect(exact.builtin).toBe(false);
});
it("retrieves names and deprecated IDs at every collection position", async () => {
  const document = await model([0, 1, 2].map(index => definition(`Key${index}`).replace(`w:val="Key${index}"`, `w:val="Visible ${index}"`)).join(""));
  for (const index of [0, 1, 2]) {
    expect(document.styles.at(`Visible ${index}`).style_id).toBe(`Key${index}`);
    expect(document.styles.has(`Key${index}`)).toBe(false);
    expect(document.styles.at(`Key${index}`).name).toBe(`Visible ${index}`);
  }
});
it("constructs each style type with its actual inherited formatting interfaces", async () => {
  const { styles } = await model("");
  for (const type of Object.values(WD_STYLE_TYPE)) {
    const style = styles.add_style(`Coastal ${type.name}`, type);
    expect(style.type).toEqual(type);
    expect("font" in style).toBe(type.name !== "LIST");
    expect("paragraph_format" in style).toBe(type.name === "PARAGRAPH" || type.name === "TABLE");
    expect("base_style" in style).toBe(type.name !== "LIST");
    if (style instanceof CharacterStyle) { style.font.bold = false; expect(style.font.bold).toBe(false); }
    if (style instanceof ParagraphStyle) { style.paragraph_format.keep_together = true; expect(style.paragraph_format.keep_together).toBe(true); }
  }
});
it("reads explicit latent gallery defaults and preserves load-count numeric examples", async () => {
  const { styles } = await model('<w:latentStyles w:defUIPriority="99" w:count="276"/>');
  const latent = styles.latent_styles;
  expect(latent.default_priority).toBe(99); expect(latent.load_count).toBe(276);
  latent.default_priority = 42; latent.load_count = 240;
  expect(latent.default_priority).toBe(42); expect(latent.load_count).toBe(240);
});
it("deletes only a definition and invalidates all previously issued handles", async () => {
  const document = await model(definition("Used") + definition("Keep"), '<w:p><w:pPr><w:pStyle w:val="Used"/></w:pPr><w:r><w:t>Estuary survey</w:t></w:r></w:p>');
  const first = document.styles.at("Used"), second = document.styles.at("Used");
  first.delete();
  expect([...document.styles].map(style => style.name)).toEqual(["Keep"]);
  expect(() => second.name).toThrow();
  const volume = Volume.fromJSON({ "/result.docx": "" });
  await document.save({ async write(bytes) { volume.appendFileSync("/result.docx", bytes); } });
  const bytes = new Uint8Array(volume.readFileSync("/result.docx") as Buffer);
  const body = new TextDecoder().decode(readPackage(bytes).get("word/document.xml"));
  expect(body).toContain('<w:pStyle w:val="Used"/>'); expect(body).toContain("Estuary survey");
  const reopened = await openDocumentStyleModel(bytes, textContext);
  expect([...reopened.styles].map(style => style.name)).toEqual(["Keep"]);
});
it("distinguishes absent style names from explicit empty names during keyed lookup", async () => {
  const { styles } = await model(definition("MissingName") + definition("EmptyName"));
  const absent = styles.at("MissingName"), empty = styles.at("EmptyName");
  absent.name = null;
  expect(styles.has("")).toBe(false); expect(() => styles.at("")).toThrow();
  empty.name = "";
  expect(styles.has("")).toBe(true); expect(styles.at("").style_id).toBe("EmptyName");
});

const formattingEnumFacts = [
  ["MSO_COLOR_TYPE", "RGB", 1, null],
  ["MSO_COLOR_TYPE", "THEME", 2, null],
  ["MSO_COLOR_TYPE", "AUTO", 101, null],
  ["MSO_THEME_COLOR", "NOT_THEME_COLOR", 0, "UNMAPPED"],
  ["MSO_THEME_COLOR", "ACCENT_1", 5, "accent1"],
  ["MSO_THEME_COLOR", "ACCENT_2", 6, "accent2"],
  ["MSO_THEME_COLOR", "ACCENT_3", 7, "accent3"],
  ["MSO_THEME_COLOR", "ACCENT_4", 8, "accent4"],
  ["MSO_THEME_COLOR", "ACCENT_5", 9, "accent5"],
  ["MSO_THEME_COLOR", "ACCENT_6", 10, "accent6"],
  ["MSO_THEME_COLOR", "BACKGROUND_1", 14, "background1"],
  ["MSO_THEME_COLOR", "BACKGROUND_2", 16, "background2"],
  ["MSO_THEME_COLOR", "DARK_1", 1, "dark1"],
  ["MSO_THEME_COLOR", "DARK_2", 3, "dark2"],
  ["MSO_THEME_COLOR", "FOLLOWED_HYPERLINK", 12, "followedHyperlink"],
  ["MSO_THEME_COLOR", "HYPERLINK", 11, "hyperlink"],
  ["MSO_THEME_COLOR", "LIGHT_1", 2, "light1"],
  ["MSO_THEME_COLOR", "LIGHT_2", 4, "light2"],
  ["MSO_THEME_COLOR", "TEXT_1", 13, "text1"],
  ["MSO_THEME_COLOR", "TEXT_2", 15, "text2"],
  ["WD_PARAGRAPH_ALIGNMENT", "LEFT", 0, "left"],
  ["WD_PARAGRAPH_ALIGNMENT", "CENTER", 1, "center"],
  ["WD_PARAGRAPH_ALIGNMENT", "RIGHT", 2, "right"],
  ["WD_PARAGRAPH_ALIGNMENT", "JUSTIFY", 3, "both"],
  ["WD_PARAGRAPH_ALIGNMENT", "DISTRIBUTE", 4, "distribute"],
  ["WD_PARAGRAPH_ALIGNMENT", "JUSTIFY_MED", 5, "mediumKashida"],
  ["WD_PARAGRAPH_ALIGNMENT", "JUSTIFY_HI", 7, "highKashida"],
  ["WD_PARAGRAPH_ALIGNMENT", "JUSTIFY_LOW", 8, "lowKashida"],
  ["WD_PARAGRAPH_ALIGNMENT", "THAI_JUSTIFY", 9, "thaiDistribute"],
  ["WD_BUILTIN_STYLE", "BLOCK_QUOTATION", -85, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT", -67, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT_2", -81, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT_3", -82, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT_FIRST_INDENT", -78, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT_FIRST_INDENT_2", -79, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT_INDENT", -68, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT_INDENT_2", -83, null],
  ["WD_BUILTIN_STYLE", "BODY_TEXT_INDENT_3", -84, null],
  ["WD_BUILTIN_STYLE", "BOOK_TITLE", -265, null],
  ["WD_BUILTIN_STYLE", "CAPTION", -35, null],
  ["WD_BUILTIN_STYLE", "CLOSING", -64, null],
  ["WD_BUILTIN_STYLE", "COMMENT_REFERENCE", -40, null],
  ["WD_BUILTIN_STYLE", "COMMENT_TEXT", -31, null],
  ["WD_BUILTIN_STYLE", "DATE", -77, null],
  ["WD_BUILTIN_STYLE", "DEFAULT_PARAGRAPH_FONT", -66, null],
  ["WD_BUILTIN_STYLE", "EMPHASIS", -89, null],
  ["WD_BUILTIN_STYLE", "ENDNOTE_REFERENCE", -43, null],
  ["WD_BUILTIN_STYLE", "ENDNOTE_TEXT", -44, null],
  ["WD_BUILTIN_STYLE", "ENVELOPE_ADDRESS", -37, null],
  ["WD_BUILTIN_STYLE", "ENVELOPE_RETURN", -38, null],
  ["WD_BUILTIN_STYLE", "FOOTER", -33, null],
  ["WD_BUILTIN_STYLE", "FOOTNOTE_REFERENCE", -39, null],
  ["WD_BUILTIN_STYLE", "FOOTNOTE_TEXT", -30, null],
  ["WD_BUILTIN_STYLE", "HEADER", -32, null],
  ["WD_BUILTIN_STYLE", "HEADING_1", -2, null],
  ["WD_BUILTIN_STYLE", "HEADING_2", -3, null],
  ["WD_BUILTIN_STYLE", "HEADING_3", -4, null],
  ["WD_BUILTIN_STYLE", "HEADING_4", -5, null],
  ["WD_BUILTIN_STYLE", "HEADING_5", -6, null],
  ["WD_BUILTIN_STYLE", "HEADING_6", -7, null],
  ["WD_BUILTIN_STYLE", "HEADING_7", -8, null],
  ["WD_BUILTIN_STYLE", "HEADING_8", -9, null],
  ["WD_BUILTIN_STYLE", "HEADING_9", -10, null],
  ["WD_BUILTIN_STYLE", "HTML_ACRONYM", -96, null],
  ["WD_BUILTIN_STYLE", "HTML_ADDRESS", -97, null],
  ["WD_BUILTIN_STYLE", "HTML_CITE", -98, null],
  ["WD_BUILTIN_STYLE", "HTML_CODE", -99, null],
  ["WD_BUILTIN_STYLE", "HTML_DFN", -100, null],
  ["WD_BUILTIN_STYLE", "HTML_KBD", -101, null],
  ["WD_BUILTIN_STYLE", "HTML_NORMAL", -95, null],
  ["WD_BUILTIN_STYLE", "HTML_PRE", -102, null],
  ["WD_BUILTIN_STYLE", "HTML_SAMP", -103, null],
  ["WD_BUILTIN_STYLE", "HTML_TT", -104, null],
  ["WD_BUILTIN_STYLE", "HTML_VAR", -105, null],
  ["WD_BUILTIN_STYLE", "HYPERLINK", -86, null],
  ["WD_BUILTIN_STYLE", "HYPERLINK_FOLLOWED", -87, null],
  ["WD_BUILTIN_STYLE", "INDEX_1", -11, null],
  ["WD_BUILTIN_STYLE", "INDEX_2", -12, null],
  ["WD_BUILTIN_STYLE", "INDEX_3", -13, null],
  ["WD_BUILTIN_STYLE", "INDEX_4", -14, null],
  ["WD_BUILTIN_STYLE", "INDEX_5", -15, null],
  ["WD_BUILTIN_STYLE", "INDEX_6", -16, null],
  ["WD_BUILTIN_STYLE", "INDEX_7", -17, null],
  ["WD_BUILTIN_STYLE", "INDEX_8", -18, null],
  ["WD_BUILTIN_STYLE", "INDEX_9", -19, null],
  ["WD_BUILTIN_STYLE", "INDEX_HEADING", -34, null],
  ["WD_BUILTIN_STYLE", "INTENSE_EMPHASIS", -262, null],
  ["WD_BUILTIN_STYLE", "INTENSE_QUOTE", -182, null],
  ["WD_BUILTIN_STYLE", "INTENSE_REFERENCE", -264, null],
  ["WD_BUILTIN_STYLE", "LINE_NUMBER", -41, null],
  ["WD_BUILTIN_STYLE", "LIST", -48, null],
  ["WD_BUILTIN_STYLE", "LIST_2", -51, null],
  ["WD_BUILTIN_STYLE", "LIST_3", -52, null],
  ["WD_BUILTIN_STYLE", "LIST_4", -53, null],
  ["WD_BUILTIN_STYLE", "LIST_5", -54, null],
  ["WD_BUILTIN_STYLE", "LIST_BULLET", -49, null],
  ["WD_BUILTIN_STYLE", "LIST_BULLET_2", -55, null],
  ["WD_BUILTIN_STYLE", "LIST_BULLET_3", -56, null],
  ["WD_BUILTIN_STYLE", "LIST_BULLET_4", -57, null],
  ["WD_BUILTIN_STYLE", "LIST_BULLET_5", -58, null],
  ["WD_BUILTIN_STYLE", "LIST_CONTINUE", -69, null],
  ["WD_BUILTIN_STYLE", "LIST_CONTINUE_2", -70, null],
  ["WD_BUILTIN_STYLE", "LIST_CONTINUE_3", -71, null],
  ["WD_BUILTIN_STYLE", "LIST_CONTINUE_4", -72, null],
  ["WD_BUILTIN_STYLE", "LIST_CONTINUE_5", -73, null],
  ["WD_BUILTIN_STYLE", "LIST_NUMBER", -50, null],
  ["WD_BUILTIN_STYLE", "LIST_NUMBER_2", -59, null],
  ["WD_BUILTIN_STYLE", "LIST_NUMBER_3", -60, null],
  ["WD_BUILTIN_STYLE", "LIST_NUMBER_4", -61, null],
  ["WD_BUILTIN_STYLE", "LIST_NUMBER_5", -62, null],
  ["WD_BUILTIN_STYLE", "LIST_PARAGRAPH", -180, null],
  ["WD_BUILTIN_STYLE", "MACRO_TEXT", -46, null],
  ["WD_BUILTIN_STYLE", "MESSAGE_HEADER", -74, null],
  ["WD_BUILTIN_STYLE", "NAV_PANE", -90, null],
  ["WD_BUILTIN_STYLE", "NORMAL", -1, null],
  ["WD_BUILTIN_STYLE", "NORMAL_INDENT", -29, null],
  ["WD_BUILTIN_STYLE", "NORMAL_OBJECT", -158, null],
  ["WD_BUILTIN_STYLE", "NORMAL_TABLE", -106, null],
  ["WD_BUILTIN_STYLE", "NOTE_HEADING", -80, null],
  ["WD_BUILTIN_STYLE", "PAGE_NUMBER", -42, null],
  ["WD_BUILTIN_STYLE", "PLAIN_TEXT", -91, null],
  ["WD_BUILTIN_STYLE", "QUOTE", -181, null],
  ["WD_BUILTIN_STYLE", "SALUTATION", -76, null],
  ["WD_BUILTIN_STYLE", "SIGNATURE", -65, null],
  ["WD_BUILTIN_STYLE", "STRONG", -88, null],
  ["WD_BUILTIN_STYLE", "SUBTITLE", -75, null],
  ["WD_BUILTIN_STYLE", "SUBTLE_EMPHASIS", -261, null],
  ["WD_BUILTIN_STYLE", "SUBTLE_REFERENCE", -263, null],
  ["WD_BUILTIN_STYLE", "TABLE_COLORFUL_GRID", -172, null],
  ["WD_BUILTIN_STYLE", "TABLE_COLORFUL_LIST", -171, null],
  ["WD_BUILTIN_STYLE", "TABLE_COLORFUL_SHADING", -170, null],
  ["WD_BUILTIN_STYLE", "TABLE_DARK_LIST", -169, null],
  ["WD_BUILTIN_STYLE", "TABLE_LIGHT_GRID", -161, null],
  ["WD_BUILTIN_STYLE", "TABLE_LIGHT_GRID_ACCENT_1", -175, null],
  ["WD_BUILTIN_STYLE", "TABLE_LIGHT_LIST", -160, null],
  ["WD_BUILTIN_STYLE", "TABLE_LIGHT_LIST_ACCENT_1", -174, null],
  ["WD_BUILTIN_STYLE", "TABLE_LIGHT_SHADING", -159, null],
  ["WD_BUILTIN_STYLE", "TABLE_LIGHT_SHADING_ACCENT_1", -173, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_GRID_1", -166, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_GRID_2", -167, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_GRID_3", -168, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_LIST_1", -164, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_LIST_1_ACCENT_1", -178, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_LIST_2", -165, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_SHADING_1", -162, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_SHADING_1_ACCENT_1", -176, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_SHADING_2", -163, null],
  ["WD_BUILTIN_STYLE", "TABLE_MEDIUM_SHADING_2_ACCENT_1", -177, null],
  ["WD_BUILTIN_STYLE", "TABLE_OF_AUTHORITIES", -45, null],
  ["WD_BUILTIN_STYLE", "TABLE_OF_FIGURES", -36, null],
  ["WD_BUILTIN_STYLE", "TITLE", -63, null],
  ["WD_BUILTIN_STYLE", "TOAHEADING", -47, null],
  ["WD_BUILTIN_STYLE", "TOC_1", -20, null],
  ["WD_BUILTIN_STYLE", "TOC_2", -21, null],
  ["WD_BUILTIN_STYLE", "TOC_3", -22, null],
  ["WD_BUILTIN_STYLE", "TOC_4", -23, null],
  ["WD_BUILTIN_STYLE", "TOC_5", -24, null],
  ["WD_BUILTIN_STYLE", "TOC_6", -25, null],
  ["WD_BUILTIN_STYLE", "TOC_7", -26, null],
  ["WD_BUILTIN_STYLE", "TOC_8", -27, null],
  ["WD_BUILTIN_STYLE", "TOC_9", -28, null],
  ["WD_COLOR_INDEX", "INHERITED", -1, null],
  ["WD_COLOR_INDEX", "AUTO", 0, "default"],
  ["WD_COLOR_INDEX", "BLACK", 1, "black"],
  ["WD_COLOR_INDEX", "BLUE", 2, "blue"],
  ["WD_COLOR_INDEX", "BRIGHT_GREEN", 4, "green"],
  ["WD_COLOR_INDEX", "DARK_BLUE", 9, "darkBlue"],
  ["WD_COLOR_INDEX", "DARK_RED", 13, "darkRed"],
  ["WD_COLOR_INDEX", "DARK_YELLOW", 14, "darkYellow"],
  ["WD_COLOR_INDEX", "GRAY_25", 16, "lightGray"],
  ["WD_COLOR_INDEX", "GRAY_50", 15, "darkGray"],
  ["WD_COLOR_INDEX", "GREEN", 11, "darkGreen"],
  ["WD_COLOR_INDEX", "PINK", 5, "magenta"],
  ["WD_COLOR_INDEX", "RED", 6, "red"],
  ["WD_COLOR_INDEX", "TEAL", 10, "darkCyan"],
  ["WD_COLOR_INDEX", "TURQUOISE", 3, "cyan"],
  ["WD_COLOR_INDEX", "VIOLET", 12, "darkMagenta"],
  ["WD_COLOR_INDEX", "WHITE", 8, "white"],
  ["WD_COLOR_INDEX", "YELLOW", 7, "yellow"],
  ["WD_LINE_SPACING", "SINGLE", 0, "UNMAPPED"],
  ["WD_LINE_SPACING", "ONE_POINT_FIVE", 1, "UNMAPPED"],
  ["WD_LINE_SPACING", "DOUBLE", 2, "UNMAPPED"],
  ["WD_LINE_SPACING", "AT_LEAST", 3, "atLeast"],
  ["WD_LINE_SPACING", "EXACTLY", 4, "exact"],
  ["WD_LINE_SPACING", "MULTIPLE", 5, "auto"],
  ["WD_STYLE_TYPE", "CHARACTER", 2, "character"],
  ["WD_STYLE_TYPE", "LIST", 4, "numbering"],
  ["WD_STYLE_TYPE", "PARAGRAPH", 1, "paragraph"],
  ["WD_STYLE_TYPE", "TABLE", 3, "table"],
  ["WD_TAB_ALIGNMENT", "LEFT", 0, "left"],
  ["WD_TAB_ALIGNMENT", "CENTER", 1, "center"],
  ["WD_TAB_ALIGNMENT", "RIGHT", 2, "right"],
  ["WD_TAB_ALIGNMENT", "DECIMAL", 3, "decimal"],
  ["WD_TAB_ALIGNMENT", "BAR", 4, "bar"],
  ["WD_TAB_ALIGNMENT", "LIST", 6, "list"],
  ["WD_TAB_ALIGNMENT", "CLEAR", 101, "clear"],
  ["WD_TAB_ALIGNMENT", "END", 102, "end"],
  ["WD_TAB_ALIGNMENT", "NUM", 103, "num"],
  ["WD_TAB_ALIGNMENT", "START", 104, "start"],
  ["WD_TAB_LEADER", "SPACES", 0, "none"],
  ["WD_TAB_LEADER", "DOTS", 1, "dot"],
  ["WD_TAB_LEADER", "DASHES", 2, "hyphen"],
  ["WD_TAB_LEADER", "LINES", 3, "underscore"],
  ["WD_TAB_LEADER", "HEAVY", 4, "heavy"],
  ["WD_TAB_LEADER", "MIDDLE_DOT", 5, "middleDot"],
  ["WD_UNDERLINE", "INHERITED", -1, null],
  ["WD_UNDERLINE", "NONE", 0, "none"],
  ["WD_UNDERLINE", "SINGLE", 1, "single"],
  ["WD_UNDERLINE", "WORDS", 2, "words"],
  ["WD_UNDERLINE", "DOUBLE", 3, "double"],
  ["WD_UNDERLINE", "DOTTED", 4, "dotted"],
  ["WD_UNDERLINE", "THICK", 6, "thick"],
  ["WD_UNDERLINE", "DASH", 7, "dash"],
  ["WD_UNDERLINE", "DOT_DASH", 9, "dotDash"],
  ["WD_UNDERLINE", "DOT_DOT_DASH", 10, "dotDotDash"],
  ["WD_UNDERLINE", "WAVY", 11, "wave"],
  ["WD_UNDERLINE", "DOTTED_HEAVY", 20, "dottedHeavy"],
  ["WD_UNDERLINE", "DASH_HEAVY", 23, "dashedHeavy"],
  ["WD_UNDERLINE", "DOT_DASH_HEAVY", 25, "dashDotHeavy"],
  ["WD_UNDERLINE", "DOT_DOT_DASH_HEAVY", 26, "dashDotDotHeavy"],
  ["WD_UNDERLINE", "WAVY_HEAVY", 27, "wavyHeavy"],
  ["WD_UNDERLINE", "DASH_LONG", 39, "dashLong"],
  ["WD_UNDERLINE", "WAVY_DOUBLE", 43, "wavyDouble"],
  ["WD_UNDERLINE", "DASH_LONG_HEAVY", 55, "dashLongHeavy"],
] as const;
it.each(formattingEnumFacts)("retains the declared %s.%s numeric and XML facts", (family, name, number, xml) => {
  const value = enumFromValue(family, number);
  expect(value.name).toBe(name); expect(enumValue(value)).toBe(number);
  if (xml === null || xml === "UNMAPPED") { expect(() => enumXml(value)).toThrow(RangeError); if (xml === "UNMAPPED") expect(() => enumFromXml(family, xml)).toThrow(RangeError); }
  else { expect(enumXml(value)).toBe(xml); expect(enumFromXml(family, xml)).toEqual(value); }
});
