import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { Volume } from "memfs";
import * as api from "../../dist/index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";

async function prepare(request) {
  const memory = Volume.fromJSON({ "/input": Buffer.from(request.base64, "base64"), "/output": "Retained destination" });
  const signal = new AbortController().signal;
  const archive = await api.readArchive(new Uint8Array(memory.readFileSync("/input")), { limits: request.limits, signal });
  const { word, drawing, depth } = request;
  const commentXml = `<w:comments xmlns:w="${word}" xmlns:a="${drawing}"><w:comment w:id="17" w:author="Archive" w:date="2026-04-05T06:07:08Z"><w:p><w:r><w:drawing><a:graphic><a:graphicData uri="urn:original:inert-drawing"><a:extLst>${'<a:ext uri="urn:original:inert-extension">'.repeat(depth)}<a:leaf/>${"</a:ext>".repeat(depth)}</a:extLst></a:graphicData></a:graphic></w:drawing></w:r></w:p></w:comment><!--retain--><?audit exact?></w:comments>`;
  memory.writeFileSync("/input", "");
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/comments.xml" ? { ...member, bytes: new TextEncoder().encode(commentXml) } : member) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { limits: request.limits, signal });
  const input = new Uint8Array(memory.readFileSync("/input")), before = input.slice();
  const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 };
  const context = { limits: request.limits, signal, budget: new api.DocumentBudget(documentLimits, signal) };
  const ref = (resultHandle, index) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
  const operations = [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 17 }, resultHandle: "comment" },
    { operation: "model.comments.Comment.paragraphs.get", receiver: ref("comment"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.iter_inner_content.call", receiver: ref("runs", 0), arguments: {}, resultHandle: "drawings" },
    { operation: "model.drawing.Drawing." + request.action + ".get", receiver: ref("drawings", 0), arguments: {} },
  ];
  let fs, shell;
  if (request.route === "cli") {
    fs = new MemoryFileSystem();
    await fs.writeFile("/input", input);
    await fs.writeFile("/output", new TextEncoder().encode("Retained destination"));
    await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: request.limits, documentLimits }) }));
  }
  return { request, memory, input, before, signal, context, operations, fs, shell, result: {} };
}

async function execute(fixture) {
  const { request, input, context, operations, shell, result } = fixture;
  if (request.route === "model") {
    const document = await api.Document(input, context);
    const contents = [...document.comments.get(17).paragraphs[0].runs[0].iter_inner_content()];
    result.oneDrawing = contents.length === 1 && contents[0] instanceof api.Drawing;
    const drawing = contents[0];
    if (request.action === "image") {
      try { drawing.image; result.code = "unexpected-success"; }
      catch (error) { result.code = error.code ?? null; result.expectedType = error instanceof api.MissingKeyError; }
    } else {
      result.value = drawing.has_picture;
      fixture.publication = document;
    }
  } else if (request.route === "sdk") {
    try {
      const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context);
      result.oneDrawing = batch.results[4].value.length === 1 && batch.results[4].value[0].type === "Drawing";
      result.value = batch.results.at(-1).value;
      result.unchangedEffects = batch.affected === 0 && batch.changes.length === 0;
      if (request.depth === 32) fixture.publication = batch;
    } catch (error) {
      result.code = error.code ?? null;
      result.expectedType = error instanceof api.MissingKeyError;
    }
  } else {
    try {
      const response = await shell.exec("docx batch /input --ops-file /operations --output /output --force --json");
      const data = JSON.parse(response.stdout);
      if (request.action === "image") {
        result.code = data.errors?.[0]?.code ?? "unexpected-success";
        result.zeroEffects = data.affected === 0 && data.data === null;
      } else {
        result.exitCode = response.exitCode;
        result.value = data.data?.results?.at(-1)?.data;
        const items = data.data?.results?.[4]?.data;
        result.oneDrawing = items?.length === 1 && items[0].type === "Drawing";
      }
    } finally { await shell.dispose(); }
  }
  return result;
}

async function verify(fixture) {
  const { request, memory, input, before, signal, fs } = fixture;
  const result = {};
  if (fixture.publication) {
    memory.writeFileSync("/saved", "");
    await fixture.publication.save({ async write(bytes) { memory.appendFileSync("/saved", bytes); } });
  }
  if (request.route === "cli") {
    result.sourceRetained = Buffer.from(await fs.readFile("/input")).equals(Buffer.from(before));
    if (request.action === "image") {
      result.destinationRetained = new TextDecoder().decode(await fs.readFile("/output")) === "Retained destination";
    } else memory.writeFileSync("/saved", await fs.readFile("/output"));
  }
  result.exactInput = Buffer.from(input).equals(Buffer.from(before)) && Buffer.from(memory.readFileSync("/input")).equals(Buffer.from(before));
  if (request.action === "has_picture" && memory.existsSync("/saved")) {
    const saved = await api.readArchive(new Uint8Array(memory.readFileSync("/saved")), { limits: request.limits, signal });
    const original = await api.readArchive(before, { limits: request.limits, signal });
    result.exactMembers = saved.members.length === original.members.length && saved.members.every(member =>
      Buffer.from(member.bytes).equals(Buffer.from(original.members.find(old => old.name === member.name)?.bytes ?? [])));
  }
  return result;
}

let fixture;
console.log(JSON.stringify({ ready: true }));
try {
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    try {
      if (request.phase === "prepare") {
        assert.equal(fixture, undefined);
        fixture = await prepare(request);
        console.log(JSON.stringify({ ok: true, phase: request.phase }));
      } else {
        assert.ok(fixture);
        assert.equal(request.phase === "execute" || request.phase === "verify", true);
        const result = request.phase === "execute" ? await execute(fixture) : await verify(fixture);
        console.log(JSON.stringify({ ok: true, phase: request.phase, ...result }));
      }
    } catch (error) {
      console.log(JSON.stringify({ ok: false, phase: request.phase, error: String(error), stack: error.stack }));
    } finally {
      if (request.phase === "verify") {
        await fixture?.shell?.dispose();
        fixture = undefined;
        globalThis.gc();
      }
    }
  }
} finally { await fixture?.shell?.dispose(); }
