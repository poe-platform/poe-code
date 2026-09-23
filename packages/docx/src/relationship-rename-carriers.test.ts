import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ref = (resultHandle: string) => ({resultHandle}), quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "process"] as const) for (const padded of [false, true])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} renames part through incoming and outgoing ${carrier} relationships; ${kind} strict=${strict} padded=${padded}`, async () => {
  const parts = readPackage(await textFixture('<w:p/>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}"/>`}}, strict));
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const scalar = (value: string) => padded ? ` &#x9;${value}&#xA; ` : value;
  const inactive = '<f:opaque><pr:Relationship Id="stored" Type="urn:original:stored" Target="/unavailable.xml"/></f:opaque>';
  const row = (id: string, type: string, target: string) => `<pr:Relationship Id="${scalar(id)}" Type="${scalar(type)}" Target="${scalar(target)}" TargetMode="Internal">海<!--row--><?keep row?></pr:Relationship>`;
  const wrap = (row: string) => `<pr:Relationships xmlns:pr="${pr}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">${carrier === "direct" ? row : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="pr">${row}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : `<f:carrier>${row}</f:carrier>`}${inactive}</pr:Relationships>`;
  const inbound = wrap(row("styles", r + "/styles", "styles.xml")), outbound = wrap(row("back", "urn:original:back", "document.xml#coast"));
  parts.set("word/_rels/document.xml.rels", encode(inbound)); parts.set("word/_rels/styles.xml.rels", encode(outbound));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.part.get", receiver: ref("styles"), arguments: {}, resultHandle: "part"},
    {operation: "model.opc.part.Part.partname.set", receiver: ref("part"), arguments: {value: "/records/moved.xml"}}
  ]};
  if (route === "model") {const doc = await Document(input, textContext); doc.styles.part.partname = "/records/moved.xml"; await doc.save(sink);}
  else if (route === "sdk") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext);
  expect(doc.styles.part.partname.toString()).toBe("/records/moved.xml"); expect(doc.styles.part.rels.at("back").target_part).toBe(doc.part);
  expect(doc.styles.part.rels.at("back").target_ref).toBe("../word/document.xml#coast");
  expect(saved.get("records/moved.xml")).toEqual(parts.get("word/styles.xml")); expect(saved.has("word/styles.xml")).toBe(false); expect(saved.has("word/_rels/styles.xml.rels")).toBe(false);
  expect(decode(saved.get("word/_rels/document.xml.rels")!)).toBe(inbound.replace(`Target="${scalar("styles.xml")}"`, 'Target="../records/moved.xml"'));
  expect(decode(saved.get("records/_rels/moved.xml.rels")!)).toBe(outbound.replace(`Target="${scalar("document.xml#coast")}"`, 'Target="../word/document.xml#coast"'));
  for (const [name, bytes] of parts) if (!["word/styles.xml", "word/_rels/styles.xml.rels", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
