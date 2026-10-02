import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as sdk from "./index.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const definition = (id: string, type: string, inner = "", name = id) => `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${inner}</w:style>`;
async function fixture(styles: string) {
  return textFixture(paragraph("Marsh observations"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${styles}</w:styles>` } });
}
async function edit(input: Uint8Array, options: Record<string, unknown>) {
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await sdk.editDocumentStyles(input, { ...options, output: "-" } as sdk.StyleEditOptions, { ...textContext,
    encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  return { bytes: new Uint8Array(volume.readFileSync("/out") as Buffer), data };
}

it.each(["paragraph", "character", "table"])("resolves additional %s font properties through defaults and base styles", async type => {
  const input = await fixture('<w:docDefaults><w:rPrDefault><w:rPr><w:rtl/><w:noProof/></w:rPr></w:rPrDefault></w:docDefaults>' +
    definition("Base", type, '<w:rPr><w:smallCaps/><w:shadow/><w:vanish/><w:u w:val="double"/><w:color w:val="334455" w:themeColor="accent2"/></w:rPr>') +
    definition("Detail", type, '<w:basedOn w:val="Base"/><w:rPr><w:smallCaps/><w:shadow w:val="0"/><w:rtl w:val="0"/></w:rPr>'));
  const info = await sdk.inspectDocumentStyles(input, { name: "Detail" }, textContext);
  expect(info.styles[0]).toMatchObject({ direct: { smallCaps: true, shadow: false, rtl: false, fontHidden: null },
    effective: { smallCaps: false, shadow: true, rtl: false, noProof: true, fontHidden: true, underline: "double", themeColor: "accent2" } });
});

it("inherits paragraph properties individually, including partial indentation, spacing and tab clear markers", async () => {
  const input = await fixture('<w:docDefaults><w:pPrDefault><w:pPr><w:keepLines/><w:spacing w:after="100"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    definition("Base", "table", '<w:pPr><w:ind w:left="720" w:right="240"/><w:spacing w:line="480" w:lineRule="auto"/><w:jc w:val="center"/><w:tabs><w:tab w:pos="720" w:val="left"/><w:tab w:pos="1440" w:val="right"/></w:tabs></w:pPr>') +
    definition("Detail", "table", '<w:basedOn w:val="Base"/><w:pPr><w:ind w:hanging="120"/><w:tabs><w:tab w:pos="720" w:val="clear"/><w:tab w:pos="2160" w:val="decimal" w:leader="dot"/></w:tabs></w:pPr>'));
  const info = await sdk.inspectDocumentStyles(input, { name: "Detail" }, textContext);
  expect(info.styles[0]?.effective).toMatchObject({ leftIndent: 36, rightIndent: 12, firstLineIndent: -6,
    keepTogether: true, spaceAfter: 5, lineSpacing: 2, lineSpacingRule: "auto", alignment: "center",
    tabStops: [{ position: 72, alignment: "right", leader: "none" }, { position: 108, alignment: "decimal", leader: "dot" }] });
});

it("looks up built-in UI aliases while preserving exact custom names and rejecting style IDs", async () => {
  const input = await fixture(definition("Heading1", "paragraph", "", "heading 1") + definition("FootnoteText", "paragraph", "", "footnote text") + definition("Custom42", "character", "", "Exact Name"));
  expect((await sdk.inspectDocumentStyles(input, { name: "Heading 1" }, textContext)).styles[0]?.name).toBe("Heading 1");
  await expect(sdk.inspectDocumentStyles(input, { name: "Footnote Text" }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
  await expect(sdk.inspectDocumentStyles(input, { name: "Custom42" }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
  await expect(sdk.inspectDocumentStyles(input, { name: "exact name" }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
});

it("separates style visibility from hidden font and clears nullable priority", async () => {
  const input = await fixture(definition("Label", "character"));
  const first = await edit(input, { operation: "styles.set", name: "Label", hidden: true, fontHidden: false, unhideWhenUsed: true, priority: 0 });
  expect((await sdk.inspectDocumentStyles(first.bytes, {}, textContext)).styles[0]).toMatchObject({ hidden: true, unhideWhenUsed: true, priority: 0, direct: { fontHidden: false } });
  const second = await edit(first.bytes, { operation: "styles.set", name: "Label", hidden: false, fontHidden: null, unhideWhenUsed: false, priority: null });
  expect((await sdk.inspectDocumentStyles(second.bytes, {}, textContext)).styles[0]).toMatchObject({ hidden: false, unhideWhenUsed: false, priority: null, direct: { fontHidden: null } });
});

it("reads latent defaults without creating XML and retains per-entry tri-state values", async () => {
  const input = await fixture('<w:latentStyles w:defLockedState="1" w:defUIPriority="12" w:defSemiHidden="0" w:defUnhideWhenUsed="1" w:defQFormat="0" w:count="42"><w:lsdException w:name="heading 1" w:semiHidden="0" w:qFormat="1" w:uiPriority="0"/></w:latentStyles>');
  const before = input.slice();
  const info = await sdk.inspectDocumentStyles(input, {}, textContext);
  expect(info).toMatchObject({ latent: { defaults: { defaultToLocked: true, defaultPriority: 12, defaultToHidden: false, defaultToUnhideWhenUsed: true, defaultToQuickStyle: false, loadCount: 42 },
    entries: [{ name: "Heading 1", hidden: false, locked: null, quickStyle: true, unhideWhenUsed: null, priority: 0 }] } });
  expect(input).toEqual(before);
});

it("adds, resets and removes latent exceptions while preserving defaults and unrelated XML", async () => {
  const input = await fixture('<w:latentStyles w:defLockedState="1" w:count="42"><!--retained--><w:lsdException w:name="Other" w:semiHidden="1"/></w:latentStyles>' + definition("Body", "paragraph"));
  let result = await edit(input, { operation: "styles.latent.add", name: "Heading 2", hidden: false, priority: 0 });
  let info = await sdk.inspectDocumentStyles(result.bytes, {}, textContext);
  expect(info).toMatchObject({ latent: { entries: [{ name: "Other" }, { name: "Heading 2", hidden: false, priority: 0, locked: null }] } });
  result = await edit(result.bytes, { operation: "styles.latent.set", name: "Heading 2", hidden: null, priority: null, locked: false });
  info = await sdk.inspectDocumentStyles(result.bytes, {}, textContext);
  expect(info).toMatchObject({ latent: { entries: [{ name: "Other" }, { name: "Heading 2", hidden: null, priority: null, locked: false }] } });
  result = await edit(result.bytes, { operation: "styles.latent.remove", name: "Heading 2" });
  expect(new TextDecoder().decode(readPackage(result.bytes).get("word/styles.xml"))).toContain('<!--retained--><w:lsdException w:name="Other" w:semiHidden="1"/>');
  expect(readPackage(result.bytes).get("word/document.xml")).toEqual(readPackage(input).get("word/document.xml"));
});

it("materializes latent defaults on demand and rejects missing or ambiguous entries before publication", async () => {
  const input = await textFixture(paragraph("Quiet estuary"));
  const result = await edit(input, { operation: "styles.latent.defaults.set", defaultToHidden: true, defaultPriority: 0, loadCount: 0 });
  expect(await sdk.inspectDocumentStyles(result.bytes, {}, textContext)).toMatchObject({ latent: { defaults: { defaultToHidden: true, defaultPriority: 0, loadCount: 0 }, entries: [] } });
  await expect(edit(result.bytes, { operation: "styles.latent.set", name: "Absent", locked: false })).rejects.toMatchObject({ code: "missing-selection" });
  const duplicate = await fixture('<w:latentStyles><w:lsdException w:name="Same"/><w:lsdException w:name="Same"/></w:latentStyles>');
  await expect(edit(duplicate, { operation: "styles.latent.remove", name: "Same" })).rejects.toMatchObject({ code: "ambiguous-selection" });
});

it("retains extension attributes when adding to an empty latent container", async () => {
  const input = await fixture('<w:latentStyles xmlns:extra="urn:retained" extra:flag="preserve" w:count="7"/>');
  const result = await edit(input, { operation: "styles.latent.add", name: "Heading 2" });
  const xml = sdk.parseDocumentXml(readPackage(result.bytes).get("word/styles.xml")!).root;
  const latent = xml.children.find(n => n.localName === "latentStyles")!;
  expect(latent.attributes).toContainEqual(expect.objectContaining({ namespace: "urn:retained", localName: "flag", value: "preserve" }));
  expect(latent.children).toHaveLength(1);
});

it("resets concrete presentation flags and latent numeric defaults with explicit null", async () => {
  const input = await fixture(definition("Label", "character", '<w:semiHidden/><w:locked/><w:qFormat/><w:unhideWhenUsed/>') + '<w:latentStyles w:defUIPriority="7" w:count="42"/>');
  const first = await edit(input, { operation: "styles.set", name: "Label", hidden: null, locked: null, quickStyle: null, unhideWhenUsed: null });
  expect((await sdk.inspectDocumentStyles(first.bytes, {}, textContext)).styles[0]).toMatchObject({ hidden: false, locked: false, quickStyle: false, unhideWhenUsed: false });
  const second = await edit(first.bytes, { operation: "styles.latent.defaults.set", defaultPriority: null, loadCount: null });
  expect(await sdk.inspectDocumentStyles(second.bytes, {}, textContext)).toMatchObject({ latent: { defaults: { defaultPriority: null, loadCount: null } } });
});
