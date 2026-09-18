import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import * as api from "./index.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const profiles = [
  { name: "native", width: undefined, height: undefined, cx: 25400, cy: 38100 },
  { name: "width", width: 127000, height: undefined, cx: 127000, cy: 190500 },
  { name: "height", width: undefined, height: 190500, cx: 127000, cy: 190500 },
  { name: "both", width: 127000, height: 76200, cx: 127000, cy: 76200 },
  { name: "zero", width: 0, height: undefined, cx: null, cy: null },
  { name: "negative", width: -1, height: undefined, cx: null, cy: null }
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"] as const) for (const route of ["model", "sdk", "shell"] as const) for (const profile of profiles)
it(`${route} creates an owned detached picture fragment with ${profile.name} dimensions and retained body; strict=${strict}${owner === "document.DocumentPart" && kind === "docx" ? "" : `; ${owner} kind=${kind}`}`, async () => {
  const fixture = await nativeStoryFixture(owner, strict, kind, '<w:p id="7"><w:r><w:t>Retained coast</w:t></w:r></w:p>');
  const { input } = fixture, before = readPackage(input);
  const ownerRef = { resultHandle: fixture.main ? "main" : "owner" };
  const raster = rasterPng(2, 3), memory = Volume.fromJSON({ "/output": "" });
  let fragment: Uint8Array | undefined;
  const arguments_ = { imageDescriptor: { kind: "bytes", base64: Buffer.from(raster).toString("base64") }, ...(profile.width === undefined ? {} : { width: profile.width }), ...(profile.height === undefined ? {} : { height: profile.height }) };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "main" },
    ...(!fixture.main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: { resultHandle: "main" }, arguments: { reltype: `${fixture.relationships}/${fixture.role}` }, resultHandle: "owner" }] : []),
    { operation: `model.parts.${owner}.new_pic_inline.call`, receiver: ownerRef, arguments: arguments_, resultHandle: "inline" },
    { operation: "model.XmlElementView.serialize.call", receiver: { resultHandle: "inline" }, arguments: {} }
  ];
  const valid = profile.cx !== null;
  if (route === "model") {
    const doc = await api.Document(input, textContext);
    const part = (fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)) as api.DocumentPartView & { new_pic_inline(bytes: Uint8Array, width?: number, height?: number): Promise<api.XmlElementView> };
    expect(part.new_pic_inline).toBeTypeOf("function");
    const pending = part.new_pic_inline(raster, profile.width, profile.height); expect(pending).toBeInstanceOf(Promise);
    if (valid) fragment = (await pending).serialize(); else await expect(pending).rejects.toBeInstanceOf(api.InvalidValueError);
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const pending = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (valid) { const result = await pending; fragment = new Uint8Array(Buffer.from((result.results.at(-1)!.value as { base64: string }).base64, "base64")); await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } }); }
    else { await expect(pending).rejects.toBeInstanceOf(api.InvalidValueError); memory.writeFileSync("/output", input); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); await fs.writeFile("/output", enc("sentinel"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      if (valid) { expect(result.exitCode, result.stdout + result.stderr).toBe(0); fragment = new Uint8Array(Buffer.from(JSON.parse(result.stdout).data.results.at(-1).data.base64, "base64")); memory.writeFileSync("/output", await fs.readFile("/output")); }
      else { expect(result.exitCode).toBe(2); expect(JSON.parse(result.stdout).errors[0].code).toBe("usage"); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); memory.writeFileSync("/output", input); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  if (!valid) { expect(after).toEqual(before); return; }
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && name !== (fixture.main ? "word/_rels/document.xml.rels" : "word/_rels/native.xml.rels")) expect(after.get(name), name).toEqual(bytes);
  const tree = xmlStructure(fragment!), nodes = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
  const all = nodes(tree), base = strict ? "http://purl.oclc.org/ooxml/" : "http://schemas.openxmlformats.org/";
  const wp = base + (strict ? "drawingml/wordprocessingDrawing" : "drawingml/2006/wordprocessingDrawing"), a = base + (strict ? "drawingml/main" : "drawingml/2006/main"), r = base + (strict ? "officeDocument/relationships" : "officeDocument/2006/relationships");
  expect(all.some(node => node.name === `{${wp}}inline`)).toBe(true);
  const extent = all.find(node => node.name === `{${wp}}extent`)!; expect(extent.attributes["{}cx"]).toBe(String(profile.cx)); expect(extent.attributes["{}cy"]).toBe(String(profile.cy));
  expect(all.find(node => node.name === `{${wp}}docPr`)!.attributes["{}id"]).toBe("8");
  const id = all.find(node => node.name === `{${a}}blip`)!.attributes[`{${r}}embed`]!;
  const doc = await api.Document(output, textContext); expect((fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)).rels.at(id).target_part.blob).toEqual(raster); expect(doc.inline_shapes.length).toBe(0); expect(doc.paragraphs[0]!.text).toBe("Retained coast");
});
