import assert from "node:assert/strict";
import { Volume } from "memfs";
import { Document, DocumentBudget, createDocxInspectionCommandEngine, editDocumentLists, executeDocumentBatch, extractDocumentText, readDocumentArchive } from "../../src/index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textFixture, textContext, w } from "./text.js";
import { readPackage } from "../assertions.js";

const strict = process.argv[2] === "strict", depth = 4096;
const text = "Original 日本 עברית ẹ́ 🌊 𠀀";
const body = `<w:p xmlns:f="urn:original:deep-numbering-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:p">${"<f:p>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:p>".repeat(depth)}</w:p>`;
const scenario = process.argv[3] ?? "story";
const inert = `<f:p xmlns:f="urn:original:deep-inactive-numbering">${"<f:p>".repeat(depth - 1)}<w:num w:numId="1"><w:abstractNumId w:val="9"/></w:num>${"</f:p>".repeat(depth)}`;
const input = await textFixture(scenario === "inactive-numbering" ? `<w:p><w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r></w:p>` : body, scenario === "inactive-numbering" ? { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}" xmlns:f="urn:original:deep-inactive-numbering" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">${inert}</w:numbering>` } } : {}, strict), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "", "/destination": "Retain destination" });
const context = () => ({ ...textContext, budget: new DocumentBudget({ xmlDepth: depth + 8, retainedBytes: 4294967296, work: 4294967296 }, textContext.signal) });
const result = await editDocumentLists(new Uint8Array(memory.readFileSync("/input") as Buffer), { operation: "lists.add", options: { kind: "decimal", text: "Added 日本 עברית", output: "-" } }, { ...context(), encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
assert.equal(result.changed, true);
assert.equal(result.changes.length, 1);
assert.equal(result.changes[0]!.kind, "insert");
const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
const archive = await readDocumentArchive(output, context());
const numberingName = archive.package.relationships("/" + archive.mainPart).find(edge => edge.reltype.endsWith("/numbering"))!.target_part.name;
assert.ok(after.has(numberingName));
assert.ok(new TextDecoder().decode(after.get("word/document.xml")).includes(scenario === "inactive-numbering" ? `<w:p><w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r></w:p>` : body));
if (scenario === "inactive-numbering") assert.ok(new TextDecoder().decode(after.get(numberingName)).includes(inert));
for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml", ...(scenario === "inactive-numbering" ? ["word/numbering.xml"] : [])].includes(name)) assert.deepEqual(after.get(name), bytes);
const extracted = await extractDocumentText(output, context());
assert.equal(extracted.text, text + "\nAdded 日本 עברית");
assert.ok(extracted.segments.some(segment => segment.text === text && segment.formatting.rtl === true));
if (scenario === "unused-level" && !process.argv[4]) {
  memory.writeFileSync("/next", "");
  await editDocumentLists(output, { operation: "lists.add", options: { paragraph: 2, kind: "lowerLetter", level: 1, text: "Next", output: "-" } }, { ...context(), encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/next", bytes); } } });
  const next = new Uint8Array(memory.readFileSync("/next") as Buffer);
  assert.equal((await extractDocumentText(next, context())).text, text + "\nAdded 日本 עברית\nNext");
  for (const [name, bytes] of after) if (!["word/document.xml", numberingName].includes(name)) assert.deepEqual(readPackage(next).get(name), bytes);
}
const route = process.argv[4], dryRun = process.argv[5] === "dry";
if (route) {
  const seed = scenario === "unused-level" ? output : input;
  const options = scenario === "unused-level" ? { paragraph: 2, kind: "lowerLetter" as const, level: 1, text: "Next" } : { kind: "decimal" as const, text: "Added 日本 עברית" };
  const expectedText = text + "\nAdded 日本 עברית" + (scenario === "unused-level" ? "\nNext" : "");
  memory.writeFileSync("/public", "");
  const stdout = { async write(bytes: Uint8Array) { memory.appendFileSync("/public", bytes); } };
  const operations = [{ operation: "lists.add" as const, arguments: options }];
  if (route === "sdk") {
    const r = await editDocumentLists(seed, { operation: "lists.add", options: { ...options, output: "-", dryRun } }, { ...context(), encoding: { order: "input", compression: "store" }, stdout });
    assert.equal(r.changed, true); assert.equal(r.changes.length, 1); assert.equal(r.dryRun, dryRun);
    if (dryRun) assert.equal(r.output, null);
  } else if (route === "sdk-batch") {
    const r = await executeDocumentBatch(seed, { version: 1, operations }, { output: "-", dryRun }, { ...context(), encoding: { order: "input", compression: "store" }, stdout });
    assert.equal(r.results.length, 1); assert.equal(r.results[0]!.affected, 1);
    if (dryRun) assert.equal(r.publication!.output, null);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", seed); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: { xmlDepth: depth + 8, retainedBytes: 4294967296, work: 4294967296 } }) }));
    try {
      const command = route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}'` : `docx lists add /input --kind ${options.kind} --text '${options.text}'${scenario === "unused-level" ? " --paragraph 2 --level 1" : ""}`;
      const result = await shell.exec(command + (dryRun ? " --dry-run --json" : " --output -"));
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      if (dryRun) { const e = JSON.parse(result.stdout); assert.equal(e.ok, true); assert.deepEqual(e.errors, []); assert.equal(e.affected, 1); assert.equal(route === "cli-batch" ? e.data.publication.output : e.data.output, null); }
      else memory.writeFileSync("/public", result.stdoutBytes);
      assert.deepEqual(await fs.readFile("/input"), seed); assert.equal(new TextDecoder().decode(await fs.readFile("/destination")), "Retain destination");
    } finally { await shell.dispose(); }
  }
  if (dryRun) assert.equal(memory.readFileSync("/public").length, 0);
  else {
    const bytes = new Uint8Array(memory.readFileSync("/public") as Buffer), parts = readPackage(bytes), seedParts = readPackage(seed);
    const doc = await Document(bytes, context());
    assert.equal(doc.paragraphs.map(p => p.text).join("\n"), expectedText); assert.equal(doc.paragraphs[0]!.runs[0]!.font.rtl, true);
    for (const [name, original] of seedParts) if (!["word/document.xml", numberingName, ...(scenario === "unused-level" || scenario === "inactive-numbering" ? [] : ["[Content_Types].xml", "word/_rels/document.xml.rels"])].includes(name)) assert.deepEqual(parts.get(name), original);
    assert.ok(new TextDecoder().decode(parts.get("word/document.xml")).includes(scenario === "inactive-numbering" ? `<w:p><w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r></w:p>` : body));
    if (scenario === "inactive-numbering") assert.ok(new TextDecoder().decode(parts.get(numberingName)).includes(inert));
  }
}
assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input);
assert.equal(memory.readFileSync("/destination", "utf8"), "Retain destination");
console.log(JSON.stringify({ strict, depth, exactNumberingPublicationAndCarrierRetention: true, ...(scenario === "story" ? {} : { scenario }), ...(route ? { route, dryRun, actualPublicDispatchAndRetention: true } : {}) }));
