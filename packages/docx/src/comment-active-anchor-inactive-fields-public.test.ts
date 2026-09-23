import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";

const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const carrier of ["paragraph-fallback", "run-fallback"] as const)
for (const hidden of ["field-begin", "duplicate-marker"] as const)
for (const action of ["set", "remove"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`active existing comment retains inactive field and marker semantics; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; carrier=${carrier}; hidden=${hidden}; action=${action}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const range = '<w:commentRangeStart w:id="19"/><w:r><w:t>Active海🌊</w:t></w:r><w:commentRangeEnd w:id="19"/><w:r><w:commentReference w:id="19"/></w:r>';
  const hiddenContent = hidden === "field-begin" ? '<w:r><w:fldChar w:fldCharType="begin"/><w:t>Inactive field</w:t></w:r>' : '<w:commentRangeStart w:id="19"/><w:r><w:t>Inactive marker</w:t></w:r>';
  const inactive = carrier === "paragraph-fallback" ? `<w:p>${hiddenContent}</w:p>` : hiddenContent;
  const active = carrier === "paragraph-fallback" ? `<w:p>${range}</w:p>` : range;
  const wrapper = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:original:inactive-comment-fields" mc:Ignorable="o"><mc:Choice Requires="o">${inactive}</mc:Choice><mc:Fallback>${active}</mc:Fallback></mc:AlternateContent>`;
  const body = carrier === "paragraph-fallback" ? wrapper : `<w:p>${wrapper}</w:p>`;
  const input = await encodeWholeXmlFixture(await textFixture(body, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="19" w:author="Coast"><w:p><w:r><w:t>Retained note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict, { kind }), codec);
  const original = input.slice(), before = readPackage(input);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const inventory = await api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, context);
  expect(inventory.items[0]).toMatchObject({ comment_id: 19, text: "Retained note", issues: hidden === "field-begin" ? [] : ["inconsistent-range", "unsafe-anchor"] });
  const memory = Volume.fromJSON({ "/output": "", "/noop": "" });
  const document = await api.Document(input, context);
  expect(document.comments.get(19)!.text).toBe("Retained note");
  await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/noop", bytes); } });
  expect(new Uint8Array(memory.readFileSync("/noop") as Buffer)).toEqual(original);
  const rejected = hidden === "duplicate-marker";
  const argumentsValue = action === "set" ? { comment: 1, text: "Updated海🌊" } : { comment: 1 };
  const operations = [action === "set" ? { operation: "comments.set" as const, arguments: { comment: 1, text: "Updated海🌊" } } : { operation: "comments.remove" as const, arguments: { comment: 1 } }];
  if (route === "sdk" || route === "sdk-batch") {
    const publication = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route === "sdk-batch" ? api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, publication) : action === "set" ? api.editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "Updated海🌊", output: "-" } }, publication) : api.editDocumentComments(input, { operation: "comments.remove", options: { comment: 1, output: "-" } }, publication);
    if (rejected) { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit", ...(route === "sdk-batch" ? { operationIndex: 0 } : {}) }); expect(memory.statSync("/output").size).toBe(0); } else await pending;
  } else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli-batch" ? "docx batch /input --ops-file /operations" : `docx comments ${action} /input --comment ${argumentsValue.comment}` + (action === "set" ? " --text 'Updated海🌊'" : "");
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit", ...(route === "cli-batch" ? { operationIndex: 0 } : {}) }] }); expect(await fs.readFile("/destination")).toEqual(retained); } else memory.writeFileSync("/output", await fs.readFile("/destination"));
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  if (!rejected) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    const decoded = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(after.get("word/document.xml")!);
    expect(decoded).toContain(inactive);
    expect((await api.extractDocumentText(output, context)).text).toBe("Active海🌊");
    const final = await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context);
    if (action === "set") expect(final.items[0]).toMatchObject({ comment_id: 19, text: "Updated海🌊", issues: [] }); else expect(final.items).toEqual([]);
    const dirty = action === "set" ? ["word/comments.xml"] : ["word/comments.xml", "word/document.xml"];
    const prefix = codec === "utf8bom" ? [0xef, 0xbb, 0xbf] : codec === "utf16le" ? [0xff, 0xfe] : codec === "utf16be" ? [0xfe, 0xff] : [];
    for (const part of dirty) expect([...after.get(part)!.subarray(0, prefix.length)]).toEqual(prefix);
    for (const [part, bytes] of before) if (!dirty.includes(part)) expect(after.get(part), part).toEqual(bytes);
    expect(after.has("word/comments.xml")).toBe(true);
  }
  expect(input).toEqual(original);
});
