import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, executeDocumentBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const prefix = "model.opc.rel.Relationships";
const ref = (resultHandle: string) => ({ resultHandle });
const enc = (text: string) => new TextEncoder().encode(text);
const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["opaque", "inactive", "foreign-control"] as const)
for (const attribute of ["id", "embed", "link"] as const) for (const method of ["clear", "pop", "popitem"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${method} respects owner references ${attribute} in ${carrier}; ${kind} strict=${strict}`, async () => {
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const payload = `<f:payload xmlns:f="urn:original:future" xmlns:r="${carrier === "foreign-control" ? "urn:original:foreign-attributes" : r}" r:${attribute}="outside"/>`;
  const body = `<w:p xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f">${carrier === "inactive" ? `<mc:AlternateContent><mc:Choice Requires="f">${payload}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : payload}<w:r><w:t>Retained coast</w:t></w:r></w:p>`;
  const base = await nativeStoryFixture("document.DocumentPart", strict, kind, body), parts = readPackage(base.input);
  parts.set("word/_rels/document.xml.rels", enc('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="outside" Type="urn:original:inert" Target="file:///private/inert" TargetMode="External"/></Relationships>'));
  const memory = Volume.fromJSON({ "/input": "", "/output": "", "/sentinel": "retained" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.rels.get", receiver: ref("part"), arguments: {}, resultHandle: "rels" },
    { operation: `${prefix}.${method}.call`, receiver: ref("rels"), arguments: method === "pop" ? { rId: "outside" } : {} }
  ] };
  if (route === "model") {
    const doc = await Document(input, context), rels = doc.part.rels, held = rels.at("outside"), before = rels.xml;
    const edit = () => method === "clear" ? rels.clear() : method === "pop" ? rels.pop("outside") : rels.popitem();
    if (carrier === "foreign-control") { edit(); expect(rels.length).toBe(0); expect(() => held.rId).toThrowError(expect.objectContaining({ code: "stale-selection" })); }
    else { expect(edit).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); expect(rels.xml).toBe(before); expect(rels.at("outside")).toBe(held); expect(held.target_ref).toBe("file:///private/inert"); }
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const action = executeDocumentBatch(input, batch, { output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    if (carrier === "foreign-control") { const result = await action; expect(result.publication).not.toBeNull(); }
    else { await expect(action).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.readFileSync("/output", "utf8")).toBe(""); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch))); await fs.writeFile("/output", enc("retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      if (carrier === "foreign-control") { expect(response.exitCode, response.stdout + response.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); }
      else { expect(response.exitCode, response.stdout + response.stderr).toBe(1); expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(enc("retained")); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (route === "model" || carrier === "foreign-control") {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    for (const [name, bytes] of parts) if (carrier !== "foreign-control" || name !== "word/_rels/document.xml.rels") expect(saved.get(name), name).toEqual(bytes);
    const reopened = await Document(output, context); expect(reopened.part.rels.has("outside")).toBe(carrier !== "foreign-control"); expect(reopened.paragraphs[0]!.text).toBe("Retained coast");
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); expect(memory.readFileSync("/sentinel", "utf8")).toBe("retained");
});
