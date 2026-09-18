import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";
import { readPackage, assertPackageLinks, assertWordReferences } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const picture of (strict ? [false, true, "inert", "drawing"] as const : [false, true, "drawing"] as const)) for (const route of ["model", "sdk", "shell", "sdk-model-batch", "shell-model-batch"] as const)
it(`${route} removes one list item and retains shared native definitions/resources; ${carrier} picture=${picture} ${kind} strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:audit="retained"/>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : '<f:opaque f:audit="retained"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : '<f:opaque f:audit="retained"/>'}</mc:Fallback></mc:AlternateContent>`;
  const item = (text: string) => `<w:p><w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const activePicture = picture === true || picture === "drawing";
  const drawingBase = strict ? "http://purl.oclc.org/ooxml" : "http://schemas.openxmlformats.org";
  const drawing = `<w:numPicBullet w:numPicBulletId="6"><w:drawing><wp:inline xmlns:wp="${drawingBase}/drawingml/${strict ? "wordprocessingDrawing" : "2006/wordprocessingDrawing"}" xmlns:a="${drawingBase}/drawingml/${strict ? "main" : "2006/main"}" xmlns:pic="${drawingBase}/drawingml/${strict ? "picture" : "2006/picture"}"><wp:extent cx="12700" cy="12700"/><wp:docPr id="1" name="Original bullet"/><a:graphic><a:graphicData uri="${drawingBase}/drawingml/${strict ? "picture" : "2006/picture"}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Original bullet"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="bullet"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:numPicBullet>`;
  const definitions = `<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="0"/><w:numFmt w:val="${activePicture ? "bullet" : "decimal"}"/><w:lvlText w:val="${activePicture ? "" : "%1."}"/>${activePicture ? '<w:lvlPicBulletId w:val="6"/>' : ""}</w:lvl></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="7"/></w:num>${picture === "drawing" ? drawing : picture === "inert" ? '<mc:AlternateContent><mc:Choice Requires="w"/><mc:Fallback><w:numPicBullet w:numPicBulletId="6"><w:pict><v:shape id="OriginalBullet"><v:imagedata r:id="bullet"/></v:shape></w:pict></w:numPicBullet></mc:Fallback></mc:AlternateContent>' : picture ? '<w:numPicBullet w:numPicBulletId="6"><w:pict><v:shape id="OriginalBullet"><v:imagedata r:id="bullet"/></v:shape></w:pict></w:numPicBullet>' : ""}`;
  const parts = readPackage(await textFixture(item("Remove 🌊") + item("Retain é 日本 עברית"), { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}" xmlns:r="${r}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:numbering-removal" mc:Ignorable="f" mc:ProcessContent="f:pass">${wrap(definitions)}<!--definition annotation--><?original retained?></w:numbering>` } }, strict));
  let types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  if (kind === "dotx") { const main = types.root.children.find(n => n.attributes.some(a => a.localName === "PartName" && a.value === "/word/document.xml"))!; types.setAttribute(main, { namespace: "", localName: "ContentType" }, "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"); }
  if (picture) {
    // Fixture construction commits the independent type change before appending.
    types = new api.DocumentXmlEditor(types.serialize());
    types.insertChildren(types.root, '<Override PartName="/media/bullet.png" ContentType="image/png"/>'); parts.set("media/bullet.png", replacementPng(53));
    const rel = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
    parts.set("word/_rels/numbering.xml.rels", new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="bullet" Type="${rel}/image" Target="../media/bullet.png"/></Relationships>`));
  }
  parts.set("[Content_Types].xml", types.serialize());
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.element.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "element" },
    { operation: "model.XmlElementView.remove.call", receiver: { resultHandle: "element" }, arguments: {} }
  ], batch = { version: 1 as const, operations };
  if (strict && picture === true) {
    // Active VML is forbidden in Strict; preserve this original native variant
    // as a required admission rejection, never count it as successful editing.
    if (route === "shell" || route === "shell-model-batch") {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const result = await shell.exec(route === "shell" ? "docx paragraphs remove /input --paragraph 1 --output - > /output" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /output`); expect(result.exitCode).toBe(1); expect(result.stderr).toContain("invalid-package"); expect(await fs.readFile("/input")).toEqual(input); expect((await fs.readFile("/output")).length).toBe(0); } finally { await shell.dispose(); }
    } else if (route === "model") await expect(api.Document(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    else if (route === "sdk") await expect(api.removeDocumentContent(input, { operation: "paragraphs.remove", options: { paragraph: 1, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink })).rejects.toMatchObject({ code: "invalid-package" });
    else await expect(api.applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    expect(memory.readFileSync("/output").length).toBe(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); return;
  }
  if (route === "model") { const doc = await api.Document(input, textContext); doc.paragraphs[0]!.element.remove(); await doc.save(sink); }
  else if (route === "sdk") await api.removeDocumentContent(input, { operation: "paragraphs.remove", options: { paragraph: 1, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  else if (route === "sdk-model-batch") { const result = await api.applyStyleModelBatch(input, batch, textContext); await result.save(sink); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(route === "shell" ? "docx paragraphs remove /input --paragraph 1 --output - > /output" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /output`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output); assertPackageLinks(saved); assertWordReferences(saved);
  expect(saved.size).toBe(parts.size); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect(doc.paragraphs.map(p => p.text)).toEqual(["Retain é 日本 עברית"]); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); expect(doc.paragraphs[0]!.runs[0]!.italic).toBe(true);
  const root = api.parseDocumentXml(saved.get("word/document.xml")!).root, retainedIds = (node: api.XmlElement): string[] => [...(node.localName === "numId" ? node.attributes.filter(a => a.namespace === root.namespace && a.localName === "val").map(a => a.value) : []), ...node.children.flatMap(retainedIds)]; expect(retainedIds(root)).toEqual(["4"]);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
