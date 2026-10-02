import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { runElementOpen } from "./run-properties.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const effects: Record<string, string> = {
  alphaModFix: ' amt="50000"/', lum: ' bright="10000" contrast="0"/',
  duotone: '><a:schemeClr val="accent2"/><a:srgbClr val="006699"/></a:duotone',
  alphaBiLevel: ' thresh="50000"/', alphaCeiling: '/', alphaFloor: '/', alphaInv: '/',
  alphaMod: '><a:cont type="sib"/></a:alphaMod', alphaRepl: ' a="50000"/',
  biLevel: ' thresh="50000"/', blur: ' rad="10000" grow="1"/',
  clrChange: '><a:clrFrom><a:srgbClr val="006699"/></a:clrFrom><a:clrTo><a:schemeClr val="accent2"/></a:clrTo></a:clrChange',
  clrRepl: '><a:schemeClr val="accent2"/></a:clrRepl',
  fillOverlay: ' blend="over"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:fillOverlay',
  grayscl: '/', hsl: ' hue="10000" sat="20000" lum="30000"/', tint: ' hue="1200000" amt="50000"/',
};
for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const effect of Object.keys(effects)) for (const target of ["run", "paragraph"] as const)
for (const clear of [false, true]) for (const route of ["model", "direct"] as const)
it.concurrent(`destructive text removes native raster effects with the selected picture; ${dialect}; ${kind}; ${effect}; ${target}; clear=${clear}; ${route}`, async () => {
  const parts = readPackage(await fixture(dialect, kind, variants[0]!)), editor = new api.DocumentXmlEditor(parts.get("word/document.xml")!), all = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(all)], blip = all(editor.root).find(node => node.localName === "blip")!;
  const content = `<a:${effect} xmlns:a="${blip.namespace}"${effects[effect]}>`;
  parts.set("word/document.xml", new TextEncoder().encode(editor.sourceXml(editor.root, new Map([[blip, runElementOpen(blip) + content + `</${blip.name}>`]]))));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = clear ? "" : "Replacement 日本 עברית 🌊";
  expect((await api.inspectDocument(input, textContext)).counts.images).toBe(2);
  expect((await api.inspectDocumentRevisions(input, {}, textContext)).items).toHaveLength(0);
  if (route === "model") { const doc = await api.Document(input, textContext), p = doc.paragraphs[0]!, selected = target === "run" ? p.runs[0]! : p; if (clear) selected.clear(); else selected.text = value; await doc.save(sink("/output")); }
  else {
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") };
    if (target === "run") await api.formatDocumentRuns(input, { paragraph: 1, run: 1, text: value, output: "-" }, context);
    else await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: value, output: "-" } }, context);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext), p = doc.paragraphs[0]!;
  expect(p.text).toBe(value); expect(p.alignment).toBe(api.WD_ALIGN_PARAGRAPH.RIGHT); expect(p.paragraph_format.keep_with_next).toBe(true);
  if (target === "run") { expect(p.runs[0]!.bold).toBe(true); expect(p.runs[0]!.font.rtl).toBe(true); }
  else for (const run of p.runs) { expect(run.bold).toBe(null); expect(run.font.rtl).toBe(null); }
  expect((await api.inspectDocument(output, textContext)).counts.images).toBe(1); expect(doc.paragraphs[1]!.text).toBe("Unselected é海"); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const effect of ["unknown-native", "foreign", "extension"] as const) for (const target of ["run", "paragraph"] as const)
for (const clear of [false, true]) for (const route of ["model", "direct"] as const)
it.concurrent(`destructive text rejects opaque raster effects without publication; ${dialect}; ${kind}; ${effect}; ${target}; clear=${clear}; ${route}`, async ({ expect }) => {
  const parts = readPackage(await fixture(dialect, kind, variants[0]!)), editor = new api.DocumentXmlEditor(parts.get("word/document.xml")!), all = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(all)], blip = all(editor.root).find(node => node.localName === "blip")!;
  const content = effect === "foreign" ? '<x:opaque xmlns:x="urn:original:raster-effects"/>' : `<a:${effect === "extension" ? "extLst" : "unknownEffect"} xmlns:a="${blip.namespace}"/>`;
  parts.set("word/document.xml", new TextEncoder().encode(editor.sourceXml(editor.root, new Map([[blip, runElementOpen(blip) + content + `</${blip.name}>`]]))));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = clear ? "" : "Replacement 日本 עברית 🌊";
  if (route === "model") { const doc = await api.Document(input, textContext), p = doc.paragraphs[0]!, selected = target === "run" ? p.runs[0]! : p; expect(() => { if (clear) selected.clear(); else selected.text = value; }).toThrow(api.UnsupportedEditError); }
  else {
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") };
    const result = target === "run" ? api.formatDocumentRuns(input, { paragraph: 1, run: 1, text: value, output: "-" }, context) : api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: value, output: "-" } }, context);
    await expect(result).rejects.toMatchObject({ code: "unsupported-edit" });
  }
  expect(memory.readFileSync("/output")).toHaveLength(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
