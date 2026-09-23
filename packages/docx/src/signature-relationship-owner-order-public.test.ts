import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { signatureFixture, signatureRole } from "../tests/fixtures/signatures.js";
import { textContext as fixtureContext } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
const textContext = { ...fixtureContext, encoding: { order: "input", compression: "store" } as const };


const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const order of ["input", "reverse"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`signature inventories use canonical owner order and each owner's XML order; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; order=${order}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document); expect(compiled.DocumentBudget).not.toBe(source.DocumentBudget);
  const archive = await api.readArchive(await signatureFixture("encoded"), textContext);
  const members = archive.members.map(member => {
    if (!member.name.endsWith(".xml") && !member.name.endsWith(".rels")) return member;
    let xml = new TextDecoder().decode(member.bytes)
      .replaceAll("http://schemas.openxmlformats.org/wordprocessingml/2006/main", strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
      .replaceAll("http://schemas.openxmlformats.org/officeDocument/2006/relationships", strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
      .replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`);
    if (member.name.endsWith("/origin.sigs.rels")) xml = xml.replace('Id="first"', 'Id="z"').replace('Id="second"', 'Id="a"');
    return { ...member, bytes: new TextEncoder().encode(xml) };
  });
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: order === "reverse" ? members.slice().reverse() : members }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = await encodeWholeXmlFixture(new Uint8Array(memory.readFileSync("/input") as Buffer), codec), original = input.slice();
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
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
  const result = data as { items: { name: string }[]; relationships: unknown; verified: unknown };
  expect(result.verified).toBeNull(); expect(result.items.map(item => item.name)).toEqual(["/★/cert.cer", "/★/first.xml", "/★/origin.sigs", "/★/second.xml"]);
  expect(result.relationships).toEqual([
    { owner: "/", id: "seal", type: signatureRole + "origin", target: "/★/origin.sigs", external: false },
    { owner: "/★/first.xml", id: "certificate", type: signatureRole + "certificate", target: "/★/cert.cer", external: false },
    { owner: "/★/origin.sigs", id: "z", type: signatureRole + "signature", target: "/★/first.xml", external: false },
    { owner: "/★/origin.sigs", id: "a", type: signatureRole + "signature", target: "/★/second.xml", external: false }
  ]);
  expect(input).toEqual(original); expect(memory.statSync("/output").size).toBe(0);
});
