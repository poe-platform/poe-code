import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string) => ({ resultHandle });
const samples = [
  { ext: "png", blob: rasterPng() }, { ext: "jpg", blob: rasterJpeg() },
  { ext: "gif", blob: rasterGif() }, { ext: "bmp", blob: rasterBmp() },
  { ext: "tiff", blob: rasterTiff() }
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const source of ["bytes", "named", "unknown-suffix", "no-suffix", "empty-suffix"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it.each(samples)(`${route} imports admitted $ext image metadata from ${source}; ${kind} strict=${strict}`, async sample => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p><w:r><w:t>Imported estuary</w:t></w:r></w:p>");
  const filename = source === "bytes" ? "image." + sample.ext : source === "named" ? "Coast 海." + sample.ext.toUpperCase() : source === "unknown-suffix" ? "Coast 海.asset" : source === "no-suffix" ? "Coast 海" : "Coast 海.";
  const path = "/images/" + filename, partname = "/imports/picture." + sample.ext;
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), [path]: Buffer.from(sample.blob), "/output": "" });
  let acquisitions = 0, finalized = 0;
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const,
    binaryResolver: { capability: "command", async *open(name: string) { acquisitions++; try { yield new Uint8Array(volume.readFileSync(name) as Buffer); } finally { finalized++; } } } };
  const descriptor = source === "bytes" ? { kind: "bytes", base64: Buffer.from(sample.blob).toString("base64") } : { path, capability: "command" };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.image.image.Image.from_file.call", arguments: { imageDescriptor: descriptor }, resultHandle: "source" },
    { operation: "model.image.image.Image.filename.get", receiver: ref("source"), arguments: {} },
    { operation: "model.parts.image.ImagePart.from_image.call", arguments: { image: ref("source"), partname, ownerPackage: ref("package") }, resultHandle: "part" },
    { operation: "model.parts.image.ImagePart.filename.get", receiver: ref("part"), arguments: {} },
    { operation: "model.parts.image.ImagePart.image.get", receiver: ref("part"), arguments: {}, resultHandle: "imported" },
    { operation: "model.image.image.Image.filename.get", receiver: ref("imported"), arguments: {} },
    { operation: "model.image.image.Image.ext.get", receiver: ref("imported"), arguments: {} },
    { operation: "model.parts.image.ImagePart.blob.get", receiver: ref("part"), arguments: {} },
    { operation: "model.image.image.Image.filename.get", receiver: ref("source"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  const expectedSuffix = source === "no-suffix" ? "" : filename.slice(filename.lastIndexOf(".") + 1);
  if (route === "model") {
    const image = await api.Image.from_file(source === "bytes" ? sample.blob : { path, capability: "command" }, context);
    expect(image.filename).toBe(filename);
    const document = await api.Document(input, context), pending = api.ImagePartView.from_image(image, new api.PackURI(partname), document.part.package);
    expect(pending).toBeInstanceOf(Promise); const part = await pending;
    expect(part.filename).toBe(filename); expect(part.image.filename).toBe(filename); expect(part.image.ext).toBe(expectedSuffix);
    expect(part.package).toBe(document.part.package); expect(String(part.partname)).toBe(partname); expect(part.blob).toEqual(sample.blob); expect(image.filename).toBe(filename);
    const copy = part.image.blob; copy.fill(0); expect(image.blob).toEqual(sample.blob); expect(part.blob).toEqual(sample.blob);
    await document.save(sink);
  } else if (route === "sdk") {
    const data = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    for (const index of [3, 5, 7, 10]) expect(data.results[index]!.data, operations[index]!.operation).toBe(filename);
    expect(data.results[8]!.data).toBe(expectedSuffix); expect(data.results[9]!.data).toEqual({ kind: "bytes", base64: Buffer.from(sample.blob).toString("base64") });
  } else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/images"); await fs.writeFile("/input", input); await fs.writeFile(path, sample.blob); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const data = JSON.parse(result.stdout); for (const index of [3, 5, 7, 10]) expect(data.data.results[index].data, operations[index]!.operation).toBe(filename);
      expect(data.data.results[8].data).toBe(expectedSuffix); expect(data.data.results[9].data).toEqual({ kind: "bytes", base64: Buffer.from(sample.blob).toString("base64") });
      volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile(path)).toEqual(sample.blob);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of readPackage(input)) if (name !== "[Content_Types].xml") expect(saved.get(name), name).toEqual(bytes);
  expect(saved.get(partname.slice(1))).toEqual(sample.blob); expect(saved.size).toBe(readPackage(input).size + 1);
  const reopened = await api.Document(output, textContext), stored = [...reopened.part.package.image_parts][0]!;
  expect(stored.blob).toEqual(sample.blob); expect(stored.image.content_type).toBe(sample.ext === "jpg" ? "image/jpeg" : "image/" + sample.ext);
  expect(reopened.part.content_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml." + (kind === "docx" ? "document" : "template") + ".main+xml");
  if (route !== "shell") { expect(acquisitions).toBe(source === "bytes" ? 0 : 1); expect(finalized).toBe(acquisitions); }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync(path)).toEqual(Buffer.from(sample.blob));
});
