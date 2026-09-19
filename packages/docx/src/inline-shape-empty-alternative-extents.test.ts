import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { inlineShapeExtentCarrierXml } from "../tests/fixtures/inline-shape-extent-carriers.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const enc = (s: string) => new TextEncoder().encode(s), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const placement of ["paragraph", "drawing", "leaf"] as const) for (const route of ["model", "sdk", "shell"] as const)
for (const alternative of carrier === "choice" || carrier === "fallback" ? [false, true] : [false])
it(`${route} inline shape extent ${alternative ? "refuses separate alternative geometry" : "edits empty alternative geometry"}; carrier=${carrier}; placement=${placement}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture(inlineShapeExtentCarrierXml(strict, carrier, placement, alternative) + '<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p><!--retained--><?policy keep?>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.inline_shapes.get", receiver: ref("document"), arguments: {}, resultHandle: "shapes" },
    { operation: "model.shape.InlineShapes.__getitem__.get", receiver: ref("shapes"), arguments: { index: 0 }, resultHandle: "shape" },
    { operation: "model.shape.InlineShape.width.set", receiver: ref("shape"), arguments: { value: { value: 444, unit: "emu" } } },
    { operation: "model.shape.InlineShape.height.set", receiver: ref("shape"), arguments: { value: { value: 888, unit: "emu" } } }
  ], sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } };
  if (route === "model") { const doc = await api.Document(input, textContext), shape = doc.inline_shapes.at(0); if (alternative) { expect(() => { shape.width = api.Emu(444); }).toThrow(api.UnsupportedEditError); expect([shape.width.emu, shape.height.emu]).toEqual([333, 666]); } else { shape.width = api.Emu(444); shape.height = api.Emu(888); expect([shape.width.emu, shape.height.emu]).toEqual([444, 888]); } await doc.save(sink); }
  else if (route === "sdk") { if (alternative) await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: 2 }); else { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); await result.save(sink); } }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec("docx batch /input --ops-file /ops --output /out --force --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(alternative ? 1 : 0); if (alternative) { const e = JSON.parse(r.stdout); expect(e).toMatchObject({ affected: 0, data: null }); expect(e.errors[0]).toMatchObject({ code: "unsupported-edit", operationIndex: 2 }); expect(await fs.readFile("/out")).toEqual(enc("retained destination")); } else v.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  if (alternative && route !== "model") expect(v.readFileSync("/out")).toHaveLength(0);
  else { const saved = readPackage(new Uint8Array(v.readFileSync("/out") as Buffer)); assertPackageLinks(saved); for (const [name, bytes] of parts) if (name !== "word/document.xml" || alternative) expect(saved.get(name), name).toEqual(bytes); if (!alternative) { const xml = new TextDecoder().decode(saved.get("word/document.xml")); expect(xml.split('cx="444" cy="888"')).toHaveLength(3); expect(xml).toContain('<!--retained--><?policy keep?>'); const doc = await api.Document(new Uint8Array(v.readFileSync("/out") as Buffer), textContext); expect(doc.paragraphs[1]!.text).toBe("Retain é 日本 עברית 🌊"); } }
  expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const carrier of ["choice", "fallback"] as const)
for (const placement of ["paragraph", "drawing", "leaf"] as const)
it(`generic XML mutation remains guarded for native alternate extent; carrier=${carrier}; placement=${placement}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture(inlineShapeExtentCarrierXml(strict, carrier, placement), {}, strict));
  const bytes = parts.get("word/document.xml")!, xml = new api.DocumentXmlEditor(bytes);
  const stack = [xml.root]; let extent: api.XmlElement | undefined;
  while (stack.length) { const node = stack.pop()!; if (node.localName === "extent") { extent = node; break; } stack.push(...node.children); }
  expect(extent).toBeDefined();
  expect(() => xml.setQualifiedAttribute(extent!, { namespace: "", localName: "cx" }, "444")).toThrow(api.UnsupportedEditError);
  expect(xml.dirtyNodes).toEqual([]); expect(xml.serialize()).toEqual(bytes);
});
