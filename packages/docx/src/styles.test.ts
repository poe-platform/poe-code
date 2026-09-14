import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as sdk from "./index.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, assertWordReferences } from "../tests/assertions.js";

const definition = (id: string, type: string, inner = "", attrs = "") => `<w:style w:type="${type}" w:styleId="${id}"${attrs}><w:name w:val="${id}"/>${inner}</w:style>`;
async function fixture(styles: string, body = paragraph("Harbor ledger"), extra = {}) {
  return textFixture(body, { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${styles}</w:styles>` }, ...extra });
}
async function edit(input: Uint8Array, options: sdk.StyleEditOptions) {
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await sdk.editDocumentStyles(input, { ...options, output: "-" }, { ...textContext,
    encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  return { bytes, data, info: await sdk.inspectDocumentStyles(bytes, {}, textContext), parts: readPackage(bytes) };
}

it("inspects defined and inherited properties without flattening style toggles or defaults", async () => {
  const input = await fixture('<w:docDefaults><w:rPrDefault><w:rPr><w:i/></w:rPr></w:rPrDefault></w:docDefaults>' +
    definition("Base", "paragraph", '<w:rPr><w:b/></w:rPr><w:pPr><w:spacing w:after="180"/></w:pPr>') +
    definition("Detail", "paragraph", '<w:basedOn w:val="Base"/><w:rPr><w:b w:val="0"/></w:rPr>') +
    definition("Emphasis", "character", '<w:rPr><w:b/></w:rPr>') + definition("Grid", "table", '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'));
  const original = new Uint8Array(input);
  const info = await sdk.inspectDocumentStyles(input, { name: "Detail" }, textContext);
  expect(info.styles).toHaveLength(1);
  expect(info.styles[0]).toMatchObject({ name: "Detail", base: "Base", direct: { bold: false, italic: null, spaceAfter: null }, effective: { bold: true, italic: true, spaceAfter: 9 } });
  expect(info.defaults.run.italic).toBe(true);
  expect(input).toEqual(original);
});

it.each(["paragraph", "character", "table"] as const)("creates and edits a %s style without changing unedited metadata", async type => {
  const latent = '<w:latentStyles w:defLockedState="0" w:count="42"><w:lsdException w:name="Rare label" w:semiHidden="1"/></w:latentStyles>';
  const kept = definition("Style1", type, '<w:aliases w:val="Retained alias"/><w:rsid w:val="00ABCDEF"/>');
  const input = await fixture(latent + kept);
  const added = await edit(input, { operation: "styles.add", name: "Coastal detail", type, base: "Style1", bold: true });
  expect(added.info.styles.find(s => s.name === "Coastal detail")).toMatchObject({ id: "Style2", type, base: "Style1", direct: { bold: true } });
  const changed = await edit(added.bytes, { operation: "styles.set", name: "Coastal detail", italic: false, priority: 0, hidden: true });
  const xml = new TextDecoder().decode(changed.parts.get("word/styles.xml"));
  expect(xml).toContain(latent); expect(xml).toContain(kept);
  expect(changed.info.styles.find(s => s.name === "Coastal detail")).toMatchObject({ direct: { bold: true, italic: false }, priority: 0, hidden: true });
  expect(changed.parts.get("word/document.xml")).toEqual(readPackage(input).get("word/document.xml"));
  assertPackageLinks(changed.parts); assertWordReferences(changed.parts);
  expect((await edit(input, { operation: "styles.add", name: "Coastal detail", type, base: "Style1", bold: true })).bytes).toEqual(added.bytes);
});

it("sets document defaults, reciprocal linked styles, next style and a unique type default", async () => {
  let input = await fixture(definition("Body", "paragraph", "", ' w:default="1"') + definition("Note", "paragraph") + definition("Mark", "character"));
  let result = await edit(input, { operation: "styles.defaults.set", bold: true, spaceAfter: { value: 6, unit: "pt" } });
  expect(result.info.defaults).toMatchObject({ run: { bold: true }, paragraph: { spaceAfter: 6 } });
  input = result.bytes;
  result = await edit(input, { operation: "styles.set", name: "Note", linkedStyle: "Mark", next: "Body", defaultForType: true });
  expect(result.info.styles.find(s => s.name === "Note")).toMatchObject({ linkedStyle: "Mark", next: "Body", defaultForType: true });
  expect(result.info.styles.find(s => s.name === "Mark")).toMatchObject({ linkedStyle: "Note" });
  expect(result.info.styles.find(s => s.name === "Body")?.defaultForType).toBe(false);
  result = await edit(result.bytes, { operation: "styles.set", name: "Note", linkedStyle: null, next: null, bold: false });
  expect(result.info.styles.find(s => s.name === "Note")).toMatchObject({ linkedStyle: null, next: "Note", direct: { bold: false } });
  expect(result.info.styles.find(s => s.name === "Mark")?.linkedStyle).toBe(null);
});

it("reports cycles and missing references and refuses invalid staged links before publication", async () => {
  const invalid = await fixture(definition("A", "paragraph", '<w:basedOn w:val="B"/>') + definition("B", "paragraph", '<w:basedOn w:val="A"/><w:next w:val="Missing"/>'));
  const info = await sdk.inspectDocumentStyles(invalid, {}, textContext);
  expect(info.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(["style-cycle", "style-reference"]));
  const input = await fixture(definition("Base", "paragraph") + definition("Detail", "paragraph", '<w:basedOn w:val="Base"/>') + definition("Mark", "character"));
  for (const options of [{ base: "Detail" }, { base: "Absent" }, { base: "Mark" }, { linkedStyle: "Detail" }, { next: "Mark" }]) {
    const volume = Volume.fromJSON({ "/out": "sentinel" });
    await expect(sdk.editDocumentStyles(input, { operation: "styles.set", name: "Base", ...options, output: "-" }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
    })).rejects.toBeDefined();
    expect(volume.readFileSync("/out", "utf8")).toBe("sentinel");
  }
});

it("retains inherited numbering references and unedited table style properties", async () => {
  const num = { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>` } };
  const tableMetadata = '<w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr>';
  const input = await fixture(definition("List", "paragraph", '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>') +
    definition("Detail", "paragraph", '<w:basedOn w:val="List"/>') + definition("Grid", "table", tableMetadata), paragraph("Original count"), num);
  const info = await sdk.inspectDocumentStyles(input, { name: "Detail" }, textContext);
  expect(info.styles[0]?.effective?.numbering).toEqual({ id: "7", level: 0 });
  const result = await edit(input, { operation: "styles.set", name: "Grid", bold: false });
  expect(new TextDecoder().decode(result.parts.get("word/styles.xml"))).toContain(tableMetadata);
  expect(result.parts.get("word/numbering.xml")).toEqual(readPackage(input).get("word/numbering.xml"));
});

it("materializes a missing styles part using the package graph and preserves the body", async () => {
  const input = await textFixture(paragraph("Open water"));
  const result = await edit(input, { operation: "styles.add", name: "Waterline", type: "paragraph" });
  expect(result.info.styles[0]?.name).toBe("Waterline");
  expect(result.parts.get("word/document.xml")).toEqual(readPackage(input).get("word/document.xml"));
  assertPackageLinks(result.parts);
});

it("creates document defaults even when a template has no styles part", async () => {
  const input = await textFixture(paragraph("Plain sea"));
  const result = await edit(input, { operation: "styles.defaults.set", italic: true });
  expect(result.info.defaults.run.italic).toBe(true);
  expect(result.info.styles).toEqual([]);
  expect(result.parts.get("word/document.xml")).toEqual(readPackage(input).get("word/document.xml"));
  assertPackageLinks(result.parts);
});

it("diagnoses incompatible style graphs and duplicate defaults while accepting reciprocal links and self next", async () => {
  const input = await fixture(definition("One", "paragraph", '<w:basedOn w:val="Mark"/><w:link w:val="Two"/>', ' w:default="1"') + definition("Two", "paragraph", "", ' w:default="1"') + definition("Mark", "character"));
  const report = sdk.validateDocumentArchive(await sdk.readDocumentArchive(input, textContext));
  expect(report.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(["style-base-type", "style-link-type", "style-default"]));
  const valid = await fixture(definition("Body", "paragraph", '<w:next w:val="Body"/><w:link w:val="Mark"/>') + definition("Mark", "character", '<w:link w:val="Body"/>'));
  expect(sdk.validateDocumentArchive(await sdk.readDocumentArchive(valid, textContext)).valid).toBe(true);
});

it.each([false, true])("edits defaults and style properties in dialect %s without losing namespace bindings", async strict => {
  const input = await textFixture(paragraph("Water level"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Coastal CJK"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>${definition("Detail", "paragraph")}</w:styles>` } }, strict);
  const result = await edit(input, { operation: "styles.defaults.set", bold: true, spaceAfter: { value: 6, unit: "pt" } });
  expect(result.info.defaults.run.bold).toBe(true);
  expect(new TextDecoder().decode(result.parts.get("word/styles.xml"))).toContain('w:eastAsia="Coastal CJK"');
  expect(new TextDecoder().decode(result.parts.get("word/styles.xml"))).toContain('<w:widowControl/>');
});

it("repeats default and relationship assignments without namespace collisions or byte churn", async () => {
  const input = await fixture(definition("Body", "paragraph") + definition("Mark", "character"));
  const first = await edit(input, { operation: "styles.set", name: "Body", defaultForType: true, linkedStyle: "Mark" });
  const repeated = await edit(first.bytes, { operation: "styles.set", name: "Body", defaultForType: true, linkedStyle: "Mark" });
  expect(repeated.parts.get("word/styles.xml")).toEqual(first.parts.get("word/styles.xml"));
  expect(repeated.data.changed).toBe(false);
  const cleared = await edit(repeated.bytes, { operation: "styles.set", name: "Body", defaultForType: false });
  expect(cleared.info.styles.find(s => s.name === "Body")?.defaultForType).toBe(false);
});

it("orders newly added paragraph and run properties by the style schema", async () => {
  const input = await fixture(definition("Note", "paragraph"));
  const result = await edit(input, { operation: "styles.set", name: "Note", bold: true, spaceAfter: { value: 3, unit: "pt" } });
  const root = sdk.parseDocumentXml(result.parts.get("word/styles.xml")!).root;
  expect(root.children[0]!.children.map(c => c.localName)).toEqual(["name", "pPr", "rPr"]);
});

it("diagnoses long linked-style cycles while allowing a reciprocal pair", async () => {
  const styles = definition("A", "paragraph", '<w:link w:val="B"/>') + definition("B", "character", '<w:link w:val="C"/>') +
    definition("C", "paragraph", '<w:link w:val="D"/>') + definition("D", "character", '<w:link w:val="A"/>');
  const result = await sdk.inspectDocumentStyles(await fixture(styles), {}, textContext);
  expect(result.diagnostics.map(d => d.code)).toContain("style-link-cycle");
});

it("keeps an absent defaults part absent on a null reset", async () => {
  const input = await textFixture(paragraph("Quiet channel"));
  const result = await edit(input, { operation: "styles.defaults.set", bold: null });
  expect(result.data).toMatchObject({ changed: false, changes: [] });
  expect(result.parts).toEqual(readPackage(input));
});
