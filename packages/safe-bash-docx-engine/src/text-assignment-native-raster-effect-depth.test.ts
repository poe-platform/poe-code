import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { runElementOpen } from "./run-properties.js";

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const selectedIndex of [0, 1]) for (const depth of [2048, 512]) for (const target of ["run", "paragraph"] as const) for (const route of ["model", "direct"] as const)
it(`destructive native raster text honors admitted effect depth; ${dialect}; ${kind}; depth=${depth}; ${target}; ${route}${selectedIndex ? "; second-picture" : ""}`, async () => {
  const parts = readPackage(await fixture(dialect, kind, variants[0]!)), xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!);
  const pending = [xml.root], blips: api.XmlElement[] = [];
  while (pending.length) { const node = pending.pop()!; if (node.localName === "blip") blips.push(node); pending.push(...[...node.children].reverse()); }
  const blip = blips[selectedIndex];
  expect(blip).toBeDefined();
  const effect = `<a:alphaMod xmlns:a="${blip!.namespace}"><a:cont type="tree">` + '<a:cont type="tree">'.repeat(depth) + '<a:lum bright="10000"/>' + "</a:cont>".repeat(depth) + "</a:cont></a:alphaMod>";
  parts.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[blip!, runElementOpen(blip!) + effect + `</${blip!.name}>`]]))));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const context = { ...textContext, limits: { ...textContext.limits, maxArchiveBytes: 1024 * 1024, maxEntryBytes: 512 * 1024, maxTotalBytes: 1024 * 1024, maxRetainedBytes: 4 * 1024 * 1024 * 1024 }, budget: new api.DocumentBudget({ xmlDepth: 8192, retainedBytes: 4 * 1024 * 1024 * 1024, work: 4 * 1024 * 1024 * 1024 }) };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = "Revised 日本 עברית 🌊";
  if (route === "model") { const doc = await api.Document(input, context), p = doc.paragraphs[selectedIndex]!; (target === "run" ? p.runs[0]! : p).text = value; await doc.save(sink("/output")); }
  else { const ctx = { ...context, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") }; if (target === "run") await api.formatDocumentRuns(input, { paragraph: selectedIndex + 1, run: 1, text: value, output: "-" }, ctx); else await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: selectedIndex + 1, text: value, output: "-" } }, ctx); }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), reopened = await api.Document(output, context), p = reopened.paragraphs[selectedIndex]!;
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(p.text).toBe(value); expect(p.alignment).toBe(selectedIndex ? null : api.WD_ALIGN_PARAGRAPH.RIGHT); expect(p.paragraph_format.keep_with_next).toBe(selectedIndex ? null : true);
  if (target === "run") { expect(p.runs[0]!.bold).toBe(selectedIndex ? null : true); expect(p.runs[0]!.font.rtl).toBe(selectedIndex ? null : true); expect(p.runs[0]!.italic).toBe(selectedIndex ? true : null); } else for (const run of p.runs) { expect(run.bold).toBe(null); expect(run.font.rtl).toBe(null); }
  expect(reopened.paragraphs[1 - selectedIndex]!.text).toBe(selectedIndex ? "Selected 日本 עברית 🌊" : "Unselected é海"); expect((await api.inspectDocument(output, context)).counts.images).toBe(1); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
