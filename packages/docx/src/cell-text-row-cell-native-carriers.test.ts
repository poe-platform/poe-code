import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mce = "http://schemas.openxmlformats.org/markup-compatibility/2006";
function wrap(xml: api.DocumentXmlEditor, node: api.XmlElement, carrier: string): string {
  const raw = xml.sourceXml(node), w = node.namespace;
  if (carrier === "direct") return raw;
  if (carrier === "choice") return `<mc:AlternateContent xmlns:mc="${mce}" xmlns:n="${w}"><mc:Choice Requires="n">${raw}</mc:Choice><mc:Fallback><x:retain xmlns:x="urn:original-row-inert"/></mc:Fallback></mc:AlternateContent>`;
  if (carrier === "fallback") return `<mc:AlternateContent xmlns:mc="${mce}" xmlns:x="urn:original-row-unselected"><mc:Choice Requires="x"><x:retain/></mc:Choice><mc:Fallback>${raw}</mc:Fallback></mc:AlternateContent>`;
  return `<x:carrier xmlns:x="urn:original-row-process" xmlns:mc="${mce}" mc:Ignorable="x" mc:ProcessContent="x:carrier">${raw}</x:carrier>`;
}
for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"]) for (const owner of ["row", "cell"])
for (const route of ["model", "direct"] as const) for (const rowFlags of route === "model" ? [false] : [false, true])
it.concurrent(`native cell text resolves carried row/cell owners and resulting addresses; ${dialect}; ${kind}; ${carrier}; ${owner}; ${route}; rowFlags=${rowFlags}`, async () => {
  const memory = Volume.fromJSON({ "/authored": "", "/input": "", "/output": "", "/destination": "Retained destination" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const authored = await api.Document(await fixture(dialect, kind, variants[0]!), textContext), section = authored.sections[0]!;
  section.page_width = api.Inches(8); section.left_margin = api.Inches(1); section.right_margin = api.Inches(1);
  const table = authored.add_table(1, 1), cell = table.cell(0, 0), width = cell.width!.emu;
  cell.text = "Original cell"; cell.paragraphs[0]!.alignment = api.WD_ALIGN_PARAGRAPH.RIGHT; cell.paragraphs[0]!.runs[0]!.bold = true;
  await authored.save(sink("/authored"));
  const parts = readPackage(new Uint8Array(memory.readFileSync("/authored") as Buffer)), xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), physicalTable = xml.root.children[0]!.children.find(n => n.localName === "tbl")!, row = physicalTable.children.find(n => n.localName === "tr")!, tc = row.children.find(n => n.localName === "tc")!, selected = owner === "row" ? row : tc;
  parts.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[selected, wrap(xml, selected, carrier)]]))));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = "Revised 日本 עברית é 🌊";
  let result: api.TableEditData | undefined;
  if (route === "model") { const doc = await api.Document(input, textContext); doc.tables[0]!.cell(0, 0).text = value; await doc.save(sink("/output")); }
  else result = await api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A1", text: value, ...(rowFlags ? { repeatHeader: true, allowRowSplit: false } : {}), output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink("/output") });
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext), changed = doc.tables[0]!.cell(0, 0);
  expect(changed.text).toBe(value); expect(changed.width!.emu).toBe(width); expect(changed.paragraphs.length).toBe(1); expect(changed.paragraphs[0]!.runs.length).toBe(1); expect(changed.paragraphs[0]!.alignment).toBe(null); expect(changed.paragraphs[0]!.runs[0]!.bold).toBe(null);
  const afterXml = new api.DocumentXmlEditor(after.get("word/document.xml")!), beforeXml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), pending = [afterXml.root]; let afterCell: api.XmlElement | undefined, afterRow: api.XmlElement | undefined;
  while (pending.length) { const node = pending.pop()!; if (node.localName === "tc") afterCell = node; if (node.localName === "tr") afterRow = node; pending.push(...node.children); }
  expect(afterCell).toBeDefined(); expect(afterRow).toBeDefined();
  if (result) { expect(result.changes.length).toBe(1); const location = result.changes[0]!.after; let resolved = afterXml.root; for (const index of location.value.path) resolved = resolved.children[index]!; expect(resolved).toBe(afterCell); expect(location.positions.cell).toBe("A1"); expect(location.value.generation).toBe(1); }
  const props = afterRow!.children.find(n => n.localName === "trPr");
  expect(Boolean(props?.children.some(n => n.localName === "tblHeader"))).toBe(rowFlags); expect(Boolean(props?.children.some(n => n.localName === "cantSplit"))).toBe(rowFlags);
  for (let index = 0; index < 2; index++) expect(afterXml.sourceXml(afterXml.root.children[0]!.children[index]!)).toBe(beforeXml.sourceXml(beforeXml.root.children[0]!.children[index]!));
  if (carrier !== "direct") { const bytes = new TextDecoder().decode(after.get("word/document.xml")); expect(bytes).toContain(carrier === "process" ? 'mc:ProcessContent="x:carrier"' : carrier === "choice" ? '<x:retain xmlns:x="urn:original-row-inert"/>' : '<x:retain/>'); }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination");
});

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
it.concurrent(`native carried nonleading row header rejects without publication; ${dialect}; ${kind}; ${carrier}`, async () => {
  const memory = Volume.fromJSON({ "/authored": "", "/input": "", "/output": "", "/destination": "Retained destination" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const doc = await api.Document(await fixture(dialect, kind, variants[0]!), textContext), section = doc.sections[0]!;
  section.page_width = api.Inches(8); section.left_margin = api.Inches(1); section.right_margin = api.Inches(1); doc.add_table(2, 1); await doc.save(sink("/authored"));
  const parts = readPackage(new Uint8Array(memory.readFileSync("/authored") as Buffer)), xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), table = xml.root.children[0]!.children.find(n => n.localName === "tbl")!, row = table.children.filter(n => n.localName === "tr")[1]!;
  parts.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[row, wrap(xml, row, carrier)]]))));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  await expect(api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A2", text: "Must not publish", repeatHeader: true, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink("/output") })).rejects.toMatchObject({ code: "usage" });
  expect(memory.statSync("/output").size).toBe(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination");
});

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"])
it.concurrent(`native carried existing leading header admits following header; ${dialect}; ${kind}; ${carrier}`, async () => {
  const memory = Volume.fromJSON({ "/authored": "", "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const doc = await api.Document(await fixture(dialect, kind, variants[0]!), textContext), section = doc.sections[0]!;
  section.page_width = api.Inches(8); section.left_margin = api.Inches(1); section.right_margin = api.Inches(1); doc.add_table(2, 1); await doc.save(sink("/authored"));
  const parts = readPackage(new Uint8Array(memory.readFileSync("/authored") as Buffer)), xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), table = xml.root.children[0]!.children.find(n => n.localName === "tbl")!, row = table.children.find(n => n.localName === "tr")!;
  const propertyXml = new api.DocumentXmlEditor(new TextEncoder().encode(`<n:trPr xmlns:n="${row.namespace}"><n:tblHeader/></n:trPr>`));
  const oldProperties = row.children.find(n => n.localName === "trPr")!, carried = wrap(propertyXml, propertyXml.root, carrier);
  expect(oldProperties).toBeDefined();
  parts.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[oldProperties, carried]]))));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), result = await api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A2", text: "Following header 日本 עברית", repeatHeader: true, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink("/output") });
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const afterXml = new api.DocumentXmlEditor(after.get("word/document.xml")!), afterTable = afterXml.root.children[0]!.children.find(n => n.localName === "tbl")!;
  expect(afterXml.sourceXml(afterTable.children.find(n => n.localName === "tr")!)).toContain(carried); expect(result.changes[0]!.after.positions.cell).toBe("A2");
  expect((await api.Document(new Uint8Array(memory.readFileSync("/output") as Buffer), textContext)).tables[0]!.cell(1, 0).text).toBe("Following header 日本 עברית"); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
