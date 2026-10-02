import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, DocumentPartView, NumberingPart, applyStyleModelBatch, createDocxInspectionCommandEngine, readDocumentArchive, writeArchive, type DocxBatchOperation } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const role of ["document", "numbering"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} publishes loaded ${role} part; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict)); parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const type = "application/vnd.openxmlformats-officedocument.wordprocessingml." + (role === "document" ? (kind === "dotx" ? "template" : "document") + ".main" : "numbering") + "+xml", blob = encode(role === "document" ? `<w:document xmlns:w="${w}"><w:body><w:p/></w:body></w:document>` : `<w:numbering xmlns:w="${w}"/>`);
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  if (route === "model") {const doc = await Document(input, textContext); await (role === "document" ? DocumentPartView : NumberingPart).load("/audit/loaded.xml", type, blob, doc.part.package); await doc.save(sink);}
  else {
    const operations: DocxBatchOperation[] = [
      {operation: "model.document.Document.part.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "main"},
      {operation: "model.parts.document.DocumentPart.package.get", receiver: {resultHandle: "main"}, arguments: {}, resultHandle: "owner"},
      {operation: role === "document" ? "model.parts.document.DocumentPart.load.call" : "model.parts.numbering.NumberingPart.load.call", arguments: {partname: "/audit/loaded.xml", contentType: type, blob: {kind: "bytes", base64: Buffer.from(blob).toString("base64")}, ownerPackage: {resultHandle: "owner"}}, resultHandle: "loaded"}
    ];
    const batch = {version: 1 as const, operations};
    if (route === "sdk") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
    else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify(batch))); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})); const result = await shell.exec("docx batch /input --ops-file /ops.json --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);}
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output); expect(saved.get("audit/loaded.xml")).toEqual(blob); expect((await readDocumentArchive(output, textContext)).package.getPart("/audit/loaded.xml").content_type).toBe(type);
  for (const [name, bytes] of parts) if (name !== "[Content_Types].xml") expect(saved.get(name), name).toEqual(bytes); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
