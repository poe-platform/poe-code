import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as publicApi from "docx";
import * as api from "../../src/index.js";
import { textContext, textFixture } from "./text.js";
import { readPackage } from "../assertions.js";

type Request = {
  strict: boolean; kind: "docx" | "dotx"; count: number; route: "model" | "sdk" | "cli";
  capacity: "sufficient" | "insufficient";
};
const ref = (resultHandle: string) => ({ resultHandle });
// These cases inspect preservation and resource limits, not host scheduling.
// Keep cancellation checks while avoiding thousands of real event-loop turns.
const yieldTurn = async (signal: AbortSignal) => { signal.throwIfAborted(); };

// Exercise source workflows and the built public reader in the normal Node
// runtime. Each request owns fresh bytes, filesystem, signals and budgets.
async function* verifyAccepted({ strict, kind, count, route }: Request) {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const opaque = `<f:opaque>${"<f:leaf/>".repeat(count)}</f:opaque>`;
  const styles = `<w:styles xmlns:w="${word}" xmlns:f="urn:original:comment-style-fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>${opaque}<!--retain--><?audit exact?></w:styles>`;
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style></w:styles>` } }, strict, { kind }), textContext);
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 }, documentLimits = { retainedBytes: 2147483648, work: 2147483648, xmlNodes: 8000000 }, signal = new AbortController().signal;
  const context = { ...textContext, limits, signal, budget: new api.DocumentBudget(documentLimits, signal, yieldTurn), timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/styles.xml" ? { ...member, bytes: new TextEncoder().encode(styles) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const node: api.DocxXmlNode = { kind: "element", name: { namespaceURI: word, localName: "style" }, attributes: [{ name: { namespaceURI: word, localName: "type" }, value: "character" }, { name: { namespaceURI: word, localName: "styleId" }, value: "CommentAux" }], children: [{ kind: "element", name: { namespaceURI: word, localName: "name" }, attributes: [{ name: { namespaceURI: word, localName: "val" }, value: "Comment Aux" }] }] };
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input, limits), operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.element.get", receiver: ref("styles"), arguments: {}, resultHandle: "styleRoot" },
    { operation: "model.XmlElementView.insert.call", receiver: ref("styleRoot"), arguments: { index: 2, node } },
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "Fresh海🌊", author: "Archive", initials: "AR" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
  ];
  yield;
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context), originalNormal = document.styles.at("Normal");
    document.styles.element.insert(2, node);
    assert.equal(originalNormal.equals(document.styles.at("Normal")), true);
    assert.equal(document.styles.at("Comment Aux").style_id, "CommentAux");
    const comment = document.comments.add_comment("Fresh海🌊", "Archive", "AR");
    assert.equal(comment.text, "Fresh海🌊"); await document.save(sink);
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); assert.equal(batch.results.at(-1)!.value, "Fresh海🌊"); await batch.save(sink);
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json");
      assert.equal(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input)), 0); if (result.exitCode !== 0) assert.deepEqual(await fs.readFile("/destination"), destination);
      assert.equal(result.exitCode, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).data.results.at(-1).data, "Fresh海🌊"); memory.writeFileSync("/output", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  yield;
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits);
  assert.ok(new TextDecoder().decode(after.get("word/styles.xml")!).includes(opaque + "<!--retain--><?audit exact?>"));
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "word/styles.xml", "word/_rels/document.xml.rels"].includes(name)) assert.deepEqual(after.get(name), bytes, name);
  const original = output.slice();
  const readSignal = new AbortController().signal;
  const readContext = {
    limits, signal: readSignal, budget: new publicApi.DocumentBudget(documentLimits, readSignal, yieldTurn),
    timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const
  };
  const document = await publicApi.Document(output, readContext);
  const comment = document.comments.get(0);
  assert.ok(comment);
  const observed = {
    styleId: document.styles.at("Comment Aux").style_id,
    text: comment.text, author: comment.author, initials: comment.initials,
    timestamp: comment.timestamp?.toISOString(),
    paragraphStyle: comment.paragraphs[0]!.style?.equals(document.styles.at("Comment Text")),
    referenceStyle: comment.paragraphs[0]!.runs[0]!.style?.equals(document.styles.at("Comment Reference")),
    sourceRetained: Buffer.compare(Buffer.from(output), Buffer.from(original)) === 0
  };
  assert.equal(observed.styleId, "CommentAux");
  assert.equal(observed.text, "Fresh海🌊"); assert.equal(observed.author, "Archive"); assert.equal(observed.initials, "AR"); assert.equal(observed.timestamp, "2026-03-04T05:06:07.000Z");
  assert.equal(observed.paragraphStyle, true); assert.equal(observed.referenceStyle, true); assert.equal(observed.sourceRetained, true);
  assert.equal(Buffer.compare(memory.readFileSync("/input") as Buffer, Buffer.from(input)), 0);
}

async function* verifyRefused({ strict, kind, count, route }: Request) {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const opaque = `<f:opaque>${"<f:leaf/>".repeat(count)}</f:opaque>`;
  const styles = `<w:styles xmlns:w="${word}" xmlns:f="urn:original:comment-style-fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>${opaque}<!--retain--><?audit exact?></w:styles>`;
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style></w:styles>` } }, strict, { kind }), textContext);
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 }, documentLimits = { retainedBytes: 2147483648, work: 2147483648, xmlNodes: 2_000_000 }, signal = new AbortController().signal;
  const context = { ...textContext, limits, signal, budget: new api.DocumentBudget(documentLimits, signal, yieldTurn), timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/styles.xml" ? { ...member, bytes: new TextEncoder().encode(styles) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const node: api.DocxXmlNode = { kind: "element", name: { namespaceURI: word, localName: "style" }, attributes: [{ name: { namespaceURI: word, localName: "type" }, value: "character" }, { name: { namespaceURI: word, localName: "styleId" }, value: "CommentAux" }], children: [{ kind: "element", name: { namespaceURI: word, localName: "name" }, attributes: [{ name: { namespaceURI: word, localName: "val" }, value: "Comment Aux" }] }] };
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input, limits), operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.element.get", receiver: ref("styles"), arguments: {}, resultHandle: "styleRoot" },
    { operation: "model.XmlElementView.insert.call", receiver: ref("styleRoot"), arguments: { index: 2, node } },
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "Fresh海🌊", author: "Archive", initials: "AR" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
  ];
  yield;
  if (route === "model") {
    const document = await api.Document(input, context), originalNormal = document.styles.at("Normal");
    document.styles.element.insert(2, node);
    assert.equal(originalNormal.equals(document.styles.at("Normal")), true);
    assert.equal(document.styles.at("Comment Aux").style_id, "CommentAux");
    assert.throws(() => document.comments.add_comment("Fresh海🌊", "Archive", "AR"), { code: "limit-exceeded" });
  } else if (route === "sdk") {
    await assert.rejects(api.applyStyleModelBatch(input, { version: 1, operations }, context), { code: "limit-exceeded" });
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json");
      assert.equal(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input)), 0); if (result.exitCode !== 0) assert.deepEqual(await fs.readFile("/destination"), destination);
      const response = JSON.parse(result.stdout);
      assert.equal(result.exitCode, 4, result.stdout + result.stderr);
      assert.equal(response.errors.length, 1);
      assert.deepEqual({ ok: response.ok, data: response.data, affected: response.affected,
        errors: response.errors.map((error: { code: string }) => ({ code: error.code })) },
      { ok: false, data: null, affected: 0, errors: [{ code: "limit-exceeded" }] });
      assert.deepEqual(await fs.readFile("/destination"), destination);
    } finally { await shell.dispose(); }
  }
  yield;
  assert.equal(memory.statSync("/output").size, 0);
  assert.equal(Buffer.compare(memory.readFileSync("/input") as Buffer, Buffer.from(input)), 0);
  const unchanged = readPackage(input, limits); assert.deepEqual([...unchanged.keys()], [...before.keys()]); for (const [name, bytes] of before) assert.equal(Buffer.compare(Buffer.from(unchanged.get(name)!), Buffer.from(bytes)), 0, name);
}

let current: { request: Request; workflow: AsyncGenerator<void, void> } | undefined;
console.log(JSON.stringify({ ready: true }));
for await (const raw of createInterface({ input: process.stdin })) {
  const { phase, ...request } = JSON.parse(raw) as Request & { phase: "prepare" | "execute" | "verify" };
  try {
    if (phase === "prepare") {
      assert.equal(current, undefined, "Previous workflow must finish first");
      current = { request, workflow: request.capacity === "sufficient" ? verifyAccepted(request) : verifyRefused(request) };
    }
    assert.ok(current);
    assert.deepEqual(current.request, request);
    const result = await current.workflow.next();
    assert.equal(result.done, phase === "verify");
    if (result.done) current = undefined;
    console.log(JSON.stringify({ ok: true, phase, ...request }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, phase, ...request, error: String(error),
      stack: error instanceof Error ? error.stack : undefined }));
  }
}
assert.equal(current, undefined, "Every prepared workflow must be verified");
