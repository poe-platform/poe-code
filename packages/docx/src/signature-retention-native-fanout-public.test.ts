import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { signatureFixture, signatureRole } from "../tests/fixtures/signatures.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [1024, 131072]) for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`signature stripping retains admitted opaque relationship fanout; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async () => {
  const archive = await api.readArchive(await signatureFixture(), textContext);
  const retained = `<f:opaque>${"<f:leaf/>".repeat(count)}</f:opaque>`;
  const members = archive.members.map(member => {
    if (!member.name.endsWith(".xml") && !member.name.endsWith(".rels")) return member;
    let xml = decode(member.bytes).replaceAll("http://schemas.openxmlformats.org/wordprocessingml/2006/main", strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main").replaceAll("http://schemas.openxmlformats.org/officeDocument/2006/relationships", strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships").replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`);
    if (member.name === "_rels/.rels") xml = xml.replace("<Relationships", '<Relationships xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:signature-retention-fanout" mc:Ignorable="f"').replace("</Relationships>", retained + "<!--retain--><?audit exact?></Relationships>");
    return { ...member, bytes: encode(xml) };
  });
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 }, documentLimits = { retainedBytes: 2147483648, work: 2147483648 }, signal = new AbortController().signal;
  const context = { ...textContext, limits, signal, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input, limits), batch = { version: 1 as const, operations: [{ operation: "signatures.remove" as const, arguments: {} }] };
  if (route === "sdk" || route === "sdk-batch") {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const result = route === "sdk" ? await api.stripDocumentSignatures(input, { output: "-" }, io) : (await api.executeDocumentBatch(input, batch, { output: "-" }, io)).results[0]!.data;
    expect(result).toMatchObject({ changed: true, removedRelationships: expect.arrayContaining([expect.objectContaining({ owner: "/", id: "seal" })]) });
  } else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const result = await shell.exec((route === "cli" ? "docx signatures remove /input" : "docx batch /input --ops-file /operations") + " --output /destination --force --json");
      expect(await fs.readFile("/input")).toEqual(input); if (result.exitCode !== 0) expect(await fs.readFile("/destination")).toEqual(destination);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, errors: [] }); memory.writeFileSync("/output", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits);
  expect((await api.inspectDocumentSignatures(output, {}, context)).relationships).toEqual([]);
  expect([...after.keys()]).toEqual([...before.keys()].filter(name => !name.startsWith("seals/")));
  for (const [name, bytes] of before) if (!name.startsWith("seals/") && !["[Content_Types].xml", "_rels/.rels"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const removed = `<Relationship Id="seal" Type="${signatureRole}origin" Target="seals/origin.sigs"/>`;
  expect(decode(after.get("_rels/.rels")!)).toBe(decode(before.get("_rels/.rels")!).replace(removed, ""));
  expect(decode(after.get("_rels/.rels")!)).toContain(retained + "<!--retain--><?audit exact?>");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
