import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const modern of [false, true]) for (const depth of [32, 8192])
for (const action of ["set", "remove"] as const) for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`selected comment opaque depth refuses atomically; strict=${strict}; kind=${kind}; modern=${modern}; depth=${depth}; action=${action}; route=${route}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", w14 = "http://schemas.microsoft.com/office/word/2010/wordml", w15 = "http://schemas.microsoft.com/office/word/2012/wordml";
  const initial = await textFixture('<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>', { comments: { kind: "comments", xml: `<w:comments xmlns:w="${word}"/>` }, ...(modern ? { thread: { kind: "commentsExtended", xml: `<m:commentsEx xmlns:m="${w15}"><m:commentEx m:paraId="000000A1" m:done="0"/></m:commentsEx>` } } : {}) }, strict, { kind });
  const archive = await api.readArchive(initial, textContext), comments = `<w:comments xmlns:w="${word}" xmlns:x="${w14}" xmlns:f="urn:original:selected-comment-opaque" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x f"><w:comment w:id="7" w:author="Archive" w:date="2026-03-04T05:06:07Z"><w:p${modern ? ' x:paraId="000000A1"' : ""}><w:r><w:t>Selected海🌊</w:t></w:r></w:p>${"<f:opaque>".repeat(depth)}<f:leaf f:retained="exact"/>${"</f:opaque>".repeat(depth)}</w:comment><!--retain--><?audit exact?></w:comments>`;
  const members = archive.members.map(member => member.name === "word/comments.xml" ? { ...member, bytes: enc(comments) } : member);
  if (modern) {
    const member = members.find(value => value.name === "word/_rels/document.xml.rels")!, editor = new api.DocumentXmlEditor(member.bytes);
    editor.setAttribute(editor.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "thread"))!, "Type", "http://schemas.microsoft.com/office/2011/relationships/commentsExtended"); members[members.indexOf(member)] = { ...member, bytes: editor.serialize() };
  }
  const limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 1048576, maxTotalBytes: 1048576, maxRetainedBytes: 2147483648 }, documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 }, signal = new AbortController().signal, context = { limits, signal, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }); await api.writeArchive({ ...archive, members }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), before = readPackage(input, limits), operation = `comments.${action}` as "comments.set" | "comments.remove", options = action === "set" ? { comment: 1, text: "Changed" } : { comment: 1 }, batch = { version: 1 as const, operations: [{ operation, arguments: options }] };
  if (route === "sdk" || route === "sdk-batch") {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route === "sdk" ? api.editDocumentComments(input, { operation, options: { ...options, output: "-" } } as api.CommentEditRequest, io) : api.executeDocumentBatch(input, batch, { output: "-" }, io);
    await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0);
  } else {
    const fs = new MemoryFileSystem(), destination = enc("Retained destination"); await fs.writeFile("/source", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", enc(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try { const result = await shell.exec((route === "cli" ? `docx comments ${action} /source --comment 1${action === "set" ? " --text Changed" : ""}` : "docx batch /source --ops-file /operations") + " --output /destination --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/source")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(destination); } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input, limits)).toEqual(before); expect(before.get("word/comments.xml")).toEqual(enc(comments));
});
