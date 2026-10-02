import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createDocxInspectionCommandEngine, editDocumentControlRepeats, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const formats = [
  {name: "PNG", type: "image/png", bytes: rasterPng()}, {name: "JPEG", type: "image/jpeg", bytes: rasterJpeg()},
  {name: "GIF87a", type: "image/gif", bytes: rasterGif("87a")}, {name: "GIF89a", type: "image/gif", bytes: rasterGif("89a")},
  {name: "BMP", type: "image/bmp", bytes: rasterBmp()}, {name: "TIFF-LE", type: "image/tiff", bytes: rasterTiff(true)}, {name: "TIFF-BE", type: "image/tiff", bytes: rasterTiff(false)}
];
function nodes(node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] {
  return [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const format of formats)
for (const parameter of ["", ";audit=coast", '; audit="coast; dune"'] as const)
for (const mode of ["valid", "truncated", "mismatched"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} clones ${mode} ${format.name} with MIME ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main", wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", pic = strict ? "http://purl.oclc.org/ooxml/drawingml/picture" : "http://schemas.openxmlformats.org/drawingml/2006/picture", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const encode = (s: string) => new TextEncoder().encode(s), decode = (b: Uint8Array) => new TextDecoder().decode(b);
  const drawing = `<w:drawing><wp:inline xmlns:wp="${wp}"><wp:extent cx="19050" cy="9525"/><wp:docPr id="9" name="Original"/><a:graphic xmlns:a="${a}"><a:graphicData uri="${pic}"><pic:pic xmlns:pic="${pic}"><pic:nvPicPr><pic:cNvPr id="9" name="Original"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="19050" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  const body = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:r>${drawing}</w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const media = mode === "truncated" ? format.bytes.slice(0, 8) : format.bytes, type = (mode === "mismatched" ? format.type === "image/png" ? "image/jpeg" : "image/png" : format.type) + parameter;
  const parts = readPackage(await chartFixture({strict, definitions: [], body, resources: [{name: "media/payload.bin", type, bytes: media}], relationships: [{owner: "/word/document.xml", id: "image", type: r + "/image", target: "../media/payload.bin"}]}));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = mode !== "valid";
  if (route === "sdk") {
    const pending = editDocumentControlRepeats(input, {control: 1, data: [{values: []}, {values: []}], output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
    if (rejected) await expect(pending).rejects.toMatchObject({code: "unsupported-edit"}); else expect((await pending).changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
    const result = await shell.exec('docx controls repeat /input --control 1 --data-json \'[{"values":[]},{"values":[]}]\' --output - > /output'); expect(result.exitCode, result.stderr).toBe(rejected ? 1 : 0); if (rejected) expect(result.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  if (rejected) expect(output.length).toBe(0);
  else {
    const saved = readPackage(output), main = nodes(xmlStructure(saved.get("word/document.xml")!)), edges = nodes(xmlStructure(saved.get("word/_rels/document.xml.rels")!)).filter(n => n.name === "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"), refs = main.filter(n => n.name === `{${a}}blip`).map(n => n.attributes[`{${r}}embed`]);
    expect(refs).toHaveLength(2); expect(new Set(refs).size).toBe(2); expect(refs).not.toContain("image"); expect(edges).toHaveLength(3);
    for (const id of ["image", ...refs]) expect(edges.find(n => n.attributes["{}Id"] === id)?.attributes).toEqual({"{}Id": id, "{}Target": "../media/payload.bin", "{}Type": r + "/image"});
    expect(main.filter(n => n.name === `{${wp}}docPr`).map(n => n.attributes["{}id"])).toEqual(["1", "3"]);
    for (const [part, bytes] of parts) if (!["word/document.xml", "word/_rels/document.xml.rels"].includes(part)) expect(saved.get(part), part).toEqual(bytes);
    expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
