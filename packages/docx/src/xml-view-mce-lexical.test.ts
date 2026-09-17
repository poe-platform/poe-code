import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const invalid of [false, true])
it(`${route} preserves quoted active attribute shells or rejects invalid characters; ${carrier} ${kind} strict=${strict} invalid=${invalid}`, async () => {
  const active = "<w:p audit = 'before'><!--keep--><w:r><w:t>Coast</w:t></w:r><?audit remain?></w:p>";
  const choose = (body: string, fallback = false) => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? paragraph("Inert coast") : body}</mc:Choice><mc:Fallback>${fallback ? body : paragraph("Inert coast")}</mc:Fallback></mc:AlternateContent>`;
  const process = (body: string) => `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${body}</f:pass>`;
  const body = carrier === "direct" ? active : carrier === "choice" ? choose(active) : carrier === "fallback" ? choose(active, true) : carrier === "process" ? process(active) : choose(process(active));
  const parts = readPackage(await textFixture(body, {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const value = invalid ? "invalid\u0000value" : "'\"&<>\r\n\t🌊";
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.element.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "element" },
    { operation: "model.XmlElementView.set_attribute.call", receiver: ref("element"), arguments: { name: { namespaceURI: "", localName: "audit" }, value } }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const model = await Document(input, textContext);
    if (invalid) expect(() => model.paragraphs[0]!.element.set_attribute({ namespaceURI: "", localName: "audit" }, value)).toThrow();
    else model.paragraphs[0]!.element.set_attribute({ namespaceURI: "", localName: "audit" }, value);
    await model.save(sink);
  } else if (route === "sdk") {
    const pending = executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    if (invalid) { await expect(pending).rejects.toMatchObject({ code: "invalid-xml" }); expect(memory.readFileSync("/output")).toHaveLength(0); }
    else await pending;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(invalid ? 1 : 0);
    if (invalid) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-xml" }] }); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); }
    else memory.writeFileSync("/output", await fs.readFile("/output"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (!invalid || route === "model") {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    for (const [name, bytes] of parts) expect(after.get(name)).toEqual(name === "word/document.xml" && !invalid ? enc(new TextDecoder().decode(bytes).replace("audit = 'before'", "audit = '&apos;&quot;&amp;&lt;&gt;&#13;&#10;&#9;🌊'")) : bytes);
    const reopened = await Document(output, textContext);
    expect([...reopened.paragraphs[0]!.element.attributes].find(([name]) => name.localName === "audit")?.[1]).toBe(invalid ? "before" : value);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
