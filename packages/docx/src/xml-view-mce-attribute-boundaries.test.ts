import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch } from "./index.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
for (const carrier of ["inactive", "opaque", "ignored", "extension", "active"] as const)
for (const attribute of ["native", "foreign", "xmlns", "mce"] as const)
it(`${route} retains the ${carrier}/${attribute} XML attribute authority boundary; strict=${strict}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const active = '<w:p w:rsidR="11223344"><w:r><w:t>Stored coast</w:t></w:r></w:p>';
  const body = carrier === "inactive" || carrier === "active" ? `<mc:AlternateContent xmlns:mc="${mc}"><mc:Choice Requires="w">${active}</mc:Choice><mc:Fallback>${active}</mc:Fallback></mc:AlternateContent>`
    : carrier === "extension" ? `<a:ext xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" uri="urn:inert">${active}</a:ext>`
    : `<f:opaque xmlns:f="urn:original:opaque"${carrier === "ignored" ? ` xmlns:mc="${mc}" mc:Ignorable="f"` : ""}>${active}</f:opaque>`;
  const input = await textFixture(body + paragraph("Safe tail"), {}, strict), model = await Document(input, textContext);
  const path = carrier === "inactive" || carrier === "active" ? [0, 0, carrier === "inactive" ? 1 : 0, 0] : [0, 0, 0];
  let target = model.element;
  const operations: {operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string}[] = [{operation: "model.document.Document.element.get", receiver: ref("document"), arguments: {}, resultHandle: "root"}];
  let receiver = ref("root");
  for (const [depth, index] of path.entries()) {
    target = target.children[index]!;
    operations.push({operation: "model.XmlElementView.children.get", receiver, arguments: {}, resultHandle: `children${depth}`}); receiver = ref(`children${depth}`, index);
  }
  expect(target.tag).toEqual({namespaceURI: word, localName: "p"});
  const name = attribute === "native" ? {namespaceURI: word, localName: "rsidR"} : attribute === "foreign" ? {namespaceURI: "urn:original:opaque", localName: "marker"} : attribute === "xmlns" ? {namespaceURI: "http://www.w3.org/2000/xmlns/", localName: "w"} : {namespaceURI: mc, localName: "Ignorable"};
  const allowedNoop = carrier === "active" && attribute === "native";
  operations.push({operation: "model.XmlElementView.set_attribute.call", receiver, arguments: {name, value: "11223344"}});
  const memory = Volume.fromJSON({"/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  if (route === "model") {
    if (allowedNoop) target.set_attribute(name, "11223344"); else expect(() => target.set_attribute(name, "11223344")).toThrow();
    await model.save(sink);
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  } else if (route === "sdk") {
    const pending = executeDocumentBatch(input, {version: 1, operations}, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    if (allowedNoop) { const result = await pending; expect(result.publication).toMatchObject({changed: false, changes: []}); expect(result.results.every(item => item.affected === 0)).toBe(true); }
    else { await expect(pending).rejects.toMatchObject({code: "unsupported-edit"}); expect(memory.readFileSync("/output")).toEqual(Buffer.alloc(0)); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({version: 1, operations})));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(allowedNoop ? 0 : 1);
    const envelope = JSON.parse(result.stdout); expect(envelope.affected).toBe(0);
    if (allowedNoop) { expect(envelope.data.publication).toMatchObject({changed: false, changes: []}); expect(readPackage(await fs.readFile("/output"))).toEqual(readPackage(input)); }
    else { expect(envelope).toMatchObject({ok: false, data: null, errors: [{code: "unsupported-edit"}]}); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); }
    expect(await fs.readFile("/input")).toEqual(input);
  }
});
