import {Volume} from "memfs";
import {expect, it} from "vitest";
import {MemoryFileSystem, Shell} from "virtual-bash";
import {docxCommands} from "virtual-bash/commands/docx";
import {Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive} from "./index.js";
import {textContext, textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const) for (const carrier of ["direct", "choice", "fallback", "process", "inactive-properties"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} tab getter creates only missing active properties; ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const inactive = '<f:record>Keep alternative</f:record>';
  const alternate = (body: string, fallback = false) => `<mc:AlternateContent ${attrs}><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inactive : body}</mc:Choice><mc:Fallback>${fallback ? body : inactive}</mc:Fallback></mc:AlternateContent>`;
  const p = `<w:p ${attrs}><!--keep before-->${carrier === "inactive-properties" ? '<mc:AlternateContent><mc:Choice Requires="f"><w:pPr><w:keepNext/></w:pPr></mc:Choice><mc:Fallback/></mc:AlternateContent>' : ""}<w:r><w:t>Tab owner</w:t></w:r><?keep after?></w:p>`;
  const body = carrier === "choice" || carrier === "fallback" ? alternate(p, carrier === "fallback") : carrier === "process" ? `<f:pass ${attrs}>${p}</f:pass>` : p;
  const parts = readPackage(await textFixture(body, {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const source = new TextDecoder().decode(parts.get("word/document.xml"));
  const encode = (value: string) => encoding === "utf8" ? enc(value) : new Uint8Array(Buffer.from("\ufeff" + value, "utf16le").swap16());
  parts.set("word/document.xml", encode(source));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), fs = new MemoryFileSystem();
  const batch = {version: 1, operations: [
    {operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "format"},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}}
  ]};
  await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  if (route === "model") {
    const doc = await Document(input, textContext), format = doc.paragraphs[0]!.paragraph_format;
    expect(format.tab_stops.length).toBe(0); expect(format.tab_stops.length).toBe(0);
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await executeDocumentBatch(input, batch, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    expect(result.results.map(item => item.affected)).toEqual([0, 0, 1, 0]);
    expect(result.publication?.changed).toBe(true);
  } else {
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output /output --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data.results.map((item: {affected: number}) => item.affected)).toEqual([0, 0, 1, 0]);
    memory.writeFileSync("/output", await fs.readFile("/output"));
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), actual = readPackage(output), word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const insertion = `<fmt:pPr xmlns:fmt="${word}"/>`;
  const expected = new Map(parts); expected.set("word/document.xml", encode(source.replace("<!--keep before-->", "<!--keep before-->" + insertion)));
  expect(actual).toEqual(expected);
  const reloaded = await Document(output, textContext);
  expect(reloaded.paragraphs[0]!.paragraph_format.tab_stops.length).toBe(0);
  expect(reloaded.paragraphs[0]!.text).toBe("Tab owner");
  expect(await fs.readFile("/input")).toEqual(input);
});
