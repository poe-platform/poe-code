import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, replaceDocumentXmlPart, writeArchive, type XmlElementView } from "./index.js";
import { svgPairFixture, svgContext } from "../tests/fixtures/svg-image.js";
import { readPackage } from "../tests/assertions.js";
import { rasterPng } from "../tests/fixtures/raster.js";

const enc = (value: string) => new TextEncoder().encode(value);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006", svg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";
const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const)
for (const route of ["model", "sdk", "shell", "raw-sdk", "raw-shell"] as const)
it(`${route} rejects an incomplete alternate SVG/raster association edit; ${encoding} ${kind} strict=${strict}`, async () => {
  const a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const parts = readPackage(await svgPairFixture(strict)), source = new TextDecoder().decode(parts.get("word/document.xml")!);
  const start = source.indexOf("<di:blip "), end = source.indexOf("</di:blip>") + "</di:blip>".length; expect(start).toBeGreaterThan(0);
  const carrier = `<mc:AlternateContent xmlns:mc="${mc}" xmlns:s="${svg}"><mc:Choice Requires="s"><s:svgBlip xmlns:nr="http://schemas.openxmlformats.org/officeDocument/2006/relationships" nr:embed="vector"/></mc:Choice><mc:Fallback><di:blip ri:embed="rId1"/></mc:Fallback></mc:AlternateContent>`;
  const xml = source.slice(0, start) + carrier + source.slice(end);
  const encodeXml = (value: string) => {if (encoding === "utf8") return enc(value); const bytes = Buffer.from("\ufeff" + value, "utf16le"); bytes.swap16(); return new Uint8Array(bytes);};
  parts.set("word/document.xml", encodeXml(xml));
  const relName = "word/_rels/document.xml.rels", rels = new TextDecoder().decode(parts.get(relName)!);
  parts.set(relName, enc(rels.replace("</Relationships>", `<Relationship Id="alternateRaster" Type="${r}/image" Target="media/alternate.png"/></Relationships>`)));
  parts.set("word/media/alternate.png", rasterPng(2));
  parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("</Types>", '<Override PartName="/word/media/alternate.png" ContentType="image/png"/></Types>')));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, svgContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), model = await Document(input, svgContext);
  const pending: {view: XmlElementView; path: number[]}[] = [{view: model.element, path: []}];
  let found: {view: XmlElementView; path: number[]} | undefined;
  while (pending.length) {const item = pending.pop()!; if (item.view.namespace === a && item.view.localName === "blip") {found = item; break;} item.view.children.forEach((view, index) => pending.push({view, path: [...item.path, index]}));}
  expect(found).toBeDefined();
  let receiver = ref("root");
  const operations: {operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string}[] = [{operation: "model.document.Document.element.get", receiver: ref("document"), arguments: {}, resultHandle: "root"}];
  for (const [depth, index] of found!.path.entries()) {operations.push({operation: "model.XmlElementView.children.get", receiver, arguments: {}, resultHandle: `children${depth}`}); receiver = ref(`children${depth}`, index);}
  operations.push({operation: "model.XmlElementView.set_attribute.call", receiver, arguments: {name: {namespaceURI: r, localName: "embed"}, value: "alternateRaster"}});
  const sink = {async write(bytes: Uint8Array) {volume.appendFileSync("/output", bytes);}}, replacement = encodeXml(xml.replace('ri:embed="rId1"', 'ri:embed="alternateRaster"'));
  if (route === "model") {
    expect(() => found!.view.set_attribute({namespaceURI: r, localName: "embed"}, "alternateRaster")).toThrowError(expect.objectContaining({code: "unsupported-edit"}));
    await model.save(sink); expect(readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer))).toEqual(parts);
  } else if (route === "sdk" || route === "raw-sdk") {
    await expect(route === "sdk" ? executeDocumentBatch(input, {version: 1, operations}, {output: "-"}, {...svgContext, stdout: sink}) : replaceDocumentXmlPart(input, replacement, {part: "/word/document.xml", output: "-"}, {...svgContext, stdout: sink})).rejects.toMatchObject({code: "unsupported-edit"});
    expect(volume.readFileSync("/output")).toHaveLength(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({version: 1, operations}))); await fs.writeFile("/replacement", replacement); await fs.writeFile("/output", enc("sentinel"));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: svgContext.limits})})).exec(route === "shell" ? "docx batch /input --ops-file /ops --output /output --force --json" : "docx xml set /input --part /word/document.xml --file /replacement --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "unsupported-edit"}]});
    expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/output")).toEqual(enc("sentinel"));
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
