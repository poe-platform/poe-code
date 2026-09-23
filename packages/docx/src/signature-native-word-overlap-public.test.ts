import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textFixture, textContext as fixtureContext } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";
const textContext = { ...fixtureContext, encoding: { order: "input", compression: "store" } as const };


const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const targetKind of ["main", "orphan-settings"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`signature declarations inventory native Word targets but cannot strip document owners; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; targetKind=${targetKind}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document); expect(compiled.DocumentBudget).not.toBe(source.DocumentBudget);
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained coastal report</w:t></w:r></w:p>', {}, strict, { kind }), textContext);
  const target = targetKind === "main" ? "word/document.xml" : "word/orphan-settings.xml";
  const signatureType = "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature";
  const relationshipMember = archive.members.find(member => member.name === "_rels/.rels")!, edges = new api.DocumentXmlEditor(relationshipMember.bytes);
  edges.insertChildren(edges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="seal" Type="${signatureType}" Target="${target}"/>`);
  const typeMember = archive.members.find(member => member.name === "[Content_Types].xml")!, declarations = new api.DocumentXmlEditor(typeMember.bytes);
  const contentType = targetKind === "main" ? `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml` : "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml";
  if (targetKind === "orphan-settings") declarations.insertChildren(declarations.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${target}" ContentType="${contentType}"/>`);
  const members = archive.members.map(member => member.name === "_rels/.rels" ? { ...member, bytes: edges.serialize() } : member.name === "[Content_Types].xml" ? { ...member, bytes: declarations.serialize() } : member);
  if (targetKind === "orphan-settings") members.push({ name: target, bytes: new TextEncoder().encode(`<w:settings xmlns:w="${strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}"><w:updateFields w:val="0"/><!--retain--><?audit exact?></w:settings>`), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = await encodeWholeXmlFixture(new Uint8Array(memory.readFileSync("/input") as Buffer), codec), original = input.slice(), before = readPackage(input);
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const io = { ...textContext, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const model = await api.Document(input, textContext);
  expect(model.part.package.parts.find(part => String(part.partname) === "/" + target)!.blob).toEqual(before.get(target));
  expect(() => { model.paragraphs[0]!.text = "Must not publish"; }).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  expect(model.paragraphs[0]!.text).toBe("Retained coastal report");
  await expect(model.save(io.stdout)).rejects.toMatchObject({ code: "unsupported-edit" });
  const listBatch = { version: 1 as const, operations: [{ operation: "signatures.list" as const, arguments: {} }] };
  const stripBatch = { version: 1 as const, operations: [{ operation: "signatures.remove" as const, arguments: {} }] };
  let data: unknown;
  if (route === "sdk") {
    await expect(api.stripDocumentSignatures(input, { output: "-" }, io)).rejects.toMatchObject({ code: "unsupported-edit" });
    data = await api.inspectDocumentSignatures(input, {}, io);
  } else if (route === "sdk-batch") {
    await expect(api.executeDocumentBatch(input, stripBatch, { output: "-" }, io)).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: 0, operationId: "step1" });
    const result = await api.executeDocumentBatch(input, listBatch, {}, io); expect(result.publication).toBeNull(); data = result.results[0]!.data;
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/strip", new TextEncoder().encode(JSON.stringify(stripBatch))); await fs.writeFile("/list", new TextEncoder().encode(JSON.stringify(listBatch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const strip = await shell.exec((route === "cli" ? "docx signatures remove /input" : "docx batch /input --ops-file /strip") + " --output /destination --force --json");
      expect(strip.exitCode, strip.stdout + strip.stderr).toBe(1); expect(JSON.parse(strip.stdout)).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "unsupported-edit" }] });
      const listed = await shell.exec((route === "cli" ? "docx signatures list /input" : "docx batch /input --ops-file /list") + " --json");
      expect(listed.exitCode, listed.stdout + listed.stderr).toBe(0); const envelope = JSON.parse(listed.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] });
      data = route === "cli" ? envelope.data : envelope.data.results[0].data;
      if (route === "cli-batch") expect(envelope.data.publication).toBeNull();
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  const result = data as { items: { name: string; details: unknown }[]; relationships: unknown; verified: unknown };
  expect(result.verified).toBeNull(); expect(result.items).toHaveLength(1); expect(result.items[0]!.name).toBe("/" + target);
  expect(result.relationships).toEqual([{ owner: "/", id: "seal", type: signatureType, target: "/" + target, external: false }]);
  const bytes = before.get(target)!, sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, "0")).join("");
  expect(result.items[0]!.details).toEqual({ kind: "signatures", parts: [{ name: "/" + target, contentType, bytes: bytes.length, sha256 }] });
  expect(memory.statSync("/output").size).toBe(0); expect(input).toEqual(original); expect(readPackage(input)).toEqual(before);
});
