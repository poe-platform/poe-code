import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const)
for (const boundary of ["inactive", "opaque", "ignored", "extension", "paired", "control"] as const)
for (const action of ["text", "tail", "insert", "remove"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects ${action} in ${boundary} XML content; ${encoding} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const native = '<w:p><w:r><w:t>Retained coast</w:t></w:r><w:r><w:t>Retained dunes</w:t></w:r></w:p>';
  const choice = `<mc:AlternateContent xmlns:mc="${mc}"><mc:Choice Requires="w">${native}</mc:Choice><mc:Fallback>${native}</mc:Fallback></mc:AlternateContent>`;
  const body = boundary === "inactive" || boundary === "control" ? choice : boundary === "extension" ? `<a:ext xmlns:a="${a}" uri="urn:original:opaque">${native}</a:ext>` : boundary === "paired" ? `<a:blip xmlns:a="${a}">${native}<a:extLst><a:ext uri="urn:original:opaque"/></a:extLst></a:blip>` : `<f:holder xmlns:f="urn:original:future" xmlns:mc="${mc}"${boundary === "ignored" ? ' mc:Ignorable="f"' : ""}>${native}</f:holder>`;
  const path = boundary === "inactive" ? [0, 0, 1, 0] : boundary === "control" ? [0, 0] : [0, 0, 0];
  const parts = readPackage(await textFixture(body + paragraph("Safe tail"), {}, strict));
  if (encoding === "utf16be") {const bytes = Buffer.from("\ufeff" + new TextDecoder().decode(parts.get("word/document.xml")!), "utf16le"); bytes.swap16(); parts.set("word/document.xml", new Uint8Array(bytes));}
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), model = await Document(input, textContext);
  let target = model.element, receiver = ref("root");
  const operations: {operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string}[] = [{operation: "model.document.Document.element.get", receiver: ref("document"), arguments: {}, resultHandle: "root"}];
  for (const [depth, index] of path.entries()) {target = target.children[index]!; operations.push({operation: "model.XmlElementView.children.get", receiver, arguments: {}, resultHandle: `children${depth}`}); receiver = ref(`children${depth}`, index);}
  const node = {kind: "element" as const, name: {namespaceURI: w, localName: "r"}};
  if (action === "tail" || action === "remove") {
    operations.push({operation: "model.XmlElementView.children.get", receiver, arguments: {}, resultHandle: "targetChildren"}); receiver = ref("targetChildren", 0);
  }
  operations.push(action === "insert" ? {operation: "model.XmlElementView.insert.call", receiver, arguments: {index: 0, node}} : action === "remove" ? {operation: "model.XmlElementView.remove.call", receiver, arguments: {}} : {operation: action === "text" ? "model.XmlElementView.text.set" : "model.XmlElementView.tail.set", receiver, arguments: {value: "\n"}});
  const sink = {async write(bytes: Uint8Array) {volume.appendFileSync("/output", bytes);}};
  if (route === "model") {
    expect(() => {if (action === "text") target.text = "\n"; else if (action === "tail") target.children[0]!.tail = "\n"; else if (action === "insert") target.insert(0, node); else target.children[0]!.remove();}).toThrowError(expect.objectContaining({code: "unsupported-edit"}));
    await model.save(sink); expect(readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer))).toEqual(parts);
  } else if (route === "sdk") {
    await expect(executeDocumentBatch(input, {version: 1, operations}, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink})).rejects.toMatchObject({code: "unsupported-edit"}); expect(volume.readFileSync("/output")).toHaveLength(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({version: 1, operations}))); await fs.writeFile("/output", enc("sentinel"));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "unsupported-edit"}]});
    expect(await fs.readFile("/output")).toEqual(enc("sentinel")); expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
