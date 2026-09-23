import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { storyPartSourceCases } from "../tests/fixtures/story-part-exact-source.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({ resultHandle }), enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const c of storyPartSourceCases) for (const owner of c.owners) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact story part witness R${c.row}; owner=${owner}; ${kind}; strict=${strict}`, async () => {
  const body = '<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>' + (c.action === "id" ? c.ids : c.action === "inline" ? Array.from({ length: 23 }, (_, i) => String(i + 1)) : []).map(id => `<w:p id="${id}"/>`).join("");
  const f = await nativeStoryFixture(owner, strict, kind, body), parts = readPackage(f.input), word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const prepared = Volume.fromJSON({ "/input": "", "/out": "", "/work/image.png": Buffer.from(rasterPng()), "/foo/bar.png": Buffer.from(rasterPng()) });
  if (c.action === "style" || c.action === "style-id") {
    const doc = await api.Document(f.input, textContext); doc.styles.add_style("BodyText", api.WD_STYLE_TYPE.PARAGRAPH).element.set_attribute({ namespaceURI: word, localName: "styleId" }, "BodyText");
    await doc.save({ async write(bytes) { prepared.appendFileSync("/input", bytes); } });
    parts.clear(); for (const [name, bytes] of readPackage(new Uint8Array(prepared.readFileSync("/input") as Buffer))) parts.set(name, bytes);
    prepared.writeFileSync("/input", "");
  }
  if (c.action === "image" || c.action === "inline") {
    const name = f.main ? "word/_rels/document.xml.rels" : "word/_rels/native.xml.rels", old = parts.get(name), root = old ? new TextDecoder().decode(old).replace("</Relationships>", "") : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    const target = "../audit/retained.bin";
    parts.set("audit/retained.bin", new Uint8Array([0, 255, 10, 7]));
    parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("</Types>", '<Default Extension="bin" ContentType="application/octet-stream"/></Types>')));
    // Reserve concrete relationship IDs without activating or fabricating images.
    parts.set(name, enc(root + Array.from({ length: 41 }, (_, i) => `<Relationship Id="rId${i + 1}" Type="urn:original:reserved" Target="${target}"/>`).join("") + '<!--relationship retained--><?policy keep?></Relationships>'));
  }
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { prepared.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(prepared.readFileSync("/input") as Buffer), context = { ...textContext, binaryResolver: { capability: "command", open(path: string) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(prepared.readFileSync(path) as Buffer); } }; } } };
  const operations: Record<string, unknown>[] = [{ operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" }];
  if (!f.main) operations.push({ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: f.relationships + "/" + f.role }, resultHandle: "story" });
  const receiver = ref(f.main ? "main" : "story"), prefix = `model.parts.${owner}`;
  if (c.action === "id") operations.push({ operation: `${prefix}.next_id.get`, receiver, arguments: {} });
  if (c.action === "style" || c.action === "style-id") {
    operations.push({ operation: `${prefix}.get_style.call`, receiver, arguments: { styleId: "BodyText", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "style" });
    operations.push(c.action === "style" ? { operation: "model.styles.style.BaseStyle.style_id.get", receiver: ref("style"), arguments: {} } : { operation: `${prefix}.get_style_id.call`, receiver, arguments: { styleOrName: ref("style"), styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } } });
  }
  if (c.action === "image" || c.action === "inline") operations.push({ operation: `${prefix}.${c.action === "image" ? "get_or_add_image" : "new_pic_inline"}.call`, receiver, arguments: { imageDescriptor: { kind: "vfs", path: c.action === "image" ? "/work/image.png" : "/foo/bar.png", capability: "command" }, ...(c.action === "inline" ? { width: 100, height: 200 } : {}) }, ...(c.action === "inline" ? { resultHandle: "inline" } : {}) });
  if (c.action === "inline") operations.push({ operation: "model.XmlElementView.serialize.call", receiver: ref("inline"), arguments: {} });
  if (c.action === "document-owner") operations.push({ operation: `${prefix}.package.get`, receiver, arguments: {}, resultHandle: "package" }, { operation: "model.opc.package.OpcPackage.main_document_part.get", receiver: ref("package"), arguments: {}, resultHandle: "mainOwner" }, { operation: "model.parts.document.DocumentPart.partname.get", receiver: ref("mainOwner"), arguments: {} });
  const sink = { async write(bytes: Uint8Array) { prepared.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), story = (f.main ? doc.part : doc.part.part_related_by(f.relationships + "/" + f.role)) as api.StoryPart;
    if (c.action === "id") expect(story.next_id).toBe(c.expected);
    else if (c.action === "style") expect(story.get_style("BodyText", api.WD_STYLE_TYPE.PARAGRAPH).equals(doc.styles.at("BodyText"))).toBe(true);
    else if (c.action === "style-id") expect(story.get_style_id(doc.styles.at("BodyText"), api.WD_STYLE_TYPE.PARAGRAPH)).toBe("BodyText");
    else if (c.action === "image") { const promise = story.get_or_add_image({ path: "/work/image.png", capability: "command" }); expect(promise).toBeInstanceOf(Promise); const [id, image] = await promise; expect(id).toBe("rId42"); expect(image.filename).toBe("image.png"); expect(image.blob).toEqual(rasterPng()); expect(story.rels.at(id).target_part.blob).toEqual(rasterPng()); }
    else if (c.action === "inline") { const inline = await story.new_pic_inline({ path: "/foo/bar.png", capability: "command" }, 100, 200), xml = new TextDecoder().decode(inline.serialize()); expect(xml).toContain('cx="100"'); expect(xml).toContain('cy="200"'); expect(xml).toContain('id="24"'); expect(xml).toContain('name="bar.png"'); expect(xml).toContain('rId42'); }
    else expect(story.package.main_document_part).toBe(doc.part);
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context);
    if (c.action === "id") expect(result.results.at(-1)!.value).toBe(c.expected);
    if (c.action === "style" || c.action === "style-id") expect(result.results.at(-1)!.value).toBe("BodyText");
    if (c.action === "image") expect((result.results.at(-1)!.value as unknown[])[0]).toBe("rId42");
    if (c.action === "document-owner") expect(result.results.at(-1)!.value).toBe("/word/document.xml");
    if (c.action === "inline") { const xml = new TextDecoder().decode(new Uint8Array(Buffer.from((result.results.at(-1)!.value as { base64: string }).base64, "base64"))); expect(xml).toContain('cx="100"'); expect(xml).toContain('cy="200"'); expect(xml).toContain('id="24"'); expect(xml).toContain('name="bar.png"'); expect(xml).toContain('rId42'); }
    await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.mkdir("/foo"); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("Original destination")); await fs.writeFile("/work/image.png", rasterPng()); await fs.writeFile("/foo/bar.png", rasterPng());
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const creating = ["image", "inline", "style", "style-id"].includes(c.action), response = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' ${creating ? "--output /out --force" : ""} --json`);
      expect(response.exitCode, response.stdout + response.stderr).toBe(0); const value = JSON.parse(response.stdout).data.results.at(-1).data;
      if (c.action === "id") expect(value).toBe(c.expected); if (c.action === "style" || c.action === "style-id") expect(value).toBe("BodyText"); if (c.action === "image") expect(value[0]).toBe("rId42");
      if (c.action === "document-owner") expect(value).toBe("/word/document.xml");
      if (c.action === "inline") { const xml = new TextDecoder().decode(new Uint8Array(Buffer.from(value.base64, "base64"))); expect(xml).toContain('cx="100"'); expect(xml).toContain('cy="200"'); expect(xml).toContain('id="24"'); expect(xml).toContain('name="bar.png"'); expect(xml).toContain('rId42'); }
      if (!creating) expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
      prepared.writeFileSync("/out", creating ? await fs.readFile("/out") : input); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(prepared.readFileSync("/out") as Buffer)); assertPackageLinks(saved);
  for (const [name, bytes] of parts) if (!(c.action === "image" || c.action === "inline") || name !== "[Content_Types].xml" && name !== (f.main ? "word/_rels/document.xml.rels" : "word/_rels/native.xml.rels")) expect(saved.get(name), name).toEqual(bytes);
  expect((await api.Document(input, context)).paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(prepared.readFileSync("/input")).toEqual(Buffer.from(input));
});
