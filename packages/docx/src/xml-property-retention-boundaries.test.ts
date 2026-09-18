import {Volume} from "memfs";
import {expect, it} from "vitest";
import {MemoryFileSystem, Shell} from "virtual-bash";
import {docxCommands} from "virtual-bash/commands/docx";
import {createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive} from "./index.js";
import {textContext, textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16be"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const boundary of ["change", "remove", "reorder", "owner", "namespace", "context"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} retains protected property ${boundary} boundary; ${carrier} ${codec} ${kind} strict=${strict}`, async () => {
  const first = '<f:first f:value="retained"><!--one--><?audit keep?>First</f:first>', second = '<f:second>Second</f:second>';
  const content = '<w:jc w:val="center"/>' + first + second, inactive = '<f:stored>Inactive</f:stored>';
  const fields = carrier === "direct" ? content : carrier === "process" ? `<f:pass mc:ProcessContent="f:pass">${content}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? content : inactive}</mc:Choice><mc:Fallback>${carrier === "choice" ? inactive : content}</mc:Fallback></mc:AlternateContent>`;
  const body = `<w:p><w:pPr>${fields}</w:pPr><w:r><w:t>First owner</w:t></w:r></w:p><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>Second owner</w:t></w:r></w:p>`;
  const parts = readPackage(await textFixture(body, {}, strict));
  const original = new TextDecoder().decode(parts.get("word/document.xml")).replace("<w:document ", '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" xml:lang="en" ');
  const changed = boundary === "change" ? original.replace('f:value="retained"', 'f:value="changed"') : boundary === "remove" ? original.replace(first, "") : boundary === "reorder" ? original.replace(first + second, second + first) : boundary === "owner" ? original.replace(first, "").replace("<w:keepNext/>", "<w:keepNext/>" + first) : boundary === "namespace" ? original.replace('xmlns:f="urn:original:future"', 'xmlns:f="urn:original:other"') : original.replace('xml:lang="en"', 'xml:lang="fr"');
  const encodeXml = (xml: string) => codec === "utf8" ? enc(xml) : new Uint8Array(Buffer.from("\ufeff" + xml, "utf16le").swap16());
  parts.set("word/document.xml", encodeXml(original));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") {
    await expect(replaceDocumentXmlPart(input, encodeXml(changed), {part: "/word/document.xml", output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}})).rejects.toMatchObject({code: "unsupported-edit"});
    expect(memory.readFileSync("/output")).toHaveLength(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", encodeXml(changed)); await fs.writeFile("/output", enc("sentinel"));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx xml set /input --part /word/document.xml --file /replacement --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, affected: 0, data: null, errors: [{code: "unsupported-edit"}]});
    expect(await fs.readFile("/output")).toEqual(enc("sentinel")); expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
