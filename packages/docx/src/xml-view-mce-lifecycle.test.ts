import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive } from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { signatureFixture } from "../tests/fixtures/signatures.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const guard of ["protected", "signed", "cancelled"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} respects ${guard} before active ${carrier} attribute edits; ${kind} strict=${strict}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const relationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const p = '<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>';
  const body = carrier === "process" ? `<f:pass mc:Ignorable="f" mc:ProcessContent="f:pass">${p}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "fallback" ? "f" : "w"}">${p}</mc:Choice><mc:Fallback>${p}</mc:Fallback></mc:AlternateContent>`;
  const main = `<w:document xmlns:w="${word}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future"><w:body>${body}</w:body></w:document>`;
  const parts = readPackage(guard === "signed" ? await signatureFixture() : await textFixture(p, guard === "protected" ? {settings: {kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>`}} : {}, strict));
  parts.set("word/document.xml", enc(main));
  parts.set("_rels/.rels", enc(new TextDecoder().decode(parts.get("_rels/.rels")!).split(r).join(relationships)));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), controller = new AbortController();
  const document = await Document(input, {...textContext, signal: controller.signal}), element = document.paragraphs[0]!.element;
  const before = element.serialize();
  const operations = [
    {operation: "model.document.Document.paragraphs.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.element.get", receiver: {resultHandle: "paragraphs", index: 0}, arguments: {}, resultHandle: "element"},
    {operation: "model.XmlElementView.set_attribute.call", receiver: {resultHandle: "element"}, arguments: {name: {namespaceURI: word, localName: "rsidR"}, value: "11223344"}}
  ];
  if (guard === "cancelled") controller.abort(new Error("Original caller cancellation"));
  if (route === "model") {
    expect(() => element.set_attribute({namespaceURI: word, localName: "rsidR"}, "11223344")).toThrow();
    if (guard !== "cancelled") expect(element.serialize()).toEqual(before);
  } else if (route === "sdk") {
    const pending = executeDocumentBatch(input, {version: 1, operations}, {output: "-"}, {...textContext, signal: controller.signal, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
    if (guard === "cancelled") await expect(pending).rejects.toBeInstanceOf(Error); else await expect(pending).rejects.toMatchObject({code: "unsupported-edit"});
    expect(memory.readFileSync("/output")).toEqual(Buffer.alloc(0));
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({version: 1, operations})));
    const engine = createDocxInspectionCommandEngine({limits: textContext.limits});
    const shell = new Shell({fs}).use(docxCommands({engine: {execute(request) {return engine.execute({...request, signal: controller.signal});}}}));
    const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(guard === "cancelled" ? 130 : 1);
    if (result.stdout) expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, locations: [], errors: [{code: guard === "cancelled" ? "cancelled" : "unsupported-edit"}]});
    expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/output")).toEqual(enc("sentinel"));
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
