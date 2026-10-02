import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, executeDocumentBatch, createDocxInspectionCommandEngine, inspectDocument, writeArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const cases = [
  ["empty", "", true], ["relative", "../report#coast", true],
  ["absolute fragment", "https://example.invalid/report#coast", true],
  ["fragment only", "#coast", true], ["query only", "?q=coast", true],
  ["relative later colon", "../a:b", true], ["network path", "//example.invalid/coast", true],
  ["empty absolute", "custom:", true], ["IRI", "https://例.example/海", true],
  ["IPv6", "custom://[2001:db8::1]:81/path", true],
  ["IPvFuture", "custom://[vF.example:future]/path", true],
  ["escaped octet", "../%FF", true], ["private query", "?q=\uE000", true],
  ["digit scheme", "1audit:value", false], ["space", "urn:original:audit space", false],
  ["bad escape", "https://example.invalid/%GG", false], ["bad authority", "custom://[invalid]/", false],
  ["bad port", "https://example.invalid:port/", false], ["double fragment", "../report#one#two", false],
  ["private fragment", "#\uE000", false]
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const owner of ["root", "document"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "inactive"] as const)
it.each(cases)(`${route} enforces external relationship Target %s in ${owner}/${carrier}; ${kind} strict=${strict}`, async (_label, target, valid) => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  const name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const escapedTarget = target.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const row = `<Relationship Id="audit" Type="urn:original:audit" Target="${escapedTarget}" TargetMode="External"/>`;
  const wrapper = carrier === "direct" ? row : carrier === "process" ? `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${row}</f:pass>` : `<mc:AlternateContent xmlns:mc="${mc}" xmlns:pr="${pr}" xmlns:f="urn:original:future"><mc:Choice Requires="${carrier === "fallback" ? "f" : "pr"}">${carrier === "choice" ? row : ""}</mc:Choice><mc:Fallback>${carrier === "choice" ? "" : row}</mc:Fallback></mc:AlternateContent>`;
  parts.set(name, enc(new TextDecoder().decode(parts.get(name)!).replace("</Relationships>", wrapper + "</Relationships>")));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), admitted = valid || carrier === "inactive";
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  const operations = [{ operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" }, { operation: "model.text.paragraph.Paragraph.text.set", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: { value: "Revised coast" } }];
  if (route === "model") {
    if (!admitted) await expect(Document(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    else { const doc = await Document(input, textContext); const rels = owner === "root" ? doc.part.package.rels : doc.part.rels; expect(rels.has("audit")).toBe(carrier !== "inactive"); if (carrier !== "inactive") expect(rels.at("audit").target_ref).toBe(target); doc.paragraphs[0]!.text = "Revised coast"; await doc.save(sink); }
  } else if (route === "sdk") {
    if (admitted) { const report = await inspectDocument(input, textContext); expect(report.relationships.find(edge => edge.owner === (owner === "root" ? "/" : "/word/document.xml") && edge.id === "audit")?.target).toBe(carrier === "inactive" ? undefined : target); }
    else await expect(inspectDocument(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    const result = executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    if (admitted) await result; else await expect(result).rejects.toMatchObject({ code: "invalid-package" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const inspected = await shell.exec("docx inspect /input --json"); expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(admitted ? 0 : 1);
    if (!admitted) expect(JSON.parse(inspected.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
    const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(admitted ? 0 : 1);
    if (admitted) volume.writeFileSync("/output", await fs.readFile("/output"));
    else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] }); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); }
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (admitted) {
    const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
    for (const [part, bytes] of parts) if (part !== "word/document.xml") expect(saved.get(part)).toEqual(bytes);
    expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Revised coast");
  } else expect(volume.readFileSync("/output")).toHaveLength(0);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

