import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const cases = [["empty", "", true], ["fragment", "#海", true], ["private query", "?q=\uE000", true],
  ["bad escape", "https://example.invalid/%GG", false], ["bad host", "https://[invalid]/", false]] as const;
const enc = (value: string) => new TextEncoder().encode(value);
const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const ref = (resultHandle: string) => ({ resultHandle });
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
function encodeXml(value: string, codec: string): Uint8Array {
  if (codec === "utf8") return enc(value);
  if (codec === "bom") return new Uint8Array([239, 187, 191, ...enc(value)]);
  const bytes = Buffer.from("\ufeff" + value, "utf16le");
  if (codec === "utf16be") bytes.swap16();
  return new Uint8Array(bytes);
}
async function fixture(strict: boolean, kind: string, owner: string, codec: string) {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>', {}, strict));
  const name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const row = '<Relationship Id="stored" Type="urn:original:stored" Target="https://example.invalid/retained" TargetMode="External"/>';
  const inactive = `<mc:AlternateContent xmlns:mc="${mc}" xmlns:pr="${pr}"><mc:Choice Requires="pr"/><mc:Fallback><Relationship Id="rId1" Type="urn:original:inert" Target="https://[invalid]/" TargetMode="External"/></mc:Fallback></mc:AlternateContent>`;
  const source = new TextDecoder().decode(parts.get(name)!).replace("</Relationships>", `<!--retain-->${row}${inactive}<?retain coast?></Relationships>`);
  parts.set(name, encodeXml(source, codec));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { parts, name, row, inactive, source, memory, sink, input: new Uint8Array(memory.readFileSync("/input") as Buffer) };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const owner of ["root", "document"]) for (const codec of ["utf8", "utf16be"])
for (const method of ["add", "allocate"]) for (const route of ["model", "sdk", "shell"])
it.each(cases)(`${route} validates external Target %s during ${method} in ${owner}/${codec}; ${kind} strict=${strict}`, async (_label, target, valid) => {
  const { parts, name, inactive, memory, sink, input } = await fixture(strict, kind, owner, codec);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package" },
    { operation: owner === "root" ? "model.opc.package.OpcPackage.rels.get" : "model.parts.document.DocumentPart.rels.get", receiver: ref(owner === "root" ? "package" : "part"), arguments: {}, resultHandle: "rels" },
    { operation: method === "add" ? "model.opc.rel.Relationships.add_relationship.call" : "model.opc.rel.Relationships.get_or_add_ext_rel.call", receiver: ref("rels"), arguments: method === "add" ? { rId: "audit", reltype: "urn:original:audit", target, isExternal: true } : { reltype: "urn:original:audit", targetRef: target } }
  ];
  if (route === "model") {
    const doc = await Document(input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
    const edit = () => method === "add" ? rels.add_relationship("urn:original:audit", target, "audit", true) : rels.get_or_add_ext_rel("urn:original:audit", target);
    if (valid) { edit(); await doc.save(sink); }
    else { expect(edit).toThrowError(expect.objectContaining({ code: "invalid-package" })); expect([...rels.values()].some(edge => edge.reltype === "urn:original:audit")).toBe(false); await doc.save(sink); expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts); memory.writeFileSync("/output", ""); }
  } else if (route === "sdk") {
    const result = executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    if (valid) await result; else await expect(result).rejects.toMatchObject({ code: "invalid-package" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(valid ? 0 : 1);
    if (valid) memory.writeFileSync("/output", await fs.readFile("/output"));
    else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] }); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); }
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (valid) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
    const edge = [...rels.values()].find(row => row.reltype === "urn:original:audit")!;
    expect(edge.target_ref).toBe(target); expect(edge.is_external).toBe(true); expect(edge.rId).toBe(method === "add" ? "audit" : "rId2");
    const xml = new TextDecoder(codec === "utf16be" ? "utf-16be" : "utf-8").decode(saved.get(name)!);
    expect(xml).toContain(inactive); expect(xml).toContain('<!--retain-->'); expect(xml).toContain('<?retain coast?>');
    expect(rels.at("stored").target_ref).toBe("https://example.invalid/retained");
    for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part)).toEqual(bytes);
  } else expect(memory.readFileSync("/output")).toHaveLength(0);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const owner of ["root", "document"]) for (const codec of ["utf8", "bom", "utf16le", "utf16be"])
for (const route of ["sdk", "shell"])
it.each(cases)(`${route} validates raw XML Target %s in ${owner}/${codec}; ${kind} strict=${strict}`, async (_label, target, valid) => {
  const { parts, name, row, source, memory, sink, input } = await fixture(strict, kind, owner, codec);
  const replacement = encodeXml(source.replace(row, row.replace('Target="https://example.invalid/retained"', `Target="${esc(target)}"`)), codec);
  if (route === "sdk") {
    const result = replaceDocumentXmlPart(input, replacement, { part: "/" + name, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    if (valid) await result; else await expect(result).rejects.toMatchObject({ code: "invalid-package" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/output", enc("sentinel"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const result = await shell.exec(`docx xml set /input --part /${name} --file /replacement --output /output --force --json`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(valid ? 0 : 1);
    if (valid) memory.writeFileSync("/output", await fs.readFile("/output"));
    else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] }); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); }
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (valid) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
    expect(rels.at("stored").target_ref).toBe(target);
    for (const [part, bytes] of parts) expect(saved.get(part)).toEqual(part === name ? replacement : bytes);
  } else expect(memory.readFileSync("/output")).toHaveLength(0);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
