import { expect, it } from "vitest";
import { crc32, createCompressionCodec } from "@poe-code/office-package";
import { textContext } from "../tests/fixtures/text.js";
import { textFixture, r } from "../tests/fixtures/text.js";
import { Volume } from "memfs";
import { readArchive, writeArchive } from "./index.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";

export const drawing = '<w:r><w:drawing><d:inline xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/drawingml/2006/picture"><d:extent cx="3600" cy="7200"/><d:docPr id="1" name="Pixel" descr="Blue"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><p:pic><p:nvPicPr/><p:blipFill><a:blip r:embed="old"/><a:srcRect l="500"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:ext cx="3600" cy="7200"/></a:xfrm></p:spPr></p:pic></a:graphicData></a:graphic></d:inline></w:drawing></w:r>';
export async function pictureFixture(content = drawing, external = false) {
  const base = await textFixture(`<w:p><w:sdt><w:sdtPr><w:picture/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>${drawing.split('id="1"').join('id="2"')}</w:p>`);
  const archive = await readArchive(base, textContext); const png = await pixelPng(); const fs = Volume.fromJSON({ "/archive": "" });
  const members = archive.members.map(member => member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="old" Type="${r}/image" Target="${external ? "https://example.invalid/pixel.png" : "media/original.png"}"${external ? ' TargetMode="External"' : ""}/></Relationships>`) } : member.name === "[Content_Types].xml" ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).split("</Types>").join('<Default Extension="png" ContentType="image/png"/></Types>')) } : member);
  await writeArchive({ ...archive, members: [...members, { name: "word/media/original.png", bytes: png, directory: false, modified: new Date("2025-01-02T03:04:06Z") }] }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(fs.readFileSync("/archive") as Buffer);
}

export async function pixelPng() {
  const raw = new Uint8Array([0, 18, 49, 87, 255]);
  const codec = createCompressionCodec(); const reader = new codec.CodecReader({ async *[Symbol.asyncIterator]() { yield raw; } }, textContext.signal);
  const chunks: Uint8Array[] = []; for await (const chunk of codec.codec(reader, { mode: "deflate-raw" }, textContext.signal)) chunks.push(new Uint8Array(chunk));
  const compressed = new Uint8Array(2 + chunks.reduce((n, b) => n + b.length, 0) + 4); compressed.set([0x78, 0x01]); let offset = 2;
  for (const chunk of chunks) { compressed.set(chunk, offset); offset += chunk.length; }
  let a = 1, b = 0; for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521; } new DataView(compressed.buffer).setUint32(offset, (b << 16 | a) >>> 0);
  const chunk = (name: string, data: Uint8Array) => { const result = new Uint8Array(data.length + 12); const view = new DataView(result.buffer); view.setUint32(0, data.length); result.set(new TextEncoder().encode(name), 4); result.set(data, 8); view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8))); return result; };
  const header = new Uint8Array(13); const view = new DataView(header.buffer); view.setUint32(0, 1); view.setUint32(4, 1); header.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); offset = 0; for (const part of parts) { png.set(part, offset); offset += part.length; } return png;
}
it("admits original bounded PNG pixels and rejects CRC or encoded payload corruption", async () => {
  const module = await import("./control-picture.js"); const png = await pixelPng();
  expect(await module.admitControlPng(png, textContext)).toEqual(png);
  const bad = new Uint8Array(png); bad[20] = 2; await expect(module.admitControlPng(bad, textContext)).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects extra encoded bytes following the PNG deflate stream even with repaired CRC", async () => {
  const module = await import("./control-picture.js"); const png = await pixelPng(); const length = new DataView(png.buffer).getUint32(33), insertion = 41 + length - 4;
  const changed = new Uint8Array(png.length + 1); changed.set(png.subarray(0, insertion)); changed[insertion] = 0; changed.set(png.subarray(insertion), insertion + 1);
  new DataView(changed.buffer).setUint32(33, length + 1); new DataView(changed.buffer).setUint32(41 + length + 1, crc32(changed.subarray(37, 41 + length + 1)));
  await expect(module.admitControlPng(changed, textContext).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("requires matching explicit streaming capability and owns reused fragments", async () => {
  const module = await import("./control-picture.js"); const png = await pixelPng(); let opened = false;
  const binaryResolver = { capability: "owned", async *open(_path: string, options: { signal: AbortSignal; maxBytes: number }) { opened = true; expect(options.signal).toBe(textContext.signal); expect(options.maxBytes).toBeLessThanOrEqual(textContext.limits.maxEntryBytes); const buffer = new Uint8Array(7); for (let offset = 0; offset < png.length; offset += 7) { buffer.fill(0); buffer.set(png.subarray(offset, offset + 7)); yield buffer.subarray(0, Math.min(7, png.length - offset)); } } };
  await expect(module.acquireControlPng({ kind: "vfs", path: "/pixel", capability: "wrong" }, { ...textContext, binaryResolver })).rejects.toMatchObject({ code: "unsupported-edit" }); expect(opened).toBe(false);
  expect(await module.acquireControlPng({ kind: "vfs", path: "/pixel", capability: "owned" }, { ...textContext, binaryResolver })).toEqual(png);
});
it("enforces lowered media capability bounds before excess collection and closes the producer", async () => {
  const module = await import("./control-picture.js"); const { DocumentBudget } = await import("./budget.js"); const png = await pixelPng(); let reads = 0, closed = false, maximum = 0;
  const binaryResolver = { capability: "owned", async *open(_path: string, options: { maxBytes: number }) { maximum = options.maxBytes; try { reads++; yield png; reads++; yield new Uint8Array(10); reads++; yield new Uint8Array(10); } finally { closed = true; } } };
  await expect(module.acquireControlPng({ kind: "vfs", path: "/pixel", capability: "owned" }, { ...textContext, budget: new DocumentBudget({ embeddedMediaBytes: png.length + 5 }, textContext.signal), binaryResolver }).then(() => undefined)).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(maximum).toBe(png.length + 5); expect(reads).toBe(2); expect(closed).toBe(true);
});
it("bounds actual command VFS PNG collection by the lowered media limit and closes on refusal", async () => {
  const input = await pictureFixture(); const png = await pixelPng(); let reads = 0, closed = false; const fs = Volume.fromJSON({ "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["controls", "set", "/input", "--control", "1", "--file", "/pixel", "--output", "-", "--limit", `embeddedMediaBytes=${png.length + 5}`].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { return input; }, readStream(path) { return { async *[Symbol.asyncIterator]() { if (path === "/input") { yield input; return; } try { reads++; yield png; reads++; yield new Uint8Array(10); reads++; yield new Uint8Array(10); } finally { closed = true; } } }; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { fs.appendFileSync("/err", bytes); } } });
  expect(result.exitCode).not.toBe(0); expect(reads).toBe(2); expect(closed).toBe(true); expect(fs.readFileSync("/out").length).toBe(0);
});
it("replaces only an existing picture-control occurrence and retains shared media/geometry/crop/alt", async () => {
  const input = await pictureFixture(); const module = await import("./controls.js"); const png = await pixelPng(); const fs = Volume.fromJSON({ "/out": "" });
  await module.editDocumentControls(input, { control: 1, file: { kind: "bytes", base64: btoa(String.fromCharCode(...png)) }, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } } });
  const output = new Uint8Array(fs.readFileSync("/out") as Buffer); const archive = await readArchive(output, textContext);
  expect(archive.members.find(member => member.name === "word/media/original.png")!.bytes).toEqual(png);
  expect(archive.members.filter(member => member.name.endsWith(".png"))).toHaveLength(2);
  const xml = new TextDecoder().decode(archive.members.find(member => member.name === "word/document.xml")!.bytes);
  expect(xml.split('r:embed="old"')).toHaveLength(2); expect(xml).toContain('r:embed="rId1"'); expect(xml).toContain('<a:srcRect l="500"/>'); expect(xml).toContain('descr="Blue"'); expect(xml).toContain('cx="3600" cy="7200"');
});
it.each(["missing", "external", "multiple"])("refuses %s existing picture occurrence without publication", async scenario => {
  const input = await pictureFixture(scenario === "missing" ? "<w:r/>" : scenario === "multiple" ? drawing + drawing.split('id="1"').join('id="3"') : drawing, scenario === "external");
  const module = await import("./controls.js"); const png = await pixelPng(); let writes = 0;
  await expect(module.editDocumentControls(input, { control: 1, file: { kind: "bytes", base64: btoa(String.fromCharCode(...png)) }, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { writes++; } } })).rejects.toMatchObject({ code: "unsupported-edit" }); expect(writes).toBe(0);
});
it("refuses a stray DrawingML blip without an admitted picture/graphic occurrence", async () => {
  const input = await pictureFixture('<w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="old"/></w:drawing></w:r>'); const module = await import("./controls.js"); const png = await pixelPng();
  await expect(module.editDocumentControls(input, { control: 1, file: { kind: "bytes", base64: btoa(String.fromCharCode(...png)) }, dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
