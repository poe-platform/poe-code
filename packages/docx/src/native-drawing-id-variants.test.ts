import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"])
for (const route of ["model", "sdk", "shell"])
for (const previous of [4294967294, 4294967295]) for (const carrier of ["direct", "inactive"])
it(`${route} bounds native ${owner} detached drawing ID after ${previous} in ${carrier}; ${kind} strict=${strict}`, async () => {
  const body = carrier === "direct" ? `<w:p id="${previous}"/>` : `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:ledger:future"><mc:Choice Requires="f"><w:p id="${previous}"/></mc:Choice><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent>`;
  const fixture = await nativeStoryFixture(owner, strict, kind, body), before = readPackage(fixture.input), memory = Volume.fromJSON({ "/input": "", "/output": "" });
  if (!fixture.main) before.set("word/document.xml", enc(`<w:document xmlns:w="${strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}"><w:body><w:p id="12"/></w:body></w:document>`));
  await api.writeArchive({ comment: new Uint8Array(), members: [...before].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), raster = rasterPng(2, 3), valid = previous === 4294967294;
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    ...(!fixture.main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${fixture.relationships}/${fixture.role}` }, resultHandle: "owner" }] : []),
    { operation: `model.parts.${owner}.new_pic_inline.call`, receiver: ref(fixture.main ? "main" : "owner"), arguments: { imageDescriptor: { kind: "bytes", base64: Buffer.from(raster).toString("base64") } }, resultHandle: "inline" },
    { operation: "model.XmlElementView.serialize.call", receiver: ref("inline"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  let fragment: Uint8Array | undefined;
  if (route === "model") {
    const doc = await api.Document(input, context), part = (fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)) as api.StoryPart;
    const pending = part.new_pic_inline(raster);
    if (valid) fragment = (await pending).serialize(); else { await expect(pending).rejects.toBeInstanceOf(api.ResourceLimitError); await expect(pending).rejects.toMatchObject({ code: "limit-exceeded" }); }
    await doc.save(sink);
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    if (valid) { const result = await pending; fragment = new Uint8Array(Buffer.from((result.results.at(-1)!.data as { base64: string }).base64, "base64")); }
    else { await expect(pending).rejects.toBeInstanceOf(api.ResourceLimitError); await expect(pending).rejects.toMatchObject({ code: "limit-exceeded", operationIndex: operations.length - 2 }); expect(memory.readFileSync("/output").length).toBe(0); memory.writeFileSync("/output", input); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("Retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json"), envelope = JSON.parse(result.stdout); expect(result.exitCode, result.stdout + result.stderr).toBe(valid ? 0 : 4);
      if (valid) { fragment = new Uint8Array(Buffer.from(envelope.data.results.at(-1).data.base64, "base64")); memory.writeFileSync("/output", await fs.readFile("/output")); }
      else { expect(envelope).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "limit-exceeded", operationIndex: operations.length - 2 }] }); expect(await fs.readFile("/output")).toEqual(enc("Retained destination")); memory.writeFileSync("/output", input); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  if (!valid) { expect(after).toEqual(before); return; }
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && name !== (fixture.main ? "word/_rels/document.xml.rels" : "word/_rels/native.xml.rels")) expect(after.get(name), name).toEqual(bytes);
  const tree = xmlStructure(fragment!), walk = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : walk(child))], all = walk(tree);
  const wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  expect(all.filter(node => node.name === `{${wp}}inline`)).toHaveLength(1); expect(all.find(node => node.name === `{${wp}}docPr`)!.attributes["{}id"]).toBe("4294967295");
  const id = all.find(node => node.name === `{${a}}blip`)!.attributes[`{${fixture.relationships}}embed`]!, doc = await api.Document(output, context), part = fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`);
  expect(part.rels.at(id).target_part.blob).toEqual(raster); expect(doc.inline_shapes.length).toBe(0);
  if (!fixture.main) expect([...doc.part.rels.values()].some(edge => edge.reltype === `${fixture.relationships}/image`)).toBe(false);
});
