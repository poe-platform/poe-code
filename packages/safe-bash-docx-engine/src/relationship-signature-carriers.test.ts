import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocumentSignatures, stripDocumentSignatures, writeArchive } from "./index.js";
import { signatureFixture, signatureRole } from "../tests/fixtures/signatures.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "process"] as const) for (const padded of [false, true])
for (const retainedBy of ["none", "inactive"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} handles signature removal in ${carrier} relationships with ${retainedBy} shared owner; ${kind} strict=${strict} padded=${padded}`, async () => {
  const parts = readPackage(await signatureFixture()), scalar = (value: string) => padded ? ` &#x9;${value}&#xA; ` : value;
  const row = `<pr:Relationship Id="${scalar("seal")}" Type="${scalar(signatureRole + "origin")}" Target="${scalar("seals/origin.sigs")}" TargetMode="Internal"/>`;
  const content = carrier === "direct" ? row : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="pr">${row}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : `<f:carrier>${row}</f:carrier>`;
  const retained = retainedBy === "inactive" ? '<mc:AlternateContent><mc:Choice Requires="pr"/><mc:Fallback><pr:Relationship Id="stored" Type="urn:original:retain" Target="seals/cert.cer"/></mc:Fallback></mc:AlternateContent>' : '<f:opaque keep="海"/>';
  const main = decode(parts.get("_rels/.rels")!).split('<Relationship Id="seal"')[0]!.split('">').slice(1).join('">');
  const xml = `<pr:Relationships xmlns="${pr}" xmlns:pr="${pr}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">${main}${content}<!--between-->${retained}<?retain xml?></pr:Relationships>`;
  parts.set("_rels/.rels", encode(xml));
  for (const [part, bytes] of parts) if (part.endsWith(".xml") || part.endsWith(".rels")) parts.set(part, encode(decode(bytes).replaceAll("http://schemas.openxmlformats.org/wordprocessingml/2006/main", strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main").replaceAll("http://schemas.openxmlformats.org/officeDocument/2006/relationships", strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships").replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await inspectDocumentSignatures(input, {}, textContext)).relationships).toHaveLength(4);
  const doc = await Document(input, textContext);
  expect(() => doc.paragraphs[0]!.text = "Forbidden").toThrow();
  if (route === "sdk") {
    const result = stripDocumentSignatures(input, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    if (retainedBy === "inactive") await expect(result).rejects.toMatchObject({code: "unsupported-edit"});
    else expect((await result).removedRelationships).toHaveLength(4);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec("docx signatures remove /input --output - > /output");
    expect(result.exitCode, result.stderr).toBe(retainedBy === "inactive" ? 1 : 0);
    if (retainedBy === "inactive") expect(result.stderr).toContain("unsupported-edit");
    memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  if (retainedBy === "inactive") {expect(memory.readFileSync("/output").length).toBe(0); return;}
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect((await inspectDocumentSignatures(output, {}, textContext)).relationships).toEqual([]);
  expect([...saved.keys()].some(name => name.startsWith("seals/"))).toBe(false);
  expect(decode(saved.get("_rels/.rels")!)).toBe(decode(parts.get("_rels/.rels")!).replace(row, ""));
  for (const [part, bytes] of parts) if (!part.startsWith("seals/") && !["_rels/.rels", "[Content_Types].xml"].includes(part)) expect(saved.get(part), part).toEqual(bytes);
});
