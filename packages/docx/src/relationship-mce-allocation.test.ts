import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, readDocumentArchive, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({resultHandle});
const quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const spaced of [false, true])
for (const route of ["model", "sdk", "shell", "archive-sdk"] as const)
it(`${route} reserves inactive native IDs in ${owner}; ${kind} strict=${strict} spaced=${spaced}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), parts = readPackage(await textFixture('<w:p/>', {}, strict));
  const name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const inactive = `<mc:Fallback><Relationship Id="${spaced ? ' &#x9;rId1&#xA; ' : 'rId1'}" Type="urn:original:inactive" Target="https://example.invalid/inert" TargetMode="External"/></mc:Fallback>`;
  parts.set(name, encode(new TextDecoder().decode(parts.get(name)).replace('<Relationships ', '<Relationships xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:pr="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:f="urn:original:future" mc:Ignorable="f" ').replace('</Relationships>', `<mc:AlternateContent><mc:Choice Requires="pr"/>${inactive}</mc:AlternateContent><f:Relationship Id="rId2"/></Relationships>`)));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "archive-sdk") {const graph = (await readDocumentArchive(input, textContext)).package; expect(graph.allocateRelationshipId(owner === "root" ? "/" : "/word/document.xml")).toBe("rId2"); expect(graph.allocateRelationshipId(owner === "root" ? "/" : "/word/document.xml")).toBe("rId3"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); return;}
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"},
    ...(owner === "root" ? [{operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package"}] : []),
    {operation: owner === "root" ? "model.opc.package.OpcPackage.rels.get" : "model.parts.document.DocumentPart.rels.get", receiver: ref(owner === "root" ? "package" : "part"), arguments: {}, resultHandle: "rels"},
    ...[0, 1].map(() => ({operation: "model.opc.rel.Relationships.get_or_add_ext_rel.call", receiver: ref("rels"), arguments: {reltype: "urn:original:added", targetRef: "https://example.invalid/added"}}))
  ]};
  if (route === "model") {const doc = await Document(input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels; expect(rels.get_or_add_ext_rel("urn:original:added", "https://example.invalid/added")).toBe("rId2"); expect(rels.get_or_add_ext_rel("urn:original:added", "https://example.invalid/added")).toBe("rId2"); await doc.save(sink);}
  else if (route === "sdk") {const result = await applyStyleModelBatch(input, batch, textContext); expect(result.results.slice(-2).map(result => result.value)).toEqual(["rId2", "rId2"]); await result.save(sink);}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})); const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);}
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
  expect(rels.at("rId2").target_ref).toBe("https://example.invalid/added"); expect(rels.has("rId1")).toBe(false);
  for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part), part).toEqual(bytes);
  expect(new TextDecoder().decode(saved.get(name))).toContain(inactive); expect(new TextDecoder().decode(saved.get(name))).toContain('<f:Relationship Id="rId2"/>'); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
