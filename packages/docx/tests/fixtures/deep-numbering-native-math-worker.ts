import assert from "node:assert/strict";
import { Volume } from "memfs";
import { Document, DocumentBudget, createDocxInspectionCommandEngine, editDocumentLists, executeDocumentBatch, readDocumentArchive, writeArchive } from "../../src/index.js";
import { textFixture, textContext } from "./text.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { readPackage } from "../assertions.js";

const strict = process.argv[2] === "strict", radicals = Number(process.argv[3] ?? 1280);
const mathNamespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : "http://schemas.openxmlformats.org/officeDocument/2006/math";
const text = "Native 日本 עברית ẹ́ 🌊 𠀀";
const equation = `<w:p xmlns:m="${mathNamespace}"><m:oMath>${"<m:rad><m:deg/><m:e>".repeat(radicals)}<m:r><m:t>x</m:t></m:r>${"</m:e></m:rad>".repeat(radicals)}</m:oMath></w:p>`;
let input = await textFixture(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` + equation, {}, strict);
const kind = process.argv[6] ?? "docx";
if (kind === "dotx") {
  const archive = await readDocumentArchive(input, { ...textContext, budget: new DocumentBudget({ xmlDepth: radicals * 2 + 16, work: 4294967296, retainedBytes: 4294967296 }, textContext.signal) });
  const staging = Volume.fromJSON({ "/template": "" });
  await writeArchive({ comment: archive.comment, members: archive.members.map(member => ({ ...member, bytes: member.name === "[Content_Types].xml" ? new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")) : member.bytes })) }, { async write(bytes) { staging.appendFileSync("/template", bytes); } }, { order: "input", compression: "store" }, textContext);
  input = new Uint8Array(staging.readFileSync("/template") as Buffer);
}
const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "", "/destination": "Retain destination" });
const host = radicals > 100 ? { xmlDepth: radicals * 2 + 16, work: 4294967296, retainedBytes: 4294967296 } : {};
const context = () => ({ ...textContext, budget: new DocumentBudget(host, textContext.signal) });
const route = process.argv[4] ?? "sdk", dryRun = process.argv[5] === "dry";
const stdout = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
const operations = [{ operation: "lists.add" as const, arguments: { kind: "decimal" as const, text: "Added" } }];
if (route === "sdk") {
  const r = await editDocumentLists(new Uint8Array(memory.readFileSync("/input") as Buffer), { operation: "lists.add", options: { kind: "decimal", text: "Added", output: "-", dryRun } }, { ...context(), encoding: { order: "input", compression: "store" }, stdout });
  assert.equal(r.changed, true); assert.equal(r.changes.length, 1); if (dryRun) assert.equal(r.output, null);
} else if (route === "sdk-batch") {
  const r = await executeDocumentBatch(input, { version: 1, operations }, { output: "-", dryRun }, { ...context(), encoding: { order: "input", compression: "store" }, stdout });
  assert.equal(r.results.length, 1); assert.equal(r.results[0]!.affected, 1); if (dryRun) assert.equal(r.publication!.output, null);
} else {
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: host }) }));
  try {
    const command = route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}'` : "docx lists add /input --kind decimal --text Added";
    const r = await shell.exec(command + (dryRun ? " --dry-run --json" : " --output -")); assert.equal(r.exitCode, 0, r.stdout + r.stderr);
    if (dryRun) { const e = JSON.parse(r.stdout); assert.equal(e.ok, true); assert.equal(e.affected, 1); assert.deepEqual(e.errors, []); assert.equal(route === "cli-batch" ? e.data.publication.output : e.data.output, null); }
    else memory.writeFileSync("/output", r.stdoutBytes);
    assert.deepEqual(await fs.readFile("/input"), input); assert.equal(new TextDecoder().decode(await fs.readFile("/destination")), "Retain destination");
  } finally { await shell.dispose(); }
}
if (dryRun) assert.equal(memory.readFileSync("/output").length, 0);
else {
const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
assert.ok(new TextDecoder().decode(after.get("word/document.xml")).includes(equation));
for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) assert.deepEqual(after.get(name), bytes);
const doc = await Document(output, context()); assert.equal(doc.paragraphs.length, 3); assert.equal(doc.paragraphs[0]!.text, text); assert.equal(doc.paragraphs[2]!.text, "Added");
}
assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input); assert.equal(memory.readFileSync("/destination", "utf8"), "Retain destination");
console.log(JSON.stringify({ strict, radicals, exactNativeMathAndNumberingPreservation: true, ...(process.argv[4] ? { route, dryRun, actualPublicDispatchAndRetention: true } : {}), ...(process.argv[6] ? { kind } : {}) }));
