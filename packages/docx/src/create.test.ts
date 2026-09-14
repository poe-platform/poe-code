import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import * as sdk from "./index.js";
import { textContext as context, textFixture, paragraph } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, assertWordReferences, xmlStructure } from "../tests/assertions.js";

async function bytes(options: Parameters<typeof sdk.createDocumentArchive>[0]) {
  const archive = await sdk.createDocumentArchive(options, context);
  const volume = Volume.fromJSON({ "/out": "" });
  await sdk.writeDocumentArchive(archive, { async write(chunk) { volume.appendFileSync("/out", chunk); } }, { order: "name", compression: "store" }, context);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
const content = { version: 1, blocks: [
  { kind: "paragraph", level: 0, text: "Harbor notes" },
  { kind: "paragraph", runs: [{ text: "中文 e\u0301 😀 שלום & <shore>\tline\nnext", bold: false, italic: true, underline: { enum: "WD_UNDERLINE", name: "DOUBLE" } }] },
  { kind: "table", rows: [[{ blocks: [] }, { blocks: [{ kind: "table", rows: [[{ blocks: [] }]] }] }]] }
] } as const;

it.each(["docx", "dotx"] as const)("creates deterministic independently reopened %s packages in both dialects", async kind => {
  for (const dialect of ["strict", "transitional"] as const) {
    const options = { kind, dialect, content };
    const output = await bytes(options);
    expect(output).toEqual(await bytes(options));
    const parts = readPackage(output);
    assertPackageLinks(parts); assertWordReferences(parts);
    expect([...parts.keys()]).toEqual([...parts.keys()].sort());
    const xml = new TextDecoder().decode(parts.get("word/document.xml"));
    expect(xml).toContain("&amp; &lt;shore&gt;");
    expect(xml).toContain('<w:b w:val="0"/>');
    expect(xml).toContain('<w:u w:val="double"/>');
    expect(xml).toContain("<w:tab/>"); expect(xml).toContain("<w:br/>");
    expect(xml).toContain("</w:tbl><w:p/></w:tc>");
    expect(JSON.stringify(xmlStructure(parts.get("word/document.xml")!))).toContain("中文 é 😀 שלום");
    expect(new TextDecoder().decode(parts.get("[Content_Types].xml"))).toContain(`${kind === "dotx" ? "template" : "document"}.main+xml`);
    expect(xml).toContain(dialect === "strict" ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main");
  }
});

it("keeps the empty default original, minimal and independent of time", async () => {
  const parts = readPackage(await bytes({ content: { version: 1, blocks: [] } }));
  assertPackageLinks(parts); assertWordReferences(parts);
  expect([...parts.keys()]).toHaveLength(5);
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("<w:body><w:p/><w:sectPr>");
  expect(parts.has("docProps/core.xml")).toBe(false);
});

it("writes only explicit identity and UTC whole-second metadata", async () => {
  const parts = readPackage(await bytes({ author: "Harbor team & friends", timestamp: "2026-01-02T03:04:05.678Z" }));
  assertPackageLinks(parts);
  const core = new TextDecoder().decode(parts.get("docProps/core.xml"));
  expect(core).toContain("Harbor team &amp; friends");
  expect(core).toContain(">2026-01-02T03:04:05Z</dcterms:created>");
  expect(core).not.toContain(".678");
});

it("exposes page, named style and theme settings as typed content", async () => {
  const parts = readPackage(await bytes({ content: { version: 1, blocks: [{ kind: "paragraph", style: "Field note", text: "North pier" }],
    page: { width: { value: 10, unit: "in" }, height: { value: 7, unit: "in" }, orientation: "landscape", margins: { left: { value: 0.5, unit: "in" } } },
    styles: [{ name: "Field note", type: "paragraph", font: "Noto Serif", size: { value: 12, unit: "pt" }, bold: true }],
    theme: { name: "Coast", majorFont: "Noto Serif", minorFont: "Noto Sans", colors: { accent1: "1a6080" } }
  } }));
  assertPackageLinks(parts); assertWordReferences(parts);
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain('w:w="14400" w:h="10080" w:orient="landscape"');
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain('w:left="720"');
  expect(new TextDecoder().decode(parts.get("word/styles.xml"))).toContain('w:ascii="Noto Serif"');
  expect(new TextDecoder().decode(parts.get("word/theme/theme1.xml"))).toContain('val="1A6080"');
});

it("appends to a supplied template without rewriting unrelated payloads or converting its dialect", async () => {
  const template = await textFixture('<!--preserve-->' + paragraph("Original berth") + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>', {}, true);
  const before = readPackage(template);
  const after = readPackage(await bytes({ template, content: { version: 1, blocks: [{ kind: "paragraph", text: "New berth" }] } }));
  assertPackageLinks(after); assertWordReferences(after);
  for (const [name, value] of before) if (name !== "word/document.xml") expect(after.get(name)).toEqual(value);
  const xml = new TextDecoder().decode(after.get("word/document.xml"));
  expect(xml).toContain('<!--preserve-->');
  expect(xml.indexOf("Original berth")).toBeLessThan(xml.indexOf("New berth"));
  expect(xml.indexOf("New berth")).toBeLessThan(xml.indexOf("<w:sectPr>"));
  await expect(bytes({ template, dialect: "transitional" })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(readPackage(template)).toEqual(before);
});

it("materializes missing template styles for typed headings without changing existing content", async () => {
  const template = await textFixture(paragraph("Original inlet"));
  const parts = readPackage(await bytes({ template, content: { version: 1, blocks: [{ kind: "paragraph", level: 9, text: "Tidal detail" }] } }));
  assertPackageLinks(parts);
  const styles = [...parts].find(([name]) => name.startsWith("word/styles") && name.endsWith(".xml"))!;
  const tree = xmlStructure(styles[1]);
  const flatten = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const ids = flatten(tree).filter(node => node.name === `{${w}}style`).map(node => node.attributes[`{${w}}styleId`]);
  for (const node of flatten(xmlStructure(parts.get("word/document.xml")!)).filter(node => node.name === `{${w}}pStyle`)) expect(ids).toContain(node.attributes[`{${w}}val`]);
  expect(new TextDecoder().decode(styles[1])).toContain('w:outlineLvl w:val="8"');
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("Original inlet");
});

it("keeps colliding custom heading styles while creating valid outline headings", async () => {
  const template = await bytes({ content: { version: 1, blocks: [], styles: [{ name: "Heading 1", type: "paragraph", italic: true }] } });
  const before = new TextDecoder().decode(readPackage(template).get("word/styles.xml"));
  const parts = readPackage(await bytes({ template, content: { version: 1, blocks: [{ kind: "paragraph", level: 1, text: "Outer coast" }] } }));
  const after = new TextDecoder().decode(parts.get("word/styles.xml"));
  expect(after).toContain(before.slice(0, -11));
  expect(after).toContain('<w:outlineLvl w:val="0"/>');
  assertPackageLinks(parts); assertWordReferences(parts);
});

it("populates templates with empty bodies and rejects protected templates", async () => {
  const template = await textFixture("");
  const parts = readPackage(await bytes({ template, content: { version: 1, blocks: [{ kind: "paragraph", text: "New inlet" }] } }));
  assertPackageLinks(parts);
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("New inlet");
  const protectedTemplate = await textFixture('<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' + paragraph("Locked coast") + '</w:sdtContent></w:sdt>');
  await expect(bytes({ template: protectedTemplate, content })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects executable content, invalid values and exhausted insertion budgets before creating output", async () => {
  const callback = vi.fn(() => "unsafe");
  for (const content of [{ version: 1, blocks: [], evaluate: callback }, { version: 1, blocks: [{ kind: "paragraph", text: callback }] },
    { version: 1, blocks: [{ kind: "paragraph", text: "\u0000" }] }, { version: 1, blocks: [{ kind: "paragraph", style: "Absent" }] }]) {
    await expect(bytes({ content } as unknown as sdk.DocumentCreateOptions)).rejects.toBeDefined();
  }
  expect(callback).not.toHaveBeenCalled();
  await expect(sdk.createDocumentArchive({ content }, { ...context, budget: new sdk.DocumentBudget({ insertedNodes: 1 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("rejects negative lengths before rounding and font sizes that round to zero", async () => {
  for (const settings of [
    { page: { margins: { left: { value: -0.001, unit: "emu" } } } },
    { styles: [{ name: "Tiny", type: "paragraph", size: { value: 1, unit: "twip" } }] }
  ]) await expect(bytes({ content: { version: 1, blocks: [], ...settings } } as sdk.DocumentCreateOptions)).rejects.toMatchObject({ code: "usage" });
});
