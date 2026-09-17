import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const action of ["add", "set", "remove"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${action} native XML attribute within ${carrier}; ${encoding} ${kind} strict=${strict}`, async () => {
  const active = `<w:p${action === "add" ? "" : ' w:rsidR="11223344"'}><!--retained--><w:r><w:t>Selected coast</w:t></w:r><?audit keep?></w:p>`;
  const ignored = '<w:p w:rsidR="AABBCCDD"><w:r><w:t>Stored alternative</w:t></w:r></w:p>';
  const choose = (body: string, fallback = false) => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? ignored : body}</mc:Choice><mc:Fallback>${fallback ? body : ignored}</mc:Fallback></mc:AlternateContent>`;
  const process = (body: string) => `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${body}</f:pass>`;
  const body = carrier === "direct" ? active : carrier === "choice" ? choose(active) : carrier === "fallback" ? choose(active, true) : carrier === "process" ? process(active) : choose(process(active));
  const parts = readPackage(await textFixture(body + paragraph("Untouched tail"), {}, strict));
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const encodeXml = (source: string) => {
    if (encoding === "UTF-8") return enc(source);
    if (encoding === "UTF-8-BOM") return new Uint8Array([239, 187, 191, ...enc(source)]);
    const buffer = Buffer.from("\ufeff" + source, "utf16le"); if (encoding === "UTF-16BE") buffer.swap16(); return new Uint8Array(buffer);
  };
  const xml = new TextDecoder().decode(parts.get("word/document.xml")!);
  parts.set("word/document.xml", encodeXml(xml));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = action === "remove" ? null : "55667788";
  const model = await Document(input, textContext); expect(model.paragraphs.map(item => item.text)).toEqual(["Selected coast", "Untouched tail"]);
  const operations = [
    {operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.element.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "element"},
    {operation: "model.XmlElementView.set_attribute.call", receiver: ref("element"), arguments: {name: {namespaceURI: word, localName: "rsidR"}, value}}
  ];
  if (route === "model") { model.paragraphs[0]!.element.set_attribute({namespaceURI: word, localName: "rsidR"}, value); await model.save(sink); }
  else if (route === "sdk") {
    const result = await executeDocumentBatch(input, {version: 1, operations}, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    expect(result.publication?.changed).toBe(true); expect(result.results[2]!.affected).toBe(1);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({version: 1, operations})));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name)).toEqual(bytes);
  const expected = action === "add" ? xml.replace("<w:p><!--retained-->", '<w:p w:rsidR="55667788"><!--retained-->') : xml.replace('w:rsidR="11223344"', action === "remove" ? "" : 'w:rsidR="55667788"');
  expect(after.get("word/document.xml")).toEqual(encodeXml(expected));
  const reloaded = await Document(output, textContext); expect(reloaded.paragraphs.map(item => item.text)).toEqual(["Selected coast", "Untouched tail"]);
  expect([...reloaded.paragraphs[0]!.element.attributes].find(([name]) => name.namespaceURI === word && name.localName === "rsidR")?.[1]).toBe(value ?? undefined);
});
