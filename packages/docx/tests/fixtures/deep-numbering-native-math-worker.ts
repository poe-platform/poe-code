import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Volume } from "memfs";
import { Document, DocumentBudget, createDocxInspectionCommandEngine, editDocumentLists, executeDocumentBatch, readDocumentArchive, writeArchive } from "../../src/index.js";
import { textFixture, textContext } from "./text.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { nativeMathNumberingVariantFixture, nativeMathVariantArchiveLimits } from "./deep-native-math-numbering-variants.js";
import { readPackage } from "../assertions.js";

export async function run(args: readonly string[]) {
const strict = args[0] === "strict", radicals = Number(args[1] ?? 1280);
const mathNamespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : "http://schemas.openxmlformats.org/officeDocument/2006/math";
const text = "Native 日本 עברית ẹ́ 🌊 𠀀";
const equation = `<w:p xmlns:m="${mathNamespace}"><m:oMath>${"<m:rad><m:deg/><m:e>".repeat(radicals)}<m:r><m:t>x</m:t></m:r>${"</m:e></m:rad>".repeat(radicals)}</m:oMath></w:p>`;
let input = await textFixture(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` + equation, {}, strict);
const kind = args[4] ?? "docx";
if (kind === "dotx" && !args[5]) {
  const archive = await readDocumentArchive(input, { ...textContext, budget: new DocumentBudget({ xmlDepth: radicals * 2 + 16, work: 4294967296, retainedBytes: 4294967296 }, textContext.signal, async () => {}) });
  const staging = Volume.fromJSON({ "/template": "" });
  await writeArchive({ comment: archive.comment, members: archive.members.map(member => ({ ...member, bytes: member.name === "[Content_Types].xml" ? new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")) : member.bytes })) }, { async write(bytes) { staging.appendFileSync("/template", bytes); } }, { order: "input", compression: "store" }, textContext);
  input = new Uint8Array(staging.readFileSync("/template") as Buffer);
}
const variant = args[5] ? await nativeMathNumberingVariantFixture(strict, radicals, args[5]!, args[6]!, args[7]!, kind) : undefined;
if (variant) input = variant.input;
const archiveLimits = variant ? nativeMathVariantArchiveLimits : textContext.limits;
const decode = (bytes: Uint8Array): string => new TextDecoder(bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8").decode(bytes);
const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "", "/destination": "Retain destination" });
const host = radicals > 100 ? { xmlDepth: radicals * 2 + 16, work: 4294967296, retainedBytes: 4294967296 } : {};
const context = () => ({ ...textContext, limits: archiveLimits, budget: new DocumentBudget(host, textContext.signal, async () => {}) });
const route = args[2] ?? "sdk", dryRun = args[3] === "dry";
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
assert.ok(decode(after.get("word/document.xml")!).includes(variant?.equationRepresentation ?? equation));
for (const [name, bytes] of before) if (!(variant ? ["word/document.xml", "word/numbering.xml"] : ["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"]).includes(name)) assert.deepEqual(after.get(name), bytes);
const doc = await Document(output, context()); assert.equal(doc.paragraphs.length, 3); assert.equal(doc.paragraphs[0]!.text, text); assert.equal(doc.paragraphs[2]!.text, "Added");
if (variant) {
  assert.equal(doc.paragraphs[0]!.runs[0]!.font.rtl, true);
  assert.ok(decode(after.get("word/document.xml")!).includes(variant.body));
  assert.ok(decode(after.get("word/numbering.xml")!).includes(variant.representation));
  assert.ok(decode(after.get("word/numbering.xml")!).includes('nl:abstractNumId="1"'));
  for (const name of ["word/document.xml", "word/numbering.xml"]) {
    const framing = name === "word/document.xml" ? "story" : "numbering", source = decode(after.get(name)!);
    assert.ok(source.startsWith(`<!--${framing}-before-->`)); assert.ok(source.endsWith(`<!--${framing}-after-->`));
    if (args[7] !== "utf8") assert.deepEqual(after.get(name)!.slice(0, args[7] === "bom" ? 3 : 2), before.get(name)!.slice(0, args[7] === "bom" ? 3 : 2));
  }
}
}
assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input); assert.equal(memory.readFileSync("/destination", "utf8"), "Retain destination");
return { strict, radicals, exactNativeMathAndNumberingPreservation: true, ...(args[2] ? { route, dryRun, actualPublicDispatchAndRetention: true } : {}), ...(args[4] ? { kind } : {}), ...(variant ? { prefix: args[5], carrier: args[6], codec: args[7], exactDirtyFramingCodecRTLAndOpaqueSignatureInteraction: true } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await run(process.argv.slice(2))));
}
