import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "bom", "utf16le", "utf16be"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const action of ["attribute", "text", "insert", "remove", "empty"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} replaces active ${carrier} XML ${action}; ${encoding} ${kind} strict=${strict}`, async () => {
  const active = '<w:p w:rsidR="11223344"><!--retain--><w:r><w:t>Selected coast</w:t></w:r><?audit keep?></w:p>';
  const original = action === "empty" ? "" : active;
  const changed = action === "attribute" ? active.replace("11223344", "55667788") : action === "text" ? active.replace("Selected coast", "Revised coast") : action === "insert" ? active + paragraph("Added dune") : action === "remove" ? "" : active;
  const ignored = '<w:p w:rsidR="AABBCCDD"><w:r><w:t>Retained alternative</w:t></w:r></w:p>';
  const choose = (body: string, fallback = false) => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? ignored : body}</mc:Choice><mc:Fallback>${fallback ? body : ignored}</mc:Fallback></mc:AlternateContent>`;
  const process = (body: string) => `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass" f:stamp="retain">${body}</f:pass>`;
  const wrap = (body: string) => carrier === "direct" ? body : carrier === "choice" ? choose(body) : carrier === "fallback" ? choose(body, true) : carrier === "process" ? process(body) : choose(process(body));
  const parts = readPackage(await textFixture(wrap(original) + paragraph("Unchanged tail"), {}, strict));
  const source = new TextDecoder().decode(parts.get("word/document.xml")!);
  const replacementText = source.replace(wrap(original) + paragraph("Unchanged tail"), wrap(changed) + paragraph("Unchanged tail"));
  expect(replacementText).not.toBe(source);
  const encodeXml = (value: string) => {
    if (encoding === "utf8") return enc(value);
    if (encoding === "bom") return new Uint8Array([239, 187, 191, ...enc(value)]);
    const bytes = Buffer.from("\ufeff" + value, "utf16le"); if (encoding === "utf16be") bytes.swap16(); return new Uint8Array(bytes);
  };
  parts.set("word/document.xml", encodeXml(source));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), replacement = encodeXml(replacementText);
  if (route === "sdk") {
    const result = await replaceDocumentXmlPart(input, replacement, {part: "/word/document.xml", output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {volume.appendFileSync("/output", bytes);}}});
    expect(result).toMatchObject({changed: true, dryRun: false, changes: [{kind: "replace"}]});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement);
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx xml set /input --part /word/document.xml --file /replacement --output /output --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ok: true, affected: 1, data: {changed: true}});
    volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/replacement")).toEqual(replacement);
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect(saved).toEqual(new Map([...parts].map(([name, bytes]) => [name, name === "word/document.xml" ? replacement : bytes])));
  const model = await Document(output, textContext);
  expect(model.paragraphs.map(item => item.text)).toEqual(action === "remove" ? ["Unchanged tail"] : action === "insert" ? ["Selected coast", "Added dune", "Unchanged tail"] : [action === "text" ? "Revised coast" : "Selected coast", "Unchanged tail"]);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
