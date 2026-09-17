import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, DocumentPartView, NumberingPart, ImagePartView, applyStyleModelBatch, createDocxInspectionCommandEngine, type DocxBatchOperation, readDocumentArchive, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["main", "numbering", "png", "jpeg", "gif87", "gif89", "bmp", "tiff-le", "tiff-be"] as const)
for (const parameter of ["", '; audit="coast; dune"'] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} loads native ${role} with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const baseType = role === "main" ? `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml` : role === "numbering" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml" : "image/" + (role.startsWith("gif") ? "gif" : role.startsWith("tiff") ? "tiff" : role);
  const type = baseType + parameter, name = "/audit/loaded.bin", image = role !== "main" && role !== "numbering";
  const blob = role === "main" ? encode(`<w:document xmlns:w="${w}"><w:body><w:p/></w:body></w:document>`) : role === "numbering" ? encode(`<w:numbering xmlns:w="${w}"/>`) : role === "png" ? rasterPng() : role === "jpeg" ? rasterJpeg(1, 1) : role.startsWith("gif") ? rasterGif(role === "gif87" ? "87a" : "89a") : role === "bmp" ? rasterBmp() : rasterTiff(role === "tiff-le");
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict)); parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  if (route === "model") {
    const doc = await Document(input, textContext), owner = doc.part.package;
    const part = role === "main" ? await DocumentPartView.load(name, type, blob, owner) : role === "numbering" ? await NumberingPart.load(name, type, blob, owner) : await ImagePartView.load(name, type, blob, owner);
    expect(part.content_type).toBe(type); expect(part.blob).toEqual(blob); expect(part.package).toBe(owner);
    if (part instanceof ImagePartView) {expect(part.image.content_type).toBe(baseType); expect(part.image.px_width).toBe(1); expect(part.image.px_height).toBe(1);}
    if (part instanceof NumberingPart) expect(part.numbering_definitions.length).toBe(0);
    await doc.save(sink);
  } else {
    const operation = role === "main" ? "model.parts.document.DocumentPart.load.call" : role === "numbering" ? "model.parts.numbering.NumberingPart.load.call" : "model.parts.image.ImagePart.load.call";
    const operations: DocxBatchOperation[] = [
      {operation: "model.document.Document.part.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "main"},
      {operation: "model.parts.document.DocumentPart.package.get", receiver: {resultHandle: "main"}, arguments: {}, resultHandle: "owner"},
      {operation, arguments: {partname: name, contentType: type, blob: {kind: "bytes", base64: Buffer.from(blob).toString("base64")}, ownerPackage: {resultHandle: "owner"}}, resultHandle: "loaded"}
    ];
    if (image) operations.push({operation: "model.parts.image.ImagePart.image.get", receiver: {resultHandle: "loaded"}, arguments: {}, resultHandle: "image"}, {operation: "model.image.image.Image.px_width.get", receiver: {resultHandle: "image"}, arguments: {}});
    const batch = {version: 1 as const, operations};
    if (route === "sdk") {const result = await applyStyleModelBatch(input, batch, textContext); if (image) expect(result.results.at(-1)!.value).toBe(1); await result.save(sink);}
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify(batch)));
      const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
      const result = await shell.exec("docx batch /input --ops-file /ops.json --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect(saved.get(name.slice(1))).toEqual(blob); for (const [name, bytes] of parts) if (name !== "[Content_Types].xml") expect(saved.get(name), name).toEqual(bytes);
  const doc = await Document(output, textContext); expect((await readDocumentArchive(output, textContext)).package.getPart(name).content_type).toBe(type); expect(doc.paragraphs[0]!.text).toBe("Coast");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
