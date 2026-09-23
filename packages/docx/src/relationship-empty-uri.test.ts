import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({resultHandle}), quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const scalar of ["type", "external target"] as const)
for (const operation of ["add", "get-or-add"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} validates native empty URI ${scalar} by ${operation} in ${owner}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p/>', {}, strict)), name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), external = scalar === "external target", type = external ? "urn:original:empty-target" : "", id = operation === "add" ? "audit" : "rId1";
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"},
    {operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package"},
    {operation: owner === "root" ? "model.opc.package.OpcPackage.rels.get" : "model.parts.document.DocumentPart.rels.get", receiver: ref(owner === "root" ? "package" : "part"), arguments: {}, resultHandle: "rels"},
    ...(operation === "add" ? [{operation: "model.opc.rel.Relationships.add_relationship.call", receiver: ref("rels"), arguments: {rId: id, reltype: type, target: external ? "" : ref("part"), isExternal: external}}] : [0, 1].map(() => ({operation: external ? "model.opc.rel.Relationships.get_or_add_ext_rel.call" : "model.opc.rel.Relationships.get_or_add.call", receiver: ref("rels"), arguments: external ? {reltype: type, targetRef: ""} : {reltype: type, targetPart: ref("part")}})))
  ]};
  if (scalar === "type") {
    if (route === "model") {
      const doc = await Document(input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
      expect(() => operation === "add" ? rels.add_relationship(type, doc.part, id) : rels.get_or_add(type, doc.part)).toThrowError(expect.objectContaining({ code: "invalid-package" }));
      await doc.save(sink);
      expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);
    } else if (route === "sdk") {
      await expect(applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: "invalid-package" });
      expect(memory.readFileSync("/output")).toHaveLength(0);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", new TextEncoder().encode("sentinel"));
      const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output /output --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
      expect(await fs.readFile("/output")).toEqual(new TextEncoder().encode("sentinel")); expect(await fs.readFile("/input")).toEqual(input);
    }
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
    return;
  }
  if (route === "model") {
    const doc = await Document(input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
    if (operation === "add") expect(rels.add_relationship(type, external ? "" : doc.part, id, external).rId).toBe(id);
    else for (let call = 0; call < 2; call++) expect(external ? rels.get_or_add_ext_rel(type, "") : rels.get_or_add(type, doc.part).rId).toBe(id);
    await doc.save(sink);
  } else if (route === "sdk") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
  expect(rels.at(id).reltype).toBe(type); expect(rels.at(id).is_external).toBe(external); expect(rels.at(id).target_ref).toBe(external ? "" : owner === "root" ? "word/document.xml" : "document.xml");
  if (!external) expect(rels.at(id).target_part).toBe(doc.part);
  expect([...rels.keys()]).toEqual(owner === "root" ? ["document", id] : [id]);
  for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part), part).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
