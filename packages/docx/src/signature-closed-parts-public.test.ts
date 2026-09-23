import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";

const compiled = await compiledPublicRuntime;
const seal = "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/";
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const scenario of ["native", "generic-target", "unknown-root", "external", "lookalike"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`signature resource details have exact declared part metadata; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; scenario=${scenario}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document);
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained coastal report</w:t></w:r></w:p>', {}, strict, { kind }), textContext);
  const target = scenario === "external" ? "https://credential.example.invalid/private-token" : "seals/signature.xml";
  const role = scenario === "lookalike" ? "urn:original:digital-signature/signature" : seal + "signature";
  const member = archive.members.find(member => member.name === "_rels/.rels")!, edges = new api.DocumentXmlEditor(member.bytes);
  edges.insertChildren(edges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="seal" Type="${role}" Target="${target}"${scenario === "external" ? ' TargetMode="External"' : ""}/>`);
  const types = archive.members.find(member => member.name === "[Content_Types].xml")!, declarations = new api.DocumentXmlEditor(types.bytes);
  const contentType = scenario === "generic-target" || scenario === "lookalike" ? "application/xml" : "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml";
  if (scenario !== "external") declarations.insertChildren(declarations.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/seals/signature.xml" ContentType="${contentType}"/>`);
  const memory = Volume.fromJSON({ "/fixture": "", "/output": "", "/forbidden": "" });
  const members = archive.members.map(member => member.name === "_rels/.rels" ? { ...member, bytes: edges.serialize() } : member.name === "[Content_Types].xml" ? { ...member, bytes: declarations.serialize() } : member);
  if (scenario !== "external") members.push({ name: "seals/signature.xml", bytes: new TextEncoder().encode(scenario === "unknown-root" || scenario === "lookalike" ? '<data xmlns="urn:original:inert"/>' : '<s:Signature xmlns:s="http://www.w3.org/2000/09/xmldsig#"/>'), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  await api.writeArchive({ ...archive, members }, { async write(bytes: Uint8Array) { memory.appendFileSync("/fixture", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = await encodeWholeXmlFixture(new Uint8Array(memory.readFileSync("/fixture") as Buffer), codec), original = input.slice(), before = readPackage(input);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  expect((await api.validateDocument(input, context)).valid).toBe(true);
  const batch = { version: 1 as const, operations: [{ operation: "signatures.list" as const, arguments: {} }] };
  let data: unknown;
  if (route === "sdk") data = await api.inspectDocumentSignatures(input, {}, context);
  else if (route === "sdk-batch") { const result = await api.executeDocumentBatch(input, batch, {}, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } }); expect(result.publication).toBeNull(); data = result.results[0]!.data; }
  else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const command = route === "cli" ? "docx signatures list /input" : "docx batch /input --ops-file /operations"; const result = await shell.exec(command + " --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] }); data = route === "cli" ? envelope.data : envelope.data.results[0].data; if (route === "cli-batch") expect(envelope.data.publication).toBeNull(); expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(retained); } finally { await shell.dispose(); }
  }
  const result = data as { items: { name: string; kind: string; location: source.Location; details: unknown }[]; verified: unknown; relationships: unknown[] };
  expect(result.verified).toBeNull(); expect(JSON.stringify(result)).not.toContain("private-token"); expect(memory.statSync("/output").size).toBe(0); expect(input).toEqual(original);
  const listed = scenario !== "external" && scenario !== "lookalike";
  expect(result.items).toHaveLength(listed ? 1 : 0);
  if (listed) {
    const record = result.items[0]!, bytes = before.get("seals/signature.xml")!, sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, "0")).join("");
    expect(record.name).toBe("/seals/signature.xml"); expect(record.kind).toBe("signatures"); expect(record.location.value.part).toBe(record.name);
    expect(record.details).toEqual({ kind: "signatures", parts: [{ name: record.name, contentType, bytes: bytes.length, sha256 }] });
  }
});
