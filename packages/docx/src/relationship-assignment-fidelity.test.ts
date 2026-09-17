import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({resultHandle}), quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const form of ["relative", "absolute", "fragment", "empty"] as const)
for (const fromOther of [false, true]) for (const method of ["set", "update"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${method} retains ${form} target fidelity in ${owner}, cross-owner=${fromOther}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p/>', {}, strict));
  const fragment = form === "empty" ? "" : "#coast%20bay";
  const rootTarget = (form === "relative" ? "./word/document.xml" : "/word/document.xml") + fragment;
  const docTarget = (form === "relative" ? "./document.xml" : form === "absolute" ? "/word/document.xml" : "") + fragment;
  const row = (target: string) => `<Relationship Id=" &#x9;audit " Type="urn:original:audit" Target=" ${target} " TargetMode="Internal">海<!--row--><?keep row?></Relationship>`;
  const rootName = "_rels/.rels", docName = "word/_rels/document.xml.rels", name = owner === "root" ? rootName : docName;
  parts.set(rootName, encode(decode(parts.get(rootName)!).replace("</Relationships>", row(rootTarget) + "</Relationships>")));
  parts.set(docName, encode(decode(parts.get(docName)!).replace("</Relationships>", row(docTarget) + "</Relationships>")));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"},
    {operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package"},
    {operation: "model.opc.package.OpcPackage.rels.get", receiver: ref("package"), arguments: {}, resultHandle: owner === "root" ? "rels" : "other"},
    {operation: "model.parts.document.DocumentPart.rels.get", receiver: ref("part"), arguments: {}, resultHandle: owner === "document" ? "rels" : "other"},
    {operation: "model.opc.rel.Relationships.__getitem__.call", receiver: ref(fromOther ? "other" : "rels"), arguments: {rId: "audit"}, resultHandle: "value"},
    {operation: method === "set" ? "model.opc.rel.Relationships.__setitem__.call" : "model.opc.rel.Relationships.update.call", receiver: ref("rels"), arguments: method === "set" ? {rId: "audit", value: ref("value")} : {entries: [["audit", ref("value")]]}}
  ]};
  if (route === "model") {
    const doc = await Document(input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels, other = owner === "root" ? doc.part.rels : doc.part.package.rels, value = (fromOther ? other : rels).at("audit");
    if (method === "set") rels.set("audit", value); else rels.update([["audit", value]]);
    await doc.save(sink);
  } else if (route === "sdk") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
  const expected = fromOther ? (owner === "root" ? "word/document.xml" : "document.xml") + fragment : owner === "root" ? rootTarget : docTarget;
  expect(rels.at("audit").target_ref).toBe(expected); expect(rels.at("audit").target_part).toBe(doc.part);
  if (!fromOther) expect(saved).toEqual(parts);
  else {expect(decode(saved.get(name)!)).toBe(decode(parts.get(name)!).replace(`Target=" ${owner === "root" ? rootTarget : docTarget} "`, `Target="${expected}"`)); for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part), part).toEqual(bytes);}
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
