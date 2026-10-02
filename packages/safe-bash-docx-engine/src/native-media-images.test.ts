import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocumentImages, replaceDocumentImage, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const parameter of ["", ";audit=coast", '; audit="coast; dune"'] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} characterizes native image MIME with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const memory = Volume.fromJSON({"/seed": "", "/input": "", "/output": ""}), png = rasterPng(10, 20);
  const seed = await Document(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict), textContext);
  await seed.add_picture(png); await seed.save({async write(bytes) {memory.appendFileSync("/seed", bytes);}});
  const parts = readPackage(new Uint8Array(memory.readFileSync("/seed") as Buffer)), encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace('ContentType="image/png"', `ContentType="image/png${parameter.replaceAll('"', '&quot;')}"`).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), replacement = rasterPng(7, 9), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  if (route === "model") {
    const doc = await Document(input, textContext), part = [...doc.part.package.image_parts][0]!;
    expect(part.content_type).toBe("image/png" + parameter); expect(part.image.px_width).toBe(10); expect(part.image.px_height).toBe(20); expect(part.image.blob).toEqual(png);
    expect(await doc.part.package.get_or_add_image_part(png)).toBe(part); expect(doc.part.package.image_parts.length).toBe(1); await doc.save(sink);
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);
  } else if (route === "sdk") {
    const data = await inspectDocumentImages(input, {operation: "images.list"}, textContext);
    expect(data.items![0]!.details).toMatchObject({mime: "image/png", declaredMime: "image/png" + parameter});
    expect(data.warnings.some(warning => warning.code === "unrecognized-image-type")).toBe(false);
    await replaceDocumentImage(input, {operation: "images.replace", options: {image: 1, file: {kind: "bytes", base64: Buffer.from(replacement).toString("base64")}, output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement.png", replacement);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const read = await shell.exec("docx images list /input --json"); expect(read.exitCode, read.stderr).toBe(0);
    const data = JSON.parse(read.stdout); expect(data.data.items[0].details).toMatchObject({mime: "image/png", declaredMime: "image/png" + parameter}); expect(data.warnings.some((warning: {code: string}) => warning.code === "unrecognized-image-type")).toBe(false);
    const result = await shell.exec("docx images replace /input --image 1 --file /replacement.png --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  if (route !== "model") {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    expect([...saved.values()].some(bytes => Buffer.from(bytes).equals(Buffer.from(replacement)))).toBe(true);
    expect((await Document(output, textContext)).inline_shapes.length).toBe(1);
    for (const [name, bytes] of parts) if (!["[Content_Types].xml", "word/document.xml", "word/_rels/document.xml.rels"].includes(name) && !name.startsWith("word/media/")) expect(saved.get(name), name).toEqual(bytes);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
