import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, assertWordReferences } from "../tests/assertions.js";

const colors = { dark1: "102030", light1: "F0E0D0", dark2: "213141", light2: "E1D1C1", accent1: "324252", accent2: "435363", accent3: "546474", accent4: "657585", accent5: "768696", accent6: "8797A7", hyperlink: "98A8B8", followedHyperlink: "A9B9C9" } as const;
const slots = { dark1: "dk1", light1: "lt1", dark2: "dk2", light2: "lt2", accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6", hyperlink: "hlink", followedHyperlink: "folHlink" } as const;
const styles = [
  { name: "Authored Paragraph", type: "paragraph", font: "Original Serif", size: { value: 12.25, unit: "pt" }, bold: false, italic: true },
  { name: "Authored Character", type: "character", font: "Original Sans", size: { value: 14, unit: "pt" }, bold: true, italic: false },
  { name: "Authored Table", type: "table", font: "Original CJK", size: { value: 10, unit: "pt" }, bold: false, italic: false }
] as const;
const content = { version: 1, styles, theme: { name: "Original Shore", majorFont: "Original Serif", minorFont: "Original Sans", colors },
  page: { width: { value: 10, unit: "in" }, height: { value: 7, unit: "in" }, orientation: "landscape", margins: { top: { value: 0.5, unit: "in" }, right: { value: 0.75, unit: "in" }, bottom: { value: 0.5, unit: "in" }, left: { value: 0.75, unit: "in" }, header: { value: 0.25, unit: "in" }, footer: { value: 0.25, unit: "in" }, gutter: { value: 0.125, unit: "in" } } },
  blocks: [
    ...Array.from({ length: 10 }, (_, level) => ({ kind: "paragraph" as const, level, text: `Level ${level} 日本 é 🌊 עברית` })),
    { kind: "paragraph", style: "Authored Paragraph", runs: [{ text: "Inherited", bold: null, italic: false, underline: null }, { text: "Character", style: "Authored Character", bold: false, italic: true, underline: { enum: "WD_UNDERLINE", name: "DOUBLE" } }] },
    { kind: "table", style: "Authored Table", rows: [[{ blocks: [] }, { blocks: [{ kind: "paragraph", level: 9, text: "Nested heading" }] }]] }
  ]
} as const;

for (const dialect of ["transitional", "strict"] as const) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} creates all theme slots, all style types, every heading and explicit page properties together; ${kind} ${dialect}`, async () => {
  const volume = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await api.createDocument({ kind, dialect, content }, { output: "-" }, { ...textContext, encoding: { order: "name", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  else {
    const fs = new MemoryFileSystem(), shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx create --kind ${kind} --dialect ${dialect} --content-json '${JSON.stringify(content)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(result.stdout).toBe(""); volume.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), parts = readPackage(output); assertPackageLinks(parts); assertWordReferences(parts);
  expect(parts.has("docProps/core.xml")).toBe(false);
  const doc = await api.Document(output, textContext);
  expect(doc.paragraphs.slice(0, 10).map(p => p.text)).toEqual(Array.from({ length: 10 }, (_, level) => `Level ${level} 日本 é 🌊 עברית`));
  expect(doc.paragraphs[10]!.runs.map(r => [r.text, r.bold, r.italic, r.underline])).toEqual([["Inherited", null, false, null], ["Character", false, true, api.WD_UNDERLINE.DOUBLE]]);
  for (let level = 0; level <= 9; level++) {
    expect(doc.paragraphs[level]!.style!.name).toBe(level === 0 ? "Title" : `Heading ${level}`);
  }
  expect(doc.tables[0]!.cell(0, 0).text).toBe(""); expect(doc.tables[0]!.cell(0, 1).text).toBe("Nested heading"); expect(doc.tables[0]!.cell(0, 1).paragraphs[0]!.style!.style_id).toBe(doc.paragraphs[9]!.style!.style_id);
  const word = dialect === "strict" ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const nodes = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(nodes)], attr = (node: api.XmlElement, localName: string) => node.attributes.find(a => a.namespace === word && a.localName === localName)?.value;
  const main = nodes(api.parseDocumentXml(parts.get("word/document.xml")!).root), geometry = main.find(n => n.localName === "pgSz")!, margins = main.find(n => n.localName === "pgMar")!;
  expect([attr(geometry, "w"), attr(geometry, "h"), attr(geometry, "orient")]).toEqual(["14400", "10080", "landscape"]);
  expect(["top", "right", "bottom", "left", "header", "footer", "gutter"].map(key => attr(margins, key))).toEqual(["720", "1080", "720", "1080", "360", "360", "180"]);
  const styleNodes = nodes(api.parseDocumentXml(parts.get("word/styles.xml")!).root).filter(n => n.localName === "style");
  for (const [index, definition] of styles.entries()) {
    const style = styleNodes.find(n => n.children.some(c => c.localName === "name" && attr(c, "val") === definition.name))!;
    expect(attr(style, "type")).toBe(definition.type); const props = style.children.find(n => n.localName === "rPr")!, property = (name: string) => props.children.find(n => n.localName === name)!;
    expect(attr(property("rFonts"), "ascii")).toBe(definition.font); expect(attr(property("sz"), "val")).toBe(["25", "28", "20"][index]); expect(attr(property("b"), "val") ?? "1").toBe(definition.bold ? "1" : "0"); expect(attr(property("i"), "val") ?? "1").toBe(definition.italic ? "1" : "0");
  }
  const inventory = (await api.inspectDocument(output, textContext)).fontResources;
  expect(inventory.themes).toHaveLength(1);
  for (const [key, value] of Object.entries(colors)) expect(inventory.themes[0]!.colors).toContainEqual({ slot: slots[key as keyof typeof slots], kind: "srgbClr", value, lastColor: null });
  expect(inventory.themes[0]!.fonts).toContainEqual({ family: "major", slot: "latin", script: null, typeface: "Original Serif" }); expect(inventory.themes[0]!.fonts).toContainEqual({ family: "minor", slot: "latin", script: null, typeface: "Original Sans" });
  volume.writeFileSync("/saved", ""); await doc.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } }); expect(readPackage(new Uint8Array(volume.readFileSync("/saved") as Buffer))).toEqual(parts);
});
