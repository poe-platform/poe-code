import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006", pr = "http://schemas.openxmlformats.org/package/2006/relationships";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "bom", "utf16le", "utf16be"] as const)
for (const owner of ["root", "document", "generic"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} replaces active relationship attribute in ${owner}/${carrier}; ${encoding} ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture(paragraph("Original coast"), {}, strict));
  const name = owner === "root" ? "_rels/.rels" : owner === "document" ? "word/_rels/document.xml.rels" : "audit/data.xml";
  const row = '<Relationship Id="audit" Type="urn:original:audit" Target="https://original.invalid/" TargetMode="External"/>', ignored = '<Relationship Id="stored" Type="not-absolute" Target="inert"/>';
  const choose = (body: string, fallback = false) => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:pr="${pr}" xmlns:f="urn:original:future"><mc:Choice Requires="${fallback ? "f" : "pr"}">${fallback ? ignored : body}</mc:Choice><mc:Fallback>${fallback ? body : ignored}</mc:Fallback></mc:AlternateContent>`;
  const process = (body: string) => `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${body}</f:pass>`;
  const wrapped = carrier === "direct" ? row : carrier === "choice" ? choose(row) : carrier === "fallback" ? choose(row, true) : carrier === "process" ? process(row) : choose(process(row));
  if (owner === "generic") {
    parts.set(name, enc(`<Relationships xmlns="${pr}">${wrapped}</Relationships>`));
    parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("</Types>", '<Override PartName="/audit/data.xml" ContentType="application/xml"/></Types>')));
  } else parts.set(name, enc(new TextDecoder().decode(parts.get(name)!).replace("</Relationships>", wrapped + "</Relationships>")));
  const source = new TextDecoder().decode(parts.get(name)!);
  const encodeXml = (value: string) => {
    if (encoding === "utf8") return enc(value);
    if (encoding === "bom") return new Uint8Array([239, 187, 191, ...enc(value)]);
    const bytes = Buffer.from("\ufeff" + value, "utf16le"); if (encoding === "utf16be") bytes.swap16(); return new Uint8Array(bytes);
  };
  parts.set(name, encodeXml(source));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), replacement = encodeXml(source.replace("https://original.invalid/", "https://revised.invalid/"));
  if (route === "sdk") {
    expect(await replaceDocumentXmlPart(input, replacement, {part: "/" + name, output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {volume.appendFileSync("/output", bytes);}}})).toMatchObject({changed: true});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement);
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx xml set /input --part /${name} --file /replacement --output /output --json`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ok: true, affected: 1});
    volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer);
  expect(readPackage(output)).toEqual(new Map([...parts].map(([part, bytes]) => [part, part === name ? replacement : bytes])));
  const model = await Document(output, textContext); expect(model.paragraphs[0]!.text).toBe("Original coast");
  if (owner !== "generic") expect((owner === "root" ? model.part.package.rels : model.part.rels).at("audit").target_ref).toBe("https://revised.invalid/");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
