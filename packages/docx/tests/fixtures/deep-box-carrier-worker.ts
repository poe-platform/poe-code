import assert from "node:assert/strict";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, DocumentBudget, extractDocumentText, createDocxInspectionCommandEngine, replaceDocumentText } from "../../src/index.js";
import { textFixture, textContext } from "./text.js";
import { box } from "./shapes.js";
import { readPackage, xmlStructure } from "../assertions.js";
import { SaxesParser } from "saxes";

const strict = process.argv[2] === "strict", route = process.argv[3], action = process.argv[4], depth = 4096;
const text = "Boxed 日本 עברית ẹ́ 🌊 𠀀";
const content = `<w:p xmlns:f="urn:original:deep-native-box" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:p">${"<f:p>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:p>".repeat(depth)}</w:p>`;
const input = await textFixture(box(content, "native", strict), {}, strict);
const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "", "/destination": "Retain destination" });
const documentLimits = { xmlDepth: depth + 16, retainedBytes: 4294967296, work: 4294967296 };
const context = () => ({ ...textContext, budget: new DocumentBudget(documentLimits, textContext.signal) });
const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
if (route === "sdk") {
  assert.equal((await extractDocumentText(input, context(), { scope: "body" })).text, "");
  const selected = await extractDocumentText(input, context(), { scope: "text-boxes" });
  assert.equal(selected.text, text);
  assert.ok(selected.segments.some(segment => segment.text === text && segment.formatting.rtl === true));
  if (action === "read") await (await Document(input, context())).save(sink);
  else await replaceDocumentText(input, { scope: "text-boxes", find: "Boxed", with: "Updated", all: true, output: "-", dryRun: action === "dry" }, { ...context(), encoding: { order: "input", compression: "store" }, stdout: sink });
} else {
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits }) }));
  try {
    const command = action === "read" ? "docx text /input --scope text-boxes --json" : `docx text replace /input --scope text-boxes --find Boxed --with Updated --all ${action === "dry" ? "--dry-run --json" : "--output -"}`;
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    if (action === "read") {
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.data.text, text);
      assert.ok(envelope.data.segments.some((segment: { text: string; formatting: { rtl: boolean } }) => segment.text === text && segment.formatting.rtl === true));
    } else if (action === "dry") assert.equal(JSON.parse(result.stdout).ok, true);
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
  if (action !== "read") {
    const original = new TextDecoder().decode(before.get("word/document.xml")), actual = new TextDecoder().decode(after.get("word/document.xml"));
    const needle = `<w:t>${text}</w:t>`, start = original.indexOf(needle), end = actual.indexOf("</w:t>", start) + 6;
    assert.ok(start >= 0 && end > start);
    assert.equal(original.indexOf(needle, start + 1), -1);
    assert.equal(actual.slice(0, start), original.slice(0, start));
    assert.equal(actual.slice(end), original.slice(start + needle.length));
    const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    assert.deepEqual(xmlStructure(new TextEncoder().encode(actual.slice(start, end))).children, [{ name: `{${word}}t`, attributes: { "{http://www.w3.org/XML/1998/namespace}space": "preserve" }, children: [text.replace("Boxed", "Updated")] }]);
    const parser = new SaxesParser({ xmlns: true }); let leaves = 0;
    parser.on("opentag", tag => {
      if (tag.uri !== word || tag.local !== "t") return;
      leaves++;
      for (const [prefix, uri] of Object.entries({ w: word, r: strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", s: strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", f: "urn:original:deep-native-box", mc: "http://schemas.openxmlformats.org/markup-compatibility/2006" })) assert.equal(tag.ns[prefix], uri);
    });
    parser.write(actual).close(); assert.equal(leaves, 1);
  }
  const selected = await extractDocumentText(output, context(), { scope: "text-boxes" });
  assert.equal(selected.text, action === "read" ? text : text.replace("Boxed", "Updated"));
  assert.ok(selected.segments.some(segment => segment.formatting.rtl === true));
}
assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input);
assert.equal(memory.readFileSync("/destination", "utf8"), "Retain destination");
console.log(JSON.stringify({ strict, depth, route, action, exactStoryIsolationAndRetention: true }));
