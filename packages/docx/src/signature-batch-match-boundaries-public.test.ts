import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { signatureFixture } from "../tests/fixtures/signatures.js";
import { textContext as fixtureContext } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
const textContext = { ...fixtureContext, encoding: { order: "input", compression: "store" } as const };


const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const scenario of ["exact-capacity", "cumulative-overflow"] as const)
for (const route of ["sdk", "cli"] as const)
it(`signature ordered inventories retain cumulative match capacity; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; scenario=${scenario}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document); expect(compiled.DocumentBudget).not.toBe(source.DocumentBudget);
  const archive = await api.readArchive(await signatureFixture(), textContext);
  const members = archive.members.map(member => {
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
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const batch = { version: 1 as const, operations: Array.from({ length: scenario === "exact-capacity" ? 2 : 3 }, () => ({ operation: "signatures.list" as const, arguments: {} })) };
  let data: source.DocumentBatchData | undefined;
  if (route === "sdk") {
    const budget = new api.DocumentBudget({ matches: 8 }, textContext.signal);
    const pending = api.executeDocumentBatch(input, batch, {}, { ...textContext, budget, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    if (scenario === "exact-capacity") { data = await pending; expect(budget.usage.matches).toBe(8); }
    else await expect(pending).rejects.toMatchObject({ code: "limit-exceeded", operationIndex: 2, operationId: "step3" });
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /operations --limit matches=8 --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(scenario === "exact-capacity" ? 0 : 4);
      const envelope = JSON.parse(response.stdout);
      if (scenario === "exact-capacity") { expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] }); data = envelope.data; }
      else expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "limit-exceeded", operationIndex: 2 }] });
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  if (data) {
    expect(data.publication).toBeNull(); expect(data.results).toHaveLength(2);
    for (const [index, result] of data.results.entries()) expect(result).toMatchObject({ id: `step${index + 1}`, ok: true, affected: 0, data: { verified: null, items: [{ name: "/seals/cert.cer" }, { name: "/seals/first.xml" }, { name: "/seals/origin.sigs" }, { name: "/seals/second.xml" }] } });
  }
  expect(input).toEqual(original); expect(memory.statSync("/output").size).toBe(0);
});
