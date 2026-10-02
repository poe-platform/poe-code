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
for (const encoding of ["utf8", "bom", "utf16le", "utf16be"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const action of ["leaf", "leading", "tail", "insert", "remove"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} edits native ${action} in ${carrier}; ${encoding} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const extra = '<w:r><w:t>Extra</w:t></w:r>', active = '<w:p><!--retained--><w:r><w:t>Selected coast</w:t></w:r>' + extra + '<?audit keep?></w:p>';
  const ignored = '<w:p><w:r><w:t>Stored alternative</w:t></w:r></w:p>';
  const choose = (body: string, fallback = false) => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? ignored : body}</mc:Choice><mc:Fallback>${fallback ? body : ignored}</mc:Fallback></mc:AlternateContent>`;
  const process = (body: string) => `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${body}</f:pass>`;
  const body = carrier === "direct" ? active : carrier === "choice" ? choose(active) : carrier === "fallback" ? choose(active, true) : carrier === "process" ? process(active) : choose(process(active));
  const parts = readPackage(await textFixture(body + paragraph("Untouched tail"), {}, strict));
  const source = new TextDecoder().decode(parts.get("word/document.xml")!);
  const encodeXml = (value: string) => {
    if (encoding === "utf8") return enc(value);
    if (encoding === "bom") return new Uint8Array([239, 187, 191, ...enc(value)]);
    const bytes = Buffer.from("\ufeff" + value, "utf16le"); if (encoding === "utf16be") bytes.swap16(); return new Uint8Array(bytes);
  };
  parts.set("word/document.xml", encodeXml(source));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {volume.appendFileSync("/output", bytes);}};
  const node = {kind: "element" as const, name: {namespaceURI: w, localName: "r"}, children: [{kind: "element" as const, name: {namespaceURI: w, localName: "t"}, children: [{kind: "text" as const, text: "Added"}]}]};
  const operations = [
    {operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.element.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "element"},
    {operation: "model.XmlElementView.children.get", receiver: ref("element"), arguments: {}, resultHandle: "runs"},
    {operation: "model.XmlElementView.children.get", receiver: ref("runs", 0), arguments: {}, resultHandle: "leaves"},
    action === "leaf" ? {operation: "model.XmlElementView.text.set", receiver: ref("leaves", 0), arguments: {value: "Revised coast"}} : action === "leading" ? {operation: "model.XmlElementView.text.set", receiver: ref("element"), arguments: {value: "\n"}} : action === "tail" ? {operation: "model.XmlElementView.tail.set", receiver: ref("runs", 0), arguments: {value: "\n"}} : action === "insert" ? {operation: "model.XmlElementView.insert.call", receiver: ref("element"), arguments: {index: 1, node}} : {operation: "model.XmlElementView.remove.call", receiver: ref("runs", 1), arguments: {}}
  ];
  if (route === "model") {
    const model = await Document(input, textContext), element = model.paragraphs[0]!.element, first = element.children[0]!, last = element.children[1]!;
    if (action === "leaf") first.children[0]!.text = "Revised coast";
    else if (action === "leading") element.text = "\n";
    else if (action === "tail") first.tail = "\n";
    else if (action === "insert") expect(element.insert(1, node).tag).toEqual({namespaceURI: w, localName: "r"});
    else {last.remove(); expect(() => last.tag).toThrowError(expect.objectContaining({code: "stale-selection"}));}
    expect(first.children[0]!.text).toBe(action === "leaf" ? "Revised coast" : "Selected coast");
    await model.save(sink);
  } else if (route === "sdk") {
    const result = await executeDocumentBatch(input, {version: 1, operations}, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    expect(result.publication?.changed).toBe(true); expect(result.results[4]!.affected).toBe(1);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({version: 1, operations})));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output /output --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ok: true, affected: 1});
    volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  const insertion = `<x0:r xmlns:x0="${w}"><x0:t xmlns:x0="${w}">Added</x0:t></x0:r>`;
  const expected = action === "leaf" ? source.replace("Selected coast", "Revised coast") : action === "leading" ? source.replace("<w:p><!--retained-->", "<w:p>\n<!--retained-->") : action === "tail" ? source.replace("</w:r>" + extra, "</w:r>\n" + extra) : action === "insert" ? source.replace(extra, insertion + extra) : source.replace(extra, "");
  expect(saved).toEqual(new Map([...parts].map(([name, bytes]) => [name, name === "word/document.xml" ? encodeXml(expected) : bytes])));
  expect((await Document(output, textContext)).paragraphs.map(item => item.text)).toEqual([action === "leaf" ? "Revised coastExtra" : action === "insert" ? "Selected coastAddedExtra" : action === "remove" ? "Selected coast" : "Selected coastExtra", "Untouched tail"]);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
