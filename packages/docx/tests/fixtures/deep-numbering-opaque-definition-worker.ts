import assert from "node:assert/strict";
import { Volume } from "memfs";
import { Document, DocumentBudget, createDocxInspectionCommandEngine, editDocumentLists, executeDocumentBatch, extractDocumentText } from "../../src/index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textFixture, textContext, w } from "./text.js";
import { readPackage } from "../assertions.js";
import { signatureArchiveLimits, signatureVariantFixture } from "./deep-numbering-signature-variants.js";

const strict = process.argv[2] === "strict", depth = Number(process.argv[3] ?? 4096);
const text = "Preserve 日本 עברית ẹ́ 🌊 𠀀";
const opaque = `<w:abstractNum w:abstractNumId="0">${"<f:p>".repeat(depth)}<f:unknown/>${"</f:p>".repeat(depth)}</w:abstractNum>`;
let input = await textFixture(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`, { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}" xmlns:f="urn:original:deep-opaque-definition" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">${opaque}</w:numbering>` } }, strict);
const variant = process.argv[7] ? await signatureVariantFixture(strict, depth, process.argv[7]!, process.argv[8]!, process.argv[9]!, process.argv[6] ?? "docx") : undefined;
if (variant) input = variant.input;
const archiveLimits = variant ? signatureArchiveLimits : textContext.limits;
const decode = (bytes: Uint8Array): string => new TextDecoder(bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8").decode(bytes);
const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "", "/destination": "Retain destination" });
const host = depth > 256 ? { xmlDepth: depth + 8, work: 4294967296, retainedBytes: 4294967296 } : {};
const context = () => ({ ...textContext, limits: archiveLimits, budget: new DocumentBudget(host, textContext.signal) });
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
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: archiveLimits, documentLimits: host }) }));
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
for (const [name, bytes] of before) if (!["word/document.xml", "word/numbering.xml"].includes(name)) assert.deepEqual(after.get(name), bytes);
assert.ok(decode(after.get("word/numbering.xml")!).includes(variant?.representation ?? opaque));
assert.equal((await extractDocumentText(output, context())).text, text + "\nAdded");
assert.ok(decode(after.get("word/document.xml")!).includes(variant?.body ?? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`));
const doc = await Document(output, context());
assert.equal(doc.paragraphs.map(p => p.text).join("\n"), text + "\nAdded");
assert.ok(decode(after.get("word/numbering.xml")!).includes('nl:abstractNumId="1"'));
if (variant) {
  assert.equal(doc.paragraphs[0]!.runs[0]!.font.rtl, true);
  for (const name of ["word/document.xml", "word/numbering.xml"]) {
    const framing = name === "word/document.xml" ? "story" : "numbering", source = decode(after.get(name)!);
    assert.ok(source.startsWith(`<!--${framing}-before-->`)); assert.ok(source.endsWith(`<!--${framing}-after-->`));
    if (process.argv[9] !== "utf8") assert.deepEqual(after.get(name)!.slice(0, process.argv[9] === "bom" ? 3 : 2), before.get(name)!.slice(0, process.argv[9] === "bom" ? 3 : 2));
  }
}
}
assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input);
assert.equal(memory.readFileSync("/destination", "utf8"), "Retain destination");
console.log(JSON.stringify({ strict, depth, exactOpaqueDefinitionPreservation: true, ...(process.argv[4] ? { route, dryRun, actualPublicDispatchAndRetention: true } : {}), ...(variant ? { kind: process.argv[6] ?? "docx", prefix: process.argv[7], carrier: process.argv[8], codec: process.argv[9], exactDirtyFramingCodecAndRTL: true } : {}) }));
