import * as docx from "./index.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, XmlPartView, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive, type DocxBatchOperation } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const roles = [
  { owner: "hdrftr.HeaderPart", role: "header", root: "hdr" },
  { owner: "hdrftr.FooterPart", role: "footer", root: "ftr" },
  { owner: "comments.CommentsPart", role: "comments", root: "comments" },
  { owner: "settings.SettingsPart", role: "settings", root: "settings" },
  { owner: "styles.StylesPart", role: "styles", root: "styles" },
  { owner: "story.StoryPart", role: "header", root: "hdr" }
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of roles) for (const action of ["read", "rename", "relationships", "xml"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} executes native ${role.owner} ${action} with retained package ownership; ${kind} strict=${strict}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = input.slice();
  const name = "/audit/native.xml", finalName = action === "rename" ? "/moved/native.xml" : name;
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${role.role}+xml;audit=coast`;
  const blob = enc(`<?xml version="1.0"?><!--native--><w:${role.root} xmlns:w="${word}"><!--retained--></w:${role.root}><?audit keep?>`);
  const prefix = `model.parts.${role.owner}`, ref = (resultHandle: string) => ({ resultHandle });
  const operations: DocxBatchOperation[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "owner" },
    { operation: `${prefix}.load.call`, arguments: { partname: name, contentType: type, blob: { kind: "bytes", base64: Buffer.from(blob).toString("base64") }, ownerPackage: ref("owner") }, resultHandle: "native" },
    { operation: `${prefix}.after_unmarshal.call`, receiver: ref("native"), arguments: {} },
    { operation: `${prefix}.before_marshal.call`, receiver: ref("native"), arguments: {} }
  ] as DocxBatchOperation[];
  if (action === "rename") operations.push({ operation: `${prefix}.partname.set`, receiver: ref("native"), arguments: { value: finalName } } as DocxBatchOperation);
  if (action === "relationships") operations.push(
    { operation: `${prefix}.load_rel.call`, receiver: ref("native"), arguments: { reltype: "urn:original:coast", target: "../inert?coast#view", rId: "retained", isExternal: true } } as DocxBatchOperation,
    { operation: `${prefix}.target_ref.call`, receiver: ref("native"), arguments: { rId: "retained" } } as DocxBatchOperation
  );
  if (action === "xml") operations.push(
    { operation: `${prefix}.element.get`, receiver: ref("native"), arguments: {}, resultHandle: "xml" } as DocxBatchOperation,
    { operation: "model.XmlElementView.set_attribute.call", receiver: ref("xml"), arguments: { name: { namespaceURI: "", localName: "audit" }, value: "retained" } }
  );
  operations.push({ operation: `${prefix}.partname.get`, receiver: ref("native"), arguments: {} } as DocxBatchOperation);
  if (route === "model") {
    const doc = await Document(input, textContext), part = await XmlPartView.load(name, type, blob, doc.part.package);
    expect(part.after_unmarshal()).toBeUndefined(); expect(part.before_marshal()).toBeUndefined();
    if (action === "rename") part.partname = finalName;
    if (action === "relationships") { part.load_rel("urn:original:coast", "../inert?coast#view", "retained", true); expect(part.target_ref("retained")).toBe("../inert?coast#view"); }
    if (action === "xml") part.element.set_attribute({ namespaceURI: "", localName: "audit" }, "retained");
    expect(String(part.partname)).toBe(finalName); expect(part.content_type).toBe(type); expect(part.package).toBe(doc.part.package); await doc.save(sink);
  } else if (route === "sdk") {
    const result = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results.at(-1)!.value).toBe(finalName);
    expect(result.results[3]!.value).toBeNull(); expect(result.results[4]!.value).toBeNull();
    if (action === "relationships") expect(result.results[6]!.value).toBe("../inert?coast#view");
    await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops.json --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(before); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [member, bytes] of parts) if (member !== "[Content_Types].xml") expect(saved.get(member), member).toEqual(bytes);
  const stored = saved.get(finalName.slice(1))!;
  if (action === "xml") {
    const structure = xmlStructure(stored), root = structure.name === `{${word}}${role.root}` ? structure : structure.children.find(node => typeof node !== "string" && node.name === `{${word}}${role.root}`);
    expect(root && typeof root !== "string" ? root.attributes["{}audit"] : undefined).toBe("retained"); expect(new TextDecoder().decode(stored)).toContain("<!--retained-->");
  }
  else expect(stored).toEqual(blob);
  if (action === "relationships") expect(new TextDecoder().decode(saved.get("audit/_rels/native.xml.rels"))).toContain('Target="../inert?coast#view"');
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Original coast");
  expect(input).toEqual(before); expect(memory.readFileSync("/input")).toEqual(Buffer.from(before));
});

for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
it(`${route} accepts document-part handles for inherited StoryPart reads; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict), before = input.slice();
  const operations = [
    { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "main" },
    { operation: "model.parts.story.StoryPart.after_unmarshal.call", receiver: { resultHandle: "main" }, arguments: {} },
    { operation: "model.parts.story.StoryPart.blob.get", receiver: { resultHandle: "main" }, arguments: {} }
  ];
  if (route === "sdk") expect((await applyStyleModelBatch(input, { version: 1, operations }, textContext)).results.at(-1)!.value).toEqual({ kind: "bytes", base64: Buffer.from(readPackage(input).get("word/document.xml")!).toString("base64") });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops.json --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toEqual({ kind: "bytes", base64: Buffer.from(readPackage(input).get("word/document.xml")!).toString("base64") }); expect(await fs.readFile("/input")).toEqual(before); }
    finally { await shell.dispose(); }
  }
  expect(input).toEqual(before);
});

for (const strict of [false, true]) for (const role of roles)
it(`model returns the declared native ${role.owner} class and rejects foreign content roles; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Native ownership</w:t></w:r></w:p>', {}, strict);
  const doc = await Document(input, textContext), owner = doc.part.package;
  const name = role.owner.split(".")[1]!;
  const factory = (docx as unknown as Record<string, typeof XmlPartView>)[name];
  expect(factory, `Public ${name} factory`).toBeTypeOf("function");
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const native = enc(`<w:${role.root} xmlns:w="${word}"/>`);
  const part = await factory!.load("/audit/native.xml", `application/vnd.openxmlformats-officedocument.wordprocessingml.${role.role}+xml;original=coast`, native, owner);
  expect(part).toBeInstanceOf(factory!); expect(part.package).toBe(owner);
  expect(part.element.tag.namespaceURI).toBe(word);
  const before = owner.parts.map(part => [String(part.partname), part.blob]);
  await expect(factory!.load("/audit/foreign.xml", "application/xml", native, owner)).rejects.toThrow();
  await expect(factory!.load("/audit/wrong-root.xml", `application/vnd.openxmlformats-officedocument.wordprocessingml.${role.role}+xml`, enc(`<w:foreign xmlns:w="${word}"/>`), owner)).rejects.toThrow();
  expect(owner.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
});
