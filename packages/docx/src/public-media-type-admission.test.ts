import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, XmlPartView, createDocxInspectionCommandEngine, editDocumentParagraphs, getDocumentXml, inspectDocument, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const attribute = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const invalidTypes = ["", "xml", "/xml", "application/", "application/x extra", "application /xml", "application/xml ", "application/xml;", "application/xml; charset", "application/xml; charset=", "application/xml; =utf-8", "application/xml;charset =utf-8", "application/xml;charset= utf-8", 'application/xml;charset="unterminated', 'application/xml;charset="ok"junk', "application/xml; charset=a/b", "application/(xml)", "application/xml, text/xml", "é/xml", "application/海"];
const validTypes = ["application/xml", "APPLICATION/XML", "application/vnd.audit+xml", "application/xml;charset=utf-8", 'application/xml; charset="UTF-8"', 'Application/Vnd.Audit+Xml \t; label="coast;\\"cape"; empty=""', "text/xml; charset=utf-8", "application/x-audit; mode=original"];

async function fixture(strict: boolean, kind: "docx" | "dotx", compression: "store" | "deflate", declaration: "default" | "override", contentType: string, payload = '<?xml version="1.0" encoding="UTF-8"?><!--before--><audit xmlns="urn:original:audit"> 海 &amp; dunes </audit><?keep after?>') {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pr = "http://schemas.openxmlformats.org/package/2006/relationships", ct = "http://schemas.openxmlformats.org/package/2006/content-types";
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="${ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/reports/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/><${declaration === "default" ? 'Default Extension="audit"' : 'Override PartName="/records/data.audit"'} ContentType="${attribute(contentType)}"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${pr}"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/main.xml"/></Relationships>`,
    "reports/main.xml": `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Original coast</w:t></w:r></w:p></w:body></w:document>`,
    "reports/_rels/main.xml.rels": `<Relationships xmlns="${pr}"><Relationship Id="audit" Type="urn:original:audit" Target="../records/data.audit"/></Relationships>`,
    "records/data.audit": payload
  }).map(([name, value]) => [name, encode(value)]));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
  return {parts, input, memory, sink, fs, shell, context: {...textContext, encoding: {order: "input" as const, compression}, stdout: sink}};
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const declaration of ["default", "override"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const mediaType of ["application/vnd.ms-word.document.macroEnabled.main+xml", "application/vnd.ms-word.template.macroEnabledTemplate.main+xml", "application/vnd.ms-office.vbaProject", "application/vnd.ms-word.vbaData+xml"])
it(`${route} rejects parameterized macro declaration ${mediaType} in ${declaration}; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, "store", declaration, mediaType + "; audit=original");
  if (route === "model") await expect(Document(f.input, textContext)).rejects.toMatchObject({code: "unsupported-profile"});
  else if (route === "sdk") await expect(inspectDocument(f.input, textContext)).rejects.toMatchObject({code: "unsupported-profile"});
  else {const result = await f.shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, errors: [expect.objectContaining({code: "unsupported-profile"})]});}
  expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const declaration of ["default", "override"] as const) for (const route of ["model", "sdk", "shell"] as const)
for (const [suffix, payload] of [
  ["core-properties+xml", '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>'],
  ["digital-signature-certificate", "original certificate bytes"],
  ["digital-signature-origin", ""],
  ["digital-signature-xmlsignature+xml", '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>']
] as const) for (const parameter of [false, true])
it(`${route} ${parameter ? "rejects parameters on" : "admits inert"} OPC ${suffix} in ${declaration}; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, "store", declaration, "application/vnd.openxmlformats-package." + suffix + (parameter ? "; audit=original" : ""), payload);
  if (route === "model") {if (parameter) await expect(Document(f.input, textContext)).rejects.toMatchObject({code: "invalid-package"}); else expect((await Document(f.input, textContext)).paragraphs[0]!.text).toBe("Original coast");}
  else if (route === "sdk") {if (parameter) await expect(inspectDocument(f.input, textContext)).rejects.toMatchObject({code: "invalid-package"}); else expect((await inspectDocument(f.input, textContext)).kind).toBe(kind);}
  else {const result = await f.shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(parameter ? 1 : 0); expect(JSON.parse(result.stdout)).toMatchObject(parameter ? {ok: false, data: null, errors: [expect.objectContaining({code: "invalid-package"})]} : {ok: true, data: {kind}});}
  expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const declaration of ["default", "override"] as const) for (const route of ["model", "sdk", "shell"] as const)
for (const parameterized of [true, false])
for (const [payload, code] of [
  ["<audit>", "invalid-xml"],
  ['<!DOCTYPE audit [<!ENTITY hidden "value">]><audit>&hidden;</audit>', "invalid-xml"],
  ['<audit xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:unknown="urn:original:unknown" mc:MustUnderstand="unknown"/>', "unsupported-profile"],
  ['<audit xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:unknown="urn:original:unknown"><mc:AlternateContent><mc:Choice Requires="unknown"/></mc:AlternateContent></audit>', "unsupported-profile"]
] as const)
it(`${route} rejects ${code} content in ${parameterized ? "parameterized" : "bare"} XML ${declaration}; ${kind} strict=${strict} ${payload.slice(0, 18)}${payload.includes("AlternateContent") ? " unmatched choice" : ""}`, async () => {
  const f = await fixture(strict, kind, "store", declaration, parameterized ? 'application/xml; charset="utf-8"' : "application/xml", payload);
  if (route === "model") await expect(Document(f.input, textContext)).rejects.toMatchObject({code});
  else if (route === "sdk") await expect(inspectDocument(f.input, textContext)).rejects.toMatchObject({code});
  else {const result = await f.shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, errors: [expect.objectContaining({code})]});}
  expect(await f.fs.readFile("/input")).toEqual(f.input);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const compression of ["store", "deflate"] as const) for (const declaration of ["default", "override"] as const)
for (const route of ["model", "sdk", "shell"] as const) {
  for (const contentType of invalidTypes)
  it(`${route} rejects media type ${JSON.stringify(contentType)} in ${declaration}; ${kind} strict=${strict} ${compression}`, async () => {
    const f = await fixture(strict, kind, compression, declaration, contentType);
    if (route === "model") await expect(Document(f.input, textContext)).rejects.toMatchObject({code: "invalid-package"});
    else if (route === "sdk") await expect(inspectDocument(f.input, textContext)).rejects.toMatchObject({code: "invalid-package"});
    else {
      const result = await f.shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, locations: [], errors: [expect.objectContaining({code: "invalid-package"})]});
    }
    expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input)); expect(f.memory.readFileSync("/output", "utf8")).toBe("");
  });

  for (const contentType of validTypes)
  it(`${route} preserves and classifies media type ${JSON.stringify(contentType)} in ${declaration}; ${kind} strict=${strict} ${compression}`, async () => {
    const f = await fixture(strict, kind, compression, declaration, contentType), xml = !contentType.startsWith("application/x-audit");
    const stored = contentType.replaceAll("\t", " ");
    if (route === "model") {
      const doc = await Document(f.input, textContext), part = doc.part.package.parts.find(p => p.partname.toString() === "/records/data.audit")!;
      expect(part.content_type).toBe(stored); expect(part.blob).toEqual(f.parts.get("records/data.audit")); expect(part instanceof XmlPartView).toBe(xml);
      doc.paragraphs[0]!.text = "Changed coast"; await doc.save(f.sink);
    } else if (route === "sdk") {
      const data = await inspectDocument(f.input, textContext); expect(data.parts.find(p => p.name === "/records/data.audit")?.contentType).toBe(stored);
      if (xml) expect(await getDocumentXml(f.input, textContext, {part: "/records/data.audit", raw: true})).toEqual(f.parts.get("records/data.audit"));
      await editDocumentParagraphs(f.input, {operation: "paragraphs.set", options: {paragraph: 1, text: "Changed coast", output: "-"}}, f.context);
    } else {
      const info = await f.shell.exec("docx inspect /input --json"); expect(info.exitCode, info.stderr).toBe(0); expect(JSON.parse(info.stdout).data.parts.find((p: {name: string}) => p.name === "/records/data.audit").contentType).toBe(stored);
      if (xml) {const result = await f.shell.exec("docx xml get /input --part /records/data.audit --raw > /raw"); expect(result.exitCode, result.stderr).toBe(0); expect(await f.fs.readFile("/raw")).toEqual(f.parts.get("records/data.audit"));}
      const result = await f.shell.exec("docx paragraphs set /input --paragraph 1 --text 'Changed coast' --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); f.memory.writeFileSync("/output", await f.fs.readFile("/output"));
    }
    const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    expect([...saved.keys()].sort()).toEqual([...f.parts.keys()].sort()); for (const [name, bytes] of f.parts) if (name !== "reports/main.xml") expect(saved.get(name), name).toEqual(bytes);
    expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(["Changed coast"]);
    expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
  });
}
