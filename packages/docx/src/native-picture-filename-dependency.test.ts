import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const target of ["document", "run"] as const) for (const filename of ['one&two.png', 'quote"漢字.png'])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${target} retains escaped admitted picture filename ${filename}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const path = "/media/" + filename, volume = Volume.fromJSON({ "/input": "", "/out": "", [path]: Buffer.from(rasterPng()) });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), context = { ...textContext, binaryResolver: { capability: "command", open(path: string) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } } }, operations = [
    ...(target === "run" ? [{ operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" }, { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" }] : []),
    { operation: target === "run" ? "model.text.run.Run.add_picture.call" : "model.document.Document.add_picture.call", receiver: ref(target === "run" ? "runs" : "document", target === "run" ? 0 : undefined), arguments: { input: { kind: "vfs", path, capability: "command" }, width: { value: 100, unit: "emu" }, height: { value: 200, unit: "emu" } } }
  ];
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context);
    const descriptor = { path, capability: "command" };
    if (target === "document") await doc.add_picture(descriptor, api.Emu(100), api.Emu(200));
    else await doc.paragraphs[0]!.runs[0]!.add_picture(descriptor, api.Emu(100), api.Emu(200));
    await doc.save(sink);
  } else if (route === "sdk") await (await api.applyStyleModelBatch(input, { version: 1, operations }, context)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/media"); await fs.writeFile(path, rasterPng()); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const r = await shell.exec("docx batch /input --ops-file /ops --output /out --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(0); volume.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  const descendants = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(descendants)], nodes = descendants(api.parseDocumentXml(saved.get("word/document.xml")!, {}).root);
  const pic = strict ? "http://purl.oclc.org/ooxml/drawingml/picture" : "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const names = nodes.filter(node => node.namespace === pic && node.localName === "cNvPr");
  expect(names).toHaveLength(1); expect(names[0]!.attributes.find(a => a.localName === "name" && !a.namespace)?.value).toBe(filename);
  const reopened = await api.Document(output, context); expect(reopened.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(reopened.paragraphs[0]!.runs[0]!.bold).toBe(true);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
