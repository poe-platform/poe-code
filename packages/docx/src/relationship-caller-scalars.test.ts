import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({resultHandle}), quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const action of ["add", "reuse internal", "reuse external"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} normalizes caller relationship scalars for ${action} in ${owner}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p/>', {}, strict)), name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const type = "urn:original:scalar", external = action !== "reuse internal", target = external ? "https://example.invalid/coast" : owner === "root" ? "word/document.xml" : "document.xml";
  if (action !== "add") parts.set(name, encode(decode(parts.get(name)!).replace("</Relationships>", `<Relationship Id="audit" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/></Relationships>`)));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), paddedType = ` \t${type}\r\n`, paddedTarget = `\t${target} \r\n`;
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"},
    {operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package"},
    {operation: owner === "root" ? "model.opc.package.OpcPackage.rels.get" : "model.parts.document.DocumentPart.rels.get", receiver: ref(owner === "root" ? "package" : "part"), arguments: {}, resultHandle: "rels"},
    ...(action === "add" ? [{operation: "model.opc.rel.Relationships.add_relationship.call", receiver: ref("rels"), arguments: {rId: " \taudit\r\n", reltype: paddedType, target: paddedTarget, isExternal: true}}] : [0, 1].map(() => ({operation: external ? "model.opc.rel.Relationships.get_or_add_ext_rel.call" : "model.opc.rel.Relationships.get_or_add.call", receiver: ref("rels"), arguments: external ? {reltype: paddedType, targetRef: paddedTarget} : {reltype: paddedType, targetPart: ref("part")}})))
  ]};
  if (route === "model") {
    const doc = await Document(input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
    if (action === "add") expect(rels.add_relationship(paddedType, paddedTarget, " \taudit\r\n", true).rId).toBe("audit");
    else for (let call = 0; call < 2; call++) expect(external ? rels.get_or_add_ext_rel(paddedType, paddedTarget) : rels.get_or_add(paddedType, doc.part).rId).toBe("audit");
    await doc.save(sink);
  } else if (route === "sdk") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
  expect([...rels.keys()]).toEqual(owner === "root" ? ["document", "audit"] : ["audit"]);
  expect(rels.at("audit").reltype).toBe(type); expect(rels.at("audit").target_ref).toBe(target);
  for (const [part, bytes] of parts) if (part !== name || action !== "add") expect(saved.get(part), part).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
