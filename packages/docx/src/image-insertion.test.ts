import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { crc32 } from "@poe-code/office-package";
import { insertDocumentImage } from "./image-insertion.js";
import { paragraph, textContext, textFixture, table } from "../tests/fixtures/text.js";
import { readDocumentArchive } from "./admission.js";
import { openDocumentLocations } from "./locations.js";
import { writeArchive } from "./archive-write.js";
import { ResourceLimitError } from "./archive.js";
import * as structuredContent from "./create-content.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { w } from "../tests/fixtures/text.js";

function png(density?: number) {
  const chunk = (name: string, payload: number[]) => { const bytes = new Uint8Array(12 + payload.length), view = new DataView(bytes.buffer); view.setUint32(0, payload.length); bytes.set(new TextEncoder().encode(name), 4); bytes.set(payload, 8); view.setUint32(8 + payload.length, crc32(bytes.subarray(4, 8 + payload.length))); return bytes; };
  const densityBytes = new Uint8Array(9); if (density !== undefined) { const view = new DataView(densityBytes.buffer); view.setUint32(0, density); view.setUint32(4, density); densityBytes[8] = 1; }
  const pieces = [Uint8Array.from([137,80,78,71,13,10,26,10]), chunk("IHDR", [0,0,0,1,0,0,0,1,8,6,0,0,0]), ...(density === undefined ? [] : [chunk("pHYs", [...densityBytes])]), chunk("IDAT", [120,1,1,5,0,250,255,0,12,34,56,128,1,139,0,231]), chunk("IEND", [])];
  const result = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const piece of pieces) { result.set(piece, offset); offset += piece.length; } return result;
}
const binary = () => ({ kind: "bytes" as const, base64: btoa(String.fromCharCode(...png())) });
function jpeg(width: number, height: number, horizontalDpi = 72, verticalDpi = 72) {
  const marker = (tag: number, payload: number[]) => [255, tag, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
  return Uint8Array.from([255,216,...marker(224,[74,70,73,70,0,1,1,1,horizontalDpi >> 8,horizontalDpi & 255,verticalDpi >> 8,verticalDpi & 255,0,0]), ...marker(192,[8,height >> 8,height & 255,width >> 8,width & 255,1,1,17,0]), ...marker(218,[1,1,0,0,63,0]),0,255,217]);
}
async function insert(body: string, options: Partial<DocxOperationArguments<"images.add">> = {}, strict = false) {
  const input = await textFixture(body, {}, strict), fs = Volume.fromJSON({ "/out": "" });
  const data = await insertDocumentImage(input, { operation: "images.add", options: { file: binary(), output: "-", ...options } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } } });
  const bytes = new Uint8Array(fs.readFileSync("/out") as Buffer), archive = await readDocumentArchive(bytes, textContext);
  return { data, bytes, archive, xml: new TextDecoder().decode(archive.members.find(m => m.name === "word/document.xml")!.bytes) };
}
it.each([false, true])("appends an original inline image while preserving paragraph source (%s)", async strict => {
  const body = '<w:p><w:pPr><w:keepNext/></w:pPr><!--kept--><w:r><w:rPr><w:b/></w:rPr><w:t>Garden</w:t></w:r></w:p>';
  const result = await insert(body, { paragraph: 1, alt: "Leaf" }, strict);
  expect(result.xml).toContain('<!--kept--><w:r><w:rPr><w:b/></w:rPr><w:t>Garden</w:t></w:r>');
  expect(result.xml).toContain('cx="12700" cy="12700"'); expect(result.xml).toContain('descr="Leaf"');
  expect(result.archive.members.find(m => m.name.endsWith(".png"))?.bytes).toEqual(png());
  expect(result.data.changes[0]?.before.kind).toBe("paragraph"); expect(result.data.changes[0]?.after.kind).toBe("image");
  expect(result.data.changes[0]?.kind).toBe("add");
  expect((await openDocumentLocations(result.bytes, textContext)).list("image")).toHaveLength(1);
});
it("uses unique body and selected cell containers without choosing an existing paragraph", async () => {
  const body = paragraph("First") + paragraph("Second") + '<w:sectPr/>';
  const result = await insert(body); expect(result.data.changes[0]?.before.kind).toBe("story"); expect(result.xml.indexOf('inline')).toBeLessThan(result.xml.indexOf('<w:sectPr/>'));
  expect((await openDocumentLocations(result.bytes, textContext)).list("paragraph")).toHaveLength(3);
  const content = table([paragraph("Cell")]), document = await openDocumentLocations(await textFixture(content), textContext);
  const cell = await insert(content, { select: document.cell(document.at("table", 1).token, "A1").token });
  expect(cell.data.changes[0]?.before.kind).toBe("cell"); expect((await openDocumentLocations(cell.bytes, textContext)).list("paragraph")).toHaveLength(2);
});
it.each(["contain", "cover", "stretch"] as const)("applies explicit %s fit and checked dimensions", async fit => {
  const result = await insert(paragraph("Box"), { paragraph: 1, width: { value: 2, unit: "in" }, height: { value: 1, unit: "in" }, fit });
  expect(result.xml).toContain(fit === "contain" ? 'cx="914400" cy="914400"' : 'cx="1828800" cy="914400"');
  if (fit === "cover") expect(result.xml).toContain('t="25000" b="25000"');
});
it("rounds explicit extents halfway away and scales one dimension", async () => {
  const result = await insert(paragraph("Size"), { paragraph: 1, width: { value: 10.5, unit: "emu" } }); expect(result.xml).toContain('cx="11" cy="11"');
});
it("scales one explicit dimension from the unrounded native physical ratio", async () => {
  const source = jpeg(1, 1, 73, 79), result = await insert(paragraph("Ratio"), { paragraph: 1, file: { kind: "bytes", base64: btoa(String.fromCharCode(...source)) }, width: { value: 1, unit: "in" } });
  expect(result.xml).toContain('cx="914400" cy="844952"');
});
it("refuses range and floating insertion without publication", async () => {
  const input = await textFixture(paragraph("Garden")), document = await openDocumentLocations(input, textContext); let writes = 0;
  for (const options of [{ select: document.range(document.at("paragraph", 1).token, 1, 1).token }, { paragraph: 1, placement: "floating" as const }]) {
    await expect(insertDocumentImage(input, { operation: "images.add", options: { file: binary(), output: "-", ...options } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { writes++; } } })).rejects.toThrow();
  } expect(writes).toBe(0);
});
it.each([[12,6,144,72,76200,76200],[6,12,72,144,76200,76200],[12,6,0,72,152400,76200]])("sizes exact JPEG bytes with independent physical axes (%s,%s)", async (width, height, xDpi, yDpi, xEmu, yEmu) => {
  const source = jpeg(width, height, xDpi, yDpi), result = await insert(paragraph("Photo"), { paragraph: 1, file: { kind: "bytes", base64: btoa(String.fromCharCode(...source)) } });
  expect(result.xml).toContain(`cx="${xEmu}" cy="${yEmu}"`); expect(result.archive.members.find(m => m.name.endsWith(".jpg"))?.bytes).toEqual(source);
});
it.each(["header", "footnotes"])("creates owner-local image relationships in explicit %s containers", async kind => {
  const body = paragraph("Body") + (kind === "header" ? '<w:sectPr><w:headerReference w:type="default" r:id="extra"/></w:sectPr>' : ""), xml = kind === "header" ? `<w:hdr xmlns:w="${w}">${paragraph("Heading")}</w:hdr>` : `<w:footnotes xmlns:w="${w}"><w:footnote w:id="1">${paragraph("Note")}</w:footnote></w:footnotes>`;
  const input = await textFixture(body, { extra: { kind, xml } }), document = await openDocumentLocations(input, textContext), fs = Volume.fromJSON({ "/out": "" });
  const select = document.list("story", { scope: kind === "header" ? "headers" : "footnotes" })[0]!.token;
  const data = await insertDocumentImage(input, { operation: "images.add", options: { file: binary(), select, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } } });
  const archive = await readDocumentArchive(new Uint8Array(fs.readFileSync("/out") as Buffer), textContext);
  expect(data.changes[0]?.after.value.part).toBe("/word/extra.xml"); expect(archive.members.find(m => m.name === "word/_rels/extra.xml.rels")).toBeDefined();
  expect(new TextDecoder().decode(archive.members.find(m => m.name === "word/document.xml")!.bytes)).not.toContain("inline");
});
it("owns producer-reused media chunks and reserves admission before publication", async () => {
  const input = await textFixture(paragraph("Garden")), source = png(), split = Math.ceil(source.length / 2), fragment = new Uint8Array(split), fs = Volume.fromJSON({ "/out": "" }); let admitted = false;
  const data = await insertDocumentImage(input, { operation: "images.add", options: { file: { kind: "vfs", path: "/leaf.png", capability: "garden" }, paragraph: 1, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" },
    binaryResolver: { capability: "garden", async *open() { fragment.set(source.subarray(0, split)); yield fragment; fragment.fill(0); fragment.set(source.subarray(split)); yield fragment.subarray(0, source.length - split); fragment.fill(0); } },
    admitPublication() { expect(fs.readFileSync("/out").length).toBe(0); admitted = true; return undefined; }, stdout: { async write(bytes) { expect(admitted).toBe(true); fs.appendFileSync("/out", bytes); } } });
  expect(data.changed).toBe(true); const archive = await readDocumentArchive(new Uint8Array(fs.readFileSync("/out") as Buffer), textContext); expect(archive.members.find(m => m.name.endsWith(".png"))?.bytes).toEqual(source);
});
it("refuses mismatch and prepublication admission failures without effects", async () => {
  const input = await textFixture(paragraph("Garden")); let writes = 0;
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, binaryResolver: { capability: "garden", async *open() { yield png(); } }, stdout: { async write() { writes++; } } };
  await expect(insertDocumentImage(input, { operation: "images.add", options: { file: { kind: "vfs", path: "/leaf.jpg", capability: "garden" }, paragraph: 1, output: "-" } }, context)).rejects.toThrow("signature");
  await expect(insertDocumentImage(input, { operation: "images.add", options: { file: binary(), paragraph: 1, output: "-" } }, { ...context, admitPublication() { throw new Error("admission stopped"); } })).rejects.toThrow("admission stopped"); expect(writes).toBe(0);
});
it("admits request and file identity descriptors before image acquisition", async () => {
  const input = await textFixture(paragraph("Garden")); let reads = 0;
  const request = { operation: "images.add" as const, options: { file: { kind: "vfs" as const, path: "/leaf.png", capability: "garden" }, paragraph: 1, dryRun: true }, input: { path: "/input.docx", stat: { type: "file" as const, size: input.length, mode: 420, mtimeMs: 0, atimeMs: 0, ctimeMs: 0, unknown: true } } };
  await expect(insertDocumentImage(input, request, { ...textContext, encoding: { order: "input", compression: "store" }, binaryResolver: { capability: "garden", async *open() { reads++; yield png(); } } })).rejects.toThrow(); expect(reads).toBe(0);
});
it("does not serialize an unused JSON envelope on a dry-run SDK call", async () => {
  const input = await textFixture(paragraph("Garden"));
  const stringify = vi.spyOn(JSON, "stringify");
  try { const data = await insertDocumentImage(input, { operation: "images.add", options: { file: binary(), paragraph: 1, dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } });
    expect(data.changed).toBe(true); expect(data.output).toBeNull(); expect(stringify.mock.calls.filter(([value]) => value && typeof value === "object" && value.operation === "images.add")).toHaveLength(0);
  } finally { stringify.mockRestore(); }
});
it("allocates fresh media, relationship and numeric drawing identifiers without orphan adoption", async () => {
  const first = await insert(paragraph("Garden"), { paragraph: 1 }), fs = Volume.fromJSON({ "/input": "", "/out": "" });
  const archive = { ...first.archive, members: first.archive.members.map(m => m.name === "word/document.xml" ? { ...m, bytes: new TextEncoder().encode(new TextDecoder().decode(m.bytes).replace('docPr id="1"', 'docPr id="01"')) } : m) };
  await writeArchive(archive, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  await insertDocumentImage(new Uint8Array(fs.readFileSync("/input") as Buffer), { operation: "images.add", options: { file: binary(), paragraph: 1, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } } });
  const result = await readDocumentArchive(new Uint8Array(fs.readFileSync("/out") as Buffer), textContext), xml = new TextDecoder().decode(result.members.find(m => m.name === "word/document.xml")!.bytes);
  expect(xml).toContain('docPr id="2"'); expect(result.members.filter(m => m.name.endsWith(".png"))).toHaveLength(2); expect(new TextDecoder().decode(result.members.find(m => m.name === "word/_rels/document.xml.rels")!.bytes)).toContain('Id="rId2"');
});
it("reports canonical binary media capacity as a resource limit before publication", async () => {
  const input = await textFixture(paragraph("Garden")); let admitted = false;
  await expect(insertDocumentImage(input, { operation: "images.add", options: { file: binary(), paragraph: 1, dryRun: true, limit: [{ name: "embeddedMediaBytes", value: 1 }] } }, { ...textContext, encoding: { order: "input", compression: "store" }, admitPublication() { admitted = true; return undefined; } })).rejects.toBeInstanceOf(ResourceLimitError);
  expect(admitted).toBe(false);
});
it.each([undefined, "stretch"] as const)("uses two explicit extents despite native dimensions below one EMU (%s)", async fit => {
  const source = png(4294967295), result = await insert(paragraph("Small"), { paragraph: 1, file: { kind: "bytes", base64: btoa(String.fromCharCode(...source)) }, width: { value: 1, unit: "in" }, height: { value: 1, unit: "in" }, ...(fit === undefined ? {} : { fit }) });
  expect(result.xml).toContain('cx="914400" cy="914400"'); expect(result.archive.members.find(m => m.name.endsWith(".png"))?.bytes).toEqual(source);
});
it("refuses escaped alternative text exceeding its owner XML before escaping or rendering", async () => {
  const input = await textFixture(paragraph("Bound")), alt = "&".repeat(3000), escape = vi.spyOn(structuredContent, "xmlValue");
  try {
    await expect(insertDocumentImage(input, { operation: "images.add", options: { file: binary(), paragraph: 1, dryRun: true, alt, limit: [{ name: "xmlPartBytes", value: 4096 }] } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toBeInstanceOf(ResourceLimitError);
    expect(escape.mock.calls.filter(([value]) => value === alt)).toHaveLength(0);
  } finally { escape.mockRestore(); }
});
it("admits exact escaped UTF-8 owner size and refuses one byte below before escaping", async () => {
  const body = "<w:p/>", alt = '&"<海🌿\n', rendered = await insert(body, { paragraph: 1, alt }), exactBytes = rendered.archive.members.find(m => m.name === "word/document.xml")!.bytes.length, input = await textFixture(body);
  const options = { file: binary(), paragraph: 1, dryRun: true, alt };
  await expect(insertDocumentImage(input, { operation: "images.add", options: { ...options, limit: [{ name: "xmlPartBytes", value: exactBytes }] } }, { ...textContext, encoding: { order: "input", compression: "store" } })).resolves.toMatchObject({ changed: true });
  const escape = vi.spyOn(structuredContent, "xmlValue");
  try {
    await expect(insertDocumentImage(input, { operation: "images.add", options: { ...options, limit: [{ name: "xmlPartBytes", value: exactBytes - 1 }] } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toBeInstanceOf(ResourceLimitError);
    expect(escape.mock.calls.filter(([value]) => value === alt)).toHaveLength(0);
  } finally { escape.mockRestore(); }
});
