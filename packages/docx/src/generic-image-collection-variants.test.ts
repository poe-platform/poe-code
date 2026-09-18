import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const enc = (value: string) => new TextEncoder().encode(value);
const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
const samples = [
  { name: "PNG", blob: rasterPng(), type: "image/png", ext: "png", cx: 12700, cy: 12700 },
  { name: "JFIF", blob: rasterJpeg(), type: "image/jpeg", ext: "jpg", cx: 25400, cy: 38100 },
  { name: "GIF87a", blob: rasterGif("87a"), type: "image/gif", ext: "gif", cx: 12700, cy: 12700 },
  { name: "GIF89a", blob: rasterGif("89a"), type: "image/gif", ext: "gif", cx: 12700, cy: 12700 },
  { name: "BMP top-down", blob: rasterBmp(), type: "image/bmp", ext: "bmp", cx: 12700, cy: 12700 },
  { name: "BMP bottom-up", blob: rasterBmp(1, 1), type: "image/bmp", ext: "bmp", cx: 12700, cy: 12700 },
  { name: "TIFF little-endian", blob: rasterTiff(true), type: "image/tiff", ext: "tiff", cx: 6350, cy: 12700 },
  { name: "TIFF big-endian", blob: rasterTiff(false), type: "image/tiff", ext: "tiff", cx: 6350, cy: 12700 }
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it.each(samples)(`${route} retains $name collection ownership, deduplication and part values; ${kind} strict=${strict}`, async sample => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p><w:r><w:t>Estuary archive</w:t></w:r></w:p>");
  const bytes = { kind: "bytes", base64: Buffer.from(sample.blob).toString("base64") };
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const sink = { async write(value: Uint8Array) { volume.appendFileSync("/output", value); } };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.package.Package.image_parts.get", receiver: ref("package"), arguments: {}, resultHandle: "images" },
    { operation: "model.package.ImageParts.__len__.get", receiver: ref("images"), arguments: {} },
    { operation: "model.package.Package.get_or_add_image_part.call", receiver: ref("package"), arguments: { imageDescriptor: bytes }, resultHandle: "image" },
    { operation: "model.package.ImageParts.__contains__.call", receiver: ref("images"), arguments: { value: ref("image") } },
    { operation: "model.package.ImageParts.__contains__.call", receiver: ref("images"), arguments: { value: ref("main") } },
    { operation: "model.package.ImageParts.__iter__.call", receiver: ref("images"), arguments: {}, resultHandle: "items" },
    { operation: "model.parts.image.ImagePart.blob.get", receiver: ref("items", 0), arguments: {} },
    { operation: "model.package.ImageParts.append.call", receiver: ref("images"), arguments: { item: ref("image") } },
    { operation: "model.package.ImageParts.get_or_add_image_part.call", receiver: ref("images"), arguments: { imageDescriptor: bytes }, resultHandle: "sameImage" },
    { operation: "model.parts.image.ImagePart.partname.get", receiver: ref("sameImage"), arguments: {} },
    { operation: "model.package.ImageParts.__len__.get", receiver: ref("images"), arguments: {} },
    ...["default_cx", "default_cy", "filename", "content_type", "sha1", "blob"].map(member => ({ operation: "model.parts.image.ImagePart." + member + ".get", receiver: ref("image"), arguments: {} })),
    { operation: "model.parts.image.ImagePart.image.get", receiver: ref("image"), arguments: {}, resultHandle: "value" },
    { operation: "model.image.image.Image.blob.get", receiver: ref("value"), arguments: {} }
  ];
  const partname = "/word/media/image1." + sample.ext;
  const expected = new Map<number, unknown>([[3, 0], [5, true], [6, false], [8, bytes], [9, null], [11, partname], [12, 1],
    [13, { value: sample.cx, unit: "emu" }], [14, { value: sample.cy, unit: "emu" }], [15, "image." + sample.ext], [16, sample.type], [17, createHash("sha1").update(sample.blob).digest("hex")], [18, bytes], [20, bytes]]);
  if (route === "model") {
    const doc = await api.Document(input, context), owner = doc.part.package, images = owner.image_parts;
    expect(images.length).toBe(0);
    const pending = owner.get_or_add_image_part(sample.blob); expect(pending).toBeInstanceOf(Promise);
    const part = await pending;
    expect(images.has(part)).toBe(true); expect(images.has(doc.part)).toBe(false); expect([...images]).toEqual([part]);
    expect(images.append(part)).toBeUndefined();
    const duplicate = images.get_or_add_image_part(sample.blob); expect(duplicate).toBeInstanceOf(Promise); expect(await duplicate).toBe(part);
    expect(images.length).toBe(1); expect(part.package).toBe(owner); expect(String(part.partname)).toBe(partname);
    expect([part.default_cx.emu, part.default_cy.emu, part.filename, part.content_type, part.sha1]).toEqual([sample.cx, sample.cy, "image." + sample.ext, sample.type, createHash("sha1").update(sample.blob).digest("hex")]);
    expect(part.image.blob).toEqual(sample.blob); const copy = part.blob; copy.fill(0); expect(part.blob).toEqual(sample.blob);
    await owner.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    for (const [index, value] of expected) expect(result.results[index]!.data, operations[index]!.operation).toEqual(value);
    expect(result.results[7]!.data).toEqual([expect.objectContaining({ type: "ImagePart" })]);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const result = JSON.parse(response.stdout); for (const [index, value] of expected) expect(result.data.results[index].data, operations[index]!.operation).toEqual(value);
      expect(result.data.results[7].data).toEqual([expect.objectContaining({ type: "ImagePart" })]);
      volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, before] of readPackage(input)) if (name !== "[Content_Types].xml") expect(saved.get(name), name).toEqual(before);
  expect(saved.get(partname.slice(1))).toEqual(sample.blob); expect(saved.size).toBe(readPackage(input).size + 1);
  const reopened = await api.Document(output, context); expect(reopened.part.package.image_parts.length).toBe(1);
  const held = [...reopened.part.package.image_parts][0]!; expect(held.blob).toEqual(sample.blob); expect(held.image.blob).toEqual(sample.blob);
  expect(reopened.part.content_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml." + (kind === "docx" ? "document" : "template") + ".main+xml");
  expect(reopened.part.element.namespace).toBe(strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
