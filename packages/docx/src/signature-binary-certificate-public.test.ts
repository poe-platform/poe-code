import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { signatureFixture } from "../tests/fixtures/signatures.js";
import { textContext as fixtureContext } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";
const textContext = { ...fixtureContext, encoding: { order: "input", compression: "store" } as const };


const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`signature certificates retain and hash opaque binary bytes; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document); expect(compiled.DocumentBudget).not.toBe(source.DocumentBudget);
  const certificate = new Uint8Array([0, 255, 128, 254, 17, 3, 0, 10, 13, 38, 60, 62]);
  const archive = await api.readArchive(await signatureFixture(), textContext);
  const members = archive.members.map(member => {
    if (member.name === "seals/cert.cer") return { ...member, bytes: certificate };
    if (!member.name.endsWith(".xml") && !member.name.endsWith(".rels")) return member;
    const xml = new TextDecoder().decode(member.bytes)
      .replaceAll("http://schemas.openxmlformats.org/wordprocessingml/2006/main", strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
      .replaceAll("http://schemas.openxmlformats.org/officeDocument/2006/relationships", strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
      .replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`);
    return { ...member, bytes: new TextEncoder().encode(xml) };
  });
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = await encodeWholeXmlFixture(new Uint8Array(memory.readFileSync("/input") as Buffer), codec), original = input.slice();
  const before = readPackage(input); expect(before.get("seals/cert.cer")).toEqual(certificate);
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const model = await api.Document(input, textContext);
  expect(model.part.package.parts.find(part => String(part.partname) === "/seals/cert.cer")!.blob).toEqual(certificate);
  const batch = { version: 1 as const, operations: [{ operation: "signatures.list" as const, arguments: {} }] };
  let data: unknown;
  if (route === "sdk") data = await api.inspectDocumentSignatures(input, {}, textContext);
  else if (route === "sdk-batch") {
    const result = await api.executeDocumentBatch(input, batch, {}, { ...textContext, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    expect(result.publication).toBeNull(); data = result.results[0]!.data;
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec((route === "cli" ? "docx signatures list /input" : "docx batch /input --ops-file /operations") + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const envelope = JSON.parse(response.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] });
      data = route === "cli" ? envelope.data : envelope.data.results[0].data;
      if (route === "cli-batch") expect(envelope.data.publication).toBeNull();
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  const result = data as { items: { name: string; details: unknown }[]; verified: unknown };
  expect(result.verified).toBeNull(); expect(result.items).toHaveLength(4);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(certificate)))].map(value => value.toString(16).padStart(2, "0")).join("");
  expect(result.items.find(item => item.name === "/seals/cert.cer")!.details).toEqual({ kind: "signatures", parts: [{ name: "/seals/cert.cer", contentType: "application/vnd.openxmlformats-package.digital-signature-certificate", bytes: certificate.length, sha256: hash }] });
  expect(input).toEqual(original); expect(memory.statSync("/output").size).toBe(0);
});
