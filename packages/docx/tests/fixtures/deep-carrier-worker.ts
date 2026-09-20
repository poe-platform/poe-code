import assert from "node:assert/strict";
import { Volume } from "memfs";
import { Document, DocumentBudget, extractDocumentText, applyStyleModelBatch, createDocxInspectionCommandEngine, replaceDocumentText } from "../../src/index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { readPackage } from "../assertions.js";
import { textFixture, textContext } from "./text.js";

const strict = process.argv[2] === "strict", depth = 4096;
const text = "Isolated 日本 עברית ẹ́ 🌊 𠀀";
const body = `<w:p xmlns:f="urn:original:isolated-deep-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:p">${"<f:p>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:p>".repeat(depth)}</w:p>`;
const input = await textFixture(body, {}, strict), memory = Volume.fromJSON({ "/input": Buffer.from(input) });
const result = await extractDocumentText(new Uint8Array(memory.readFileSync("/input") as Buffer), {
  ...textContext, budget: new DocumentBudget({ xmlDepth: depth + 8 }, textContext.signal)
});
assert.equal(result.text, text);
assert.ok(result.segments.some(segment => segment.text === text && segment.formatting.rtl === true));
assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input);
const route = process.argv[3], action = process.argv[4];
if (route) {
  const context = () => ({ ...textContext, budget: new DocumentBudget({ xmlDepth: depth + 8, retainedBytes: 4294967296, work: 4294967296 }, textContext.signal) });
  const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
  const operations: Record<string, unknown>[] = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.text.get", receiver: ref("runs", 0), arguments: {} }
  ];
  if (action !== "read") operations.push({ operation: "model.text.run.Run.bold.set", receiver: ref("runs", 0), arguments: { value: true } });
  memory.writeFileSync("/destination", "Retain destination");
  memory.writeFileSync("/output", "");
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "native") {
    const doc = await Document(input, context());
    assert.equal(doc.paragraphs[0]!.runs[0]!.text, text);
    if (action !== "read") doc.paragraphs[0]!.runs[0]!.bold = true;
    await doc.save(sink, { dryRun: action === "dry" });
  } else if (route === "typed") {
    const batch = await applyStyleModelBatch(input, { version: 1, operations }, context());
    assert.equal(batch.results[2]!.value, text);
    await batch.save(sink, { dryRun: action === "dry" });
  } else if (route === "replace") {
    await replaceDocumentText(input, { find: "Isolated", with: "Replaced", all: true, output: "-", dryRun: action === "dry" }, { ...context(), encoding: { order: "input", compression: "store" }, stdout: sink });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: { xmlDepth: depth + 8, retainedBytes: 4294967296, work: 4294967296 } }) }));
    try {
      const command = route === "cli-replace" ? 'docx text replace /input --find Isolated --with Replaced --all' : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}'`;
      const flags = action === "read" ? "--json" : action === "dry" ? "--dry-run --json" : "--output -";
      const result = await shell.exec(`${command} ${flags}`);
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      if (action === "read") assert.equal(JSON.parse(result.stdout).data.results[2].data, text);
      else if (action === "dry") { const envelope = JSON.parse(result.stdout); assert.equal(envelope.ok, true); assert.deepEqual(envelope.errors, []); }
      else memory.writeFileSync("/output", result.stdoutBytes);
      assert.deepEqual(await fs.readFile("/input"), input);
      assert.equal(new TextDecoder().decode(await fs.readFile("/destination")), "Retain destination");
    } finally { await shell.dispose(); }
  }
  if (action === "dry" || route === "cli" && action === "read") assert.equal(memory.readFileSync("/output").length, 0);
  else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [name, bytes] of before) if (action === "read" || name !== "word/document.xml") assert.deepEqual(after.get(name), bytes);
    const doc = await Document(output, context());
    assert.equal(doc.paragraphs[0]!.text, route.includes("replace") ? text.replace("Isolated", "Replaced") : text);
    assert.equal(doc.paragraphs[0]!.runs[0]!.font.rtl, true);
    if (!route.includes("replace") && action !== "read") assert.equal(doc.paragraphs[0]!.runs[0]!.bold, true);
  }
  assert.equal(memory.readFileSync("/destination", "utf8"), "Retain destination");
  assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input);
}
console.log(JSON.stringify({ strict, depth, xmlDepth: depth + 8, exactTextAndReadPurity: true, ...(route ? { route, action, exactPublicationAndRetention: true } : {}) }));
