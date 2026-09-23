import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "bom", "utf16le", "utf16be"] as const)
for (const route of ["sdk", "shell"] as const)
for (const boundary of ["inactive", "opaque", "ignored", "extension", "paired", "namespace", "control", "carrier-attribute", "wrapper-comment", "foreign-attribute", "inherited-language", "inherited-space", "inherited-base"] as const)
it(`${route} preserves ${boundary} boundary during raw MCE XML replacement; ${encoding} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const word = '<w:p xmlns:f="urn:original:future" f:stamp="retained"><w:r><w:t>Original coast</w:t></w:r></w:p>';
  const choice = `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" f:stamp="retained"><!--carrier--><mc:Choice Requires="w">${word}</mc:Choice><mc:Fallback>${paragraph("Inactive coast")}</mc:Fallback></mc:AlternateContent>`;
  const body = boundary === "opaque" || boundary === "ignored" ? `<f:holder xmlns:f="urn:original:future" xmlns:mc="${mc}"${boundary === "ignored" ? ' mc:Ignorable="f"' : ""}>${choice}</f:holder>` : boundary === "extension" ? `<a:ext xmlns:a="${a}" uri="urn:original:opaque">${choice}</a:ext>` : boundary === "paired" ? `<a:blip xmlns:a="${a}" cstate="print"><a:extLst><a:ext uri="urn:original:opaque"/></a:extLst></a:blip>` : choice;
  const parts = readPackage(await textFixture(body + paragraph("Safe tail"), {}, strict));
  const original = new TextDecoder().decode(parts.get("word/document.xml")!).replace("<w:document ", '<w:document xml:lang="en" xml:space="preserve" xml:base="urn:original:base" ');
  const replacementText = boundary === "inherited-language" ? original.replace('xml:lang="en"', 'xml:lang="fr"') : boundary === "inherited-space" ? original.replace('xml:space="preserve"', 'xml:space="default"') : boundary === "inherited-base" ? original.replace('xml:base="urn:original:base"', 'xml:base="urn:original:changed"') : boundary === "inactive" ? original.replace("Inactive coast", "Changed coast") : boundary === "paired" ? original.replace('cstate="print"', 'cstate="screen"') : boundary === "namespace" ? original.replace('xmlns:f="urn:original:future"', 'xmlns:f="urn:original:other"') : boundary === "control" ? original.replace('Requires="w"', 'Requires="f"') : boundary === "carrier-attribute" ? original.replace('f:stamp="retained"', 'f:stamp="changed"') : boundary === "wrapper-comment" ? original.replace("<!--carrier-->", "<!--changed-->") : boundary === "foreign-attribute" ? original.replace('<w:p xmlns:f="urn:original:future" f:stamp="retained">', '<w:p xmlns:f="urn:original:future" f:stamp="changed">') : original.replace("Original coast", "Changed coast");
  expect(replacementText).not.toBe(original); expect(original).toContain(w);
  const encodeXml = (value: string) => {
    if (encoding === "utf8") return enc(value);
    if (encoding === "bom") return new Uint8Array([239, 187, 191, ...enc(value)]);
    const bytes = Buffer.from("\ufeff" + value, "utf16le"); if (encoding === "utf16be") bytes.swap16(); return new Uint8Array(bytes);
  };
  parts.set("word/document.xml", encodeXml(original));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/output": "sentinel" });
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  if (route === "sdk") {
    expect(await replaceDocumentXmlPart(input, encodeXml(original), {part: "/word/document.xml", dryRun: true}, {...textContext, encoding: {order: "input", compression: "store"}})).toMatchObject({changed: false, changes: []});
    await expect(replaceDocumentXmlPart(input, encodeXml(replacementText), {part: "/word/document.xml", output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {volume.writeFileSync("/output", bytes);}}})).rejects.toMatchObject({code: "unsupported-edit"});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", encodeXml(original)); await fs.writeFile("/output", enc("sentinel"));
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const noop = await shell.exec("docx xml set /input --part /word/document.xml --file /replacement --dry-run --json");
    expect(noop.exitCode, noop.stdout + noop.stderr).toBe(0); expect(JSON.parse(noop.stdout)).toMatchObject({ok: true, affected: 0, data: {changed: false}});
    await fs.writeFile("/replacement", encodeXml(replacementText));
    const result = await shell.exec("docx xml set /input --part /word/document.xml --file /replacement --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "unsupported-edit"}]});
    expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/output")).toEqual(enc("sentinel"));
  }
  expect(volume.readFileSync("/output")).toEqual(Buffer.from("sentinel")); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
