import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocumentObjects, extractDocumentObjects, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { publication } from "../tests/fixtures/object-publication.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";

const variants = ["embed", "link", "missing-id", "missing-edge", "wrong-type", "multiple", "foreign-graphic", "opaque-host", "choice-drawing", "choice-blip", "process-drawing", "vml", "ambiguous-vml", "inactive-object"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const variant of variants) for (const route of ["sdk", "shell"] as const)
it(`${route} preserves and inventories ${variant} object preview; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main", pic = strict ? "http://purl.oclc.org/ooxml/drawingml/picture" : "http://schemas.openxmlformats.org/drawingml/2006/picture", wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes), choice = (xml: string) => `<mc:AlternateContent><mc:Choice Requires="w">${xml}</mc:Choice><mc:Fallback><f:unselected/></mc:Fallback></mc:AlternateContent>`;
  const blip = `<a:blip${variant === "missing-id" ? "" : ` r:${variant === "link" ? "link" : "embed"}="${variant === "missing-edge" ? "absent" : "preview"}"`}/>`;
  const picture = `<a:graphic><a:graphicData uri="${variant === "foreign-graphic" ? "urn:original:opaque" : pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="9" name="Preview"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>${variant === "choice-blip" ? choice(blip) : blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="19050" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  const inline = `<wp:inline><wp:extent cx="19050" cy="9525"/><wp:docPr id="9" name="Preview"/>${picture}</wp:inline>`, anchor = `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="19050" cy="9525"/><wp:wrapNone/><wp:docPr id="10" name="Second preview"/>${picture}</wp:anchor>`;
  const drawing = `<w:drawing>${inline}${variant === "multiple" ? anchor : ""}</w:drawing>`, shape = '<v:shape id="native-preview"><v:imagedata r:id="preview"/></v:shape>';
  const preview = variant === "vml" || variant === "ambiguous-vml" ? shape + (variant === "ambiguous-vml" ? shape : "") : variant === "choice-drawing" ? choice(drawing) : variant === "process-drawing" ? `<f:carrier>${drawing}</f:carrier>` : variant === "opaque-host" ? `<f:opaque>${drawing}</f:opaque>` : drawing;
  const object = `<w:object>${preview}<w:objectLink r:id="object" w:drawAspect="icon" w:shapeId="native-preview" w:updateMode="always" w:lockedField="1" w:fieldCodes="retained"/></w:object>`;
  const body = `<w:p xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" xmlns:v="urn:schemas-microsoft-com:vml" mc:Ignorable="f" mc:ProcessContent="f:carrier"><w:r>${variant === "inactive-object" ? `<mc:AlternateContent><mc:Choice Requires="w"><w:t>Active</w:t></mc:Choice><mc:Fallback>${object}</mc:Fallback></mc:AlternateContent>` : object}</w:r></w:p>`;
  const payload = Uint8Array.of(208,207,17,224,161,177,26,225,0,255,5), image = rasterPng();
  const parts = readPackage(await chartFixture({strict, definitions: [], body, resources: [
    {name: "objects/content.bin", type: 'application/vnd.openxmlformats-officedocument.oleObject; audit="macroEnabled"', bytes: payload},
    {name: "media/preview.bin", type: 'image/png; audit="oleObject"', bytes: image},
    {name: "unrelated/opaque.bin", type: 'application/octet-stream; audit="oleObject; macroEnabled"', bytes: Uint8Array.of(5,9,23)}
  ], relationships: [{owner: "/word/document.xml", id: "object", type: r + "/oleObject", target: "../objects/content.bin"}, {owner: "/word/document.xml", id: "preview", type: variant === "wrong-type" ? "urn:original:opaque" : r + "/image", target: variant === "link" ? "https://example.invalid/never-fetch" : "../media/preview.bin", external: variant === "link"}]}));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml;audit=native`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (strict && (variant === "vml" || variant === "ambiguous-vml")) {
    await expect(Document(input, chartContext)).rejects.toMatchObject({code: "invalid-package"});
    if (route === "sdk") await expect(inspectDocumentObjects(input, {}, chartContext)).rejects.toMatchObject({code: "invalid-package"});
    else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})).exec("docx objects list /input --json"); expect(result.exitCode).not.toBe(0); expect(result.stderr + result.stdout).toContain("invalid-package"); expect(await fs.readFile("/input")).toEqual(input);}
    return;
  }
  let data;
  if (route === "sdk") {
    data = await inspectDocumentObjects(input, {}, chartContext); const {fs, volume} = publication(input);
    const extraction = await extractDocumentObjects(input, {outputDir: "/out", allowPartialOutput: true}, { ...chartContext, encoding: {order: "input", compression: "store"}, filesystem: fs });
    expect(extraction.entries.map(entry => entry.part)).toEqual(["/objects/content.bin"]); expect(volume.readFileSync(extraction.entries[0]!.path)).toEqual(Buffer.from(payload)); expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.mkdir("/out", {recursive: true}); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
    const listed = await shell.exec("docx objects list /input --json"); expect(listed.exitCode, listed.stderr).toBe(0); data = JSON.parse(listed.stdout).data;
    const extracted = await shell.exec("docx objects extract /input --output-dir /out --allow-partial-output --json"); expect(extracted.exitCode, extracted.stderr).toBe(0); const entries = JSON.parse(extracted.stdout).data.entries; expect(entries.map((entry: {part: string}) => entry.part)).toEqual(["/objects/content.bin"]); expect(await fs.readFile(entries[0].path)).toEqual(payload); expect(await fs.readFile("/input")).toEqual(input);
  }
  const model = await Document(input, chartContext); expect(decode(model.part.blob)).toContain(`xmlns:w="${w}"`); model.add_paragraph("Unrelated appended paragraph");
  const save = model.save({async write(bytes) {memory.appendFileSync("/output", bytes);}});
  if (variant === "missing-edge" || variant === "wrong-type") { await expect(save).rejects.toMatchObject({code: "invalid-package"}); expect(memory.readFileSync("/output").length).toBe(0); }
  else { await save;
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output); await Document(output, chartContext);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort()); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(decode(saved.get("word/document.xml")!)).toContain(body);
  }
  expect(data.items).toHaveLength(1); const item = data.items[0]!; expect(item.details.security.macro).toBe("unknown");
  const statuses = variant === "foreign-graphic" || variant === "opaque-host" ? [] : variant === "ambiguous-vml" ? ["ambiguous"] : variant === "multiple" ? ["internal", "internal"] : [variant === "link" ? "external" : variant === "missing-id" ? "missing-id" : variant === "missing-edge" ? "missing-relationship" : variant === "wrong-type" ? "wrong-relationship-type" : "internal"];
  expect(item.details.previews.map((row: {status: string}) => row.status)).toEqual(statuses);
  expect(item.details.graphParts.map((row: {part: string}) => row.part)).toEqual(statuses.includes("internal") ? ["/media/preview.bin", "/objects/content.bin"] : ["/objects/content.bin"]);
});
