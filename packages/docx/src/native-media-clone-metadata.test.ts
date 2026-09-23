import { deflateSync } from "node:zlib";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentControlRepeats, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { joinBytes, pngChunk, rasterBmp, rasterJpeg, rasterPng, rasterTiff } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (s: string) => new TextEncoder().encode(s);
const formats: { name: string; type: string; bytes: Uint8Array; rejected?: boolean }[] = [];
// Independent original pixel streams. The nonempty Adam7 passes for 3x5
// have literal dimensions (1x1, 1x1, 1x2, 2x1, 1x3, 3x2).
for (const [color, depths, channels] of [[0, [1, 2, 4, 8, 16], 1], [2, [8, 16], 3], [3, [1, 2, 4, 8], 1], [4, [8, 16], 2], [6, [8, 16], 4]] as const)
for (const depth of depths) for (const interlace of [0, 1]) for (const wide of [false, true]) {
  const header = new Uint8Array(13), v = new DataView(header.buffer);
  v.setUint32(0, wide ? 3 : 1); v.setUint32(4, wide ? 5 : 1); header.set([depth, color, 0, 0, interlace], 8);
  const passes = !wide ? [[1, 1]] : interlace ? [[1, 1], [1, 1], [1, 2], [2, 1], [1, 3], [3, 2]] : [[3, 5]];
  let row = 0;
  const scanline = joinBytes(...passes.flatMap(([width, height]) => Array.from({ length: height! }, () => {
    const bytes = new Uint8Array(1 + Math.ceil(width! * channels * depth / 8)); bytes[0] = row++ % 5; return bytes;
  })));
  const bytes = joinBytes(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk("IHDR", header),
    ...(color === 3 ? [pngChunk("PLTE", Uint8Array.of(20, 40, 60))] : []),
    pngChunk("IDAT", deflateSync(scanline)), pngChunk("IEND", new Uint8Array()));
  formats.push({ name: `PNG ${wide ? "3x5 " : ""}color=${color} depth=${depth} interlace=${interlace}`, type: "image/png", bytes });
}
const richPng = formats.find(format => format.name === "PNG color=6 depth=16 interlace=1")!.bytes;
for (const fault of ["row-filter", "expanded-size", "adler", "trailing-deflate"] as const) {
  const pixels = new Uint8Array(fault === "expanded-size" ? 10 : 9); if (fault === "row-filter") pixels[0] = 5;
  let stream: Uint8Array = new Uint8Array(deflateSync(pixels));
  if (fault === "adler") stream[stream.length - 1] = stream[stream.length - 1]! ^ 1;
  if (fault === "trailing-deflate") stream = joinBytes(stream.slice(0, -4), Uint8Array.of(0), stream.slice(-4));
  formats.push({ name: `PNG malformed retained ${fault}`, type: "image/png", bytes: joinBytes(richPng.slice(0, 33), pngChunk("IDAT", stream), richPng.slice(-12)), rejected: true });
}
for (const [x, y, unit] of [[0, 0, 1], [0, 945, 1], [1654, 0, 1], [1654, 945, 1], [10, 20, 0]] as const)
  formats.push({ name: `PNG density=${x}/${y}/${unit}`, type: "image/png", bytes: rasterPng(1, 1, [x, y, unit]) });
const png = rasterPng();
formats.push({ name: "PNG empty initial IDAT and inert metadata", type: "image/png", bytes: joinBytes(png.slice(0, 33), pngChunk("tEXt", enc("audit\0Original coast")), pngChunk("IDAT", new Uint8Array()), png.slice(33)) });
for (const little of [true, false]) {
  formats.push({ name: `JPEG Exif fractional centimetres little=${little}`, type: "image/jpeg", bytes: rasterJpeg(2, 3, [0, 1, 1], rasterTiff(little, 3, [85, 2], [337, 4])) });
  for (const unit of [1, 2, 3]) formats.push({ name: `TIFF fractional density little=${little} unit=${unit}`, type: "image/tiff", bytes: rasterTiff(little, unit, [85, 2], [337, 4]) });
}
for (const density of [[1, 72, 0], [1, 0, 144], [2, 10, 20]] as const)
  formats.push({ name: `JPEG JFIF density=${density.join("/")}`, type: "image/jpeg", bytes: rasterJpeg(2, 3, density) });
for (const height of [1, -1]) formats.push({ name: `BMP density and height=${height}`, type: "image/bmp", bytes: rasterBmp(1, height, 1654, 0) });

function elements(node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] {
  return [node, ...node.children.flatMap(child => typeof child === "string" ? [] : elements(child))];
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const format of formats) for (const route of ["sdk", "shell"] as const)
it(`${route} retains shared ${format.name} during repeat cloning; ${kind} strict=${strict}`, async () => {
  const root = strict ? "http://purl.oclc.org/ooxml/" : "http://schemas.openxmlformats.org/";
  const a = root + (strict ? "drawingml/main" : "drawingml/2006/main"), wp = root + (strict ? "drawingml/wordprocessingDrawing" : "drawingml/2006/wordprocessingDrawing"), pic = root + (strict ? "drawingml/picture" : "drawingml/2006/picture"), r = root + (strict ? "officeDocument/relationships" : "officeDocument/2006/relationships");
  const drawing = `<w:drawing><wp:inline xmlns:wp="${wp}"><wp:extent cx="19050" cy="9525"/><wp:docPr id="9" name="Original"/><a:graphic xmlns:a="${a}"><a:graphicData uri="${pic}"><pic:pic xmlns:pic="${pic}"><pic:nvPicPr><pic:cNvPr id="9" name="Original"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="19050" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  const body = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:r>${drawing}</w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const parts = readPackage(await chartFixture({ strict, definitions: [], body, resources: [{ name: "media/payload.bin", type: format.type + "; audit=coast", bytes: format.bytes }], relationships: [{ owner: "/word/document.xml", id: "image", type: r + "/image", target: "../media/payload.bin" }] }));
  parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`)));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = input.slice();
  expect((await Document(input, chartContext)).part.package.parts.find(part => String(part.partname) === "/media/payload.bin")!.blob).toEqual(format.bytes);
  if (route === "sdk") {
    const pending = editDocumentControlRepeats(input, { control: 1, data: [{ values: [] }, { values: [] }], output: "-" }, { ...chartContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    if (format.rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); else expect((await pending).changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: chartContext.limits }) }));
    try {
      const result = await shell.exec('docx controls repeat /input --control 1 --data-json \'[{"values":[]},{"values":[]}]\' --output - > /output');
      expect(result.exitCode, result.stderr).toBe(format.rejected ? 1 : 0); if (format.rejected) expect(result.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(before);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  expect(input).toEqual(before); expect(memory.readFileSync("/input")).toEqual(Buffer.from(before));
  if (format.rejected) { expect(output).toHaveLength(0); return; }
  const saved = readPackage(output), nodes = elements(xmlStructure(saved.get("word/document.xml")!));
  const references = nodes.filter(node => node.name === `{${a}}blip`).map(node => node.attributes[`{${r}}embed`]);
  expect(references).toHaveLength(2); expect(new Set(references).size).toBe(2); expect(references).not.toContain("image");
  const edges = elements(xmlStructure(saved.get("word/_rels/document.xml.rels")!)).filter(node => node.name === "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship");
  expect(edges).toHaveLength(3);
  for (const id of ["image", ...references]) expect(edges.find(node => node.attributes["{}Id"] === id)?.attributes).toEqual({ "{}Id": id, "{}Target": "../media/payload.bin", "{}Type": r + "/image" });
  expect(nodes.filter(node => node.name === `{${wp}}extent`).map(node => node.attributes)).toEqual([{ "{}cx": "19050", "{}cy": "9525" }, { "{}cx": "19050", "{}cy": "9525" }]);
  for (const [name, bytes] of parts) if (!["word/document.xml", "word/_rels/document.xml.rels"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  expect((await Document(output, chartContext)).part.package.parts.find(part => String(part.partname) === "/media/payload.bin")!.blob).toEqual(format.bytes);
  expect(input).toEqual(before); expect(memory.readFileSync("/input")).toEqual(Buffer.from(before));
});

for (const format of formats.filter(format => format.name.startsWith("PNG ") && format.name.includes("color=")))
it(`keeps the explicit picture-control profile for ${format.name}`, async () => {
  const { admitControlPng } = await import("./control-picture.js");
  const allowed = format.bytes[24] === 8 && [2, 6].includes(format.bytes[25]!) && format.bytes[28] === 0;
  const pending = admitControlPng(format.bytes, chartContext);
  if (allowed) expect(await pending).toEqual(format.bytes);
  else await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
});
