import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";

const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const carrier of ["paragraph-fallback", "run-fallback"] as const)
for (const action of ["set", "remove"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`inactive field end cannot release an active comment field guard; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; carrier=${carrier}; action=${action}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const range = '<w:commentRangeStart w:id="19"/><w:r><w:t>Active海🌊</w:t></w:r><w:commentRangeEnd w:id="19"/><w:r><w:commentReference w:id="19"/></w:r>';
  const begin = '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF Coast</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>', end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const inactive = carrier === "paragraph-fallback" ? `<w:p>${end}</w:p>` : end;
  const active = carrier === "paragraph-fallback" ? `<w:p>${range}</w:p>` : range;
  const wrapper = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:original:inactive-comment-end" mc:Ignorable="o"><mc:Choice Requires="o">${inactive}</mc:Choice><mc:Fallback>${active}</mc:Fallback></mc:AlternateContent>`;
  const body = carrier === "paragraph-fallback" ? `<w:p>${begin}</w:p>${wrapper}<w:p>${end}</w:p>` : `<w:p>${begin}${wrapper}${end}</w:p>`;
  const input = await encodeWholeXmlFixture(await textFixture(body, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="19" w:author="Coast"><w:p><w:r><w:t>Retained note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict, { kind }), codec);
  const original = input.slice(), context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const inventory = await api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, context);
  expect(inventory.items[0]).toMatchObject({ comment_id: 19, text: "Retained note", issues: ["unsafe-anchor"] });
  const memory = Volume.fromJSON({ "/output": "", "/noop": "" });
  const document = await api.Document(input, context);
  expect(document.comments.get(19)!.text).toBe("Retained note");
  await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/noop", bytes); } });
  expect(new Uint8Array(memory.readFileSync("/noop") as Buffer)).toEqual(original);
  const operations = [action === "set" ? { operation: "comments.set" as const, arguments: { comment: 1, text: "Updated海🌊" } } : { operation: "comments.remove" as const, arguments: { comment: 1 } }];
  if (route === "sdk" || route === "sdk-batch") {
    const publication = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route === "sdk-batch" ? api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, publication) : action === "set" ? api.editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "Updated海🌊", output: "-" } }, publication) : api.editDocumentComments(input, { operation: "comments.remove", options: { comment: 1, output: "-" } }, publication);
    await expect(pending).rejects.toMatchObject({ code: "unsupported-edit", ...(route === "sdk-batch" ? { operationIndex: 0 } : {}) });
    expect(memory.statSync("/output").size).toBe(0);
  } else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli-batch" ? "docx batch /input --ops-file /operations" : `docx comments ${action} /input --comment 1` + (action === "set" ? " --text 'Updated海🌊'" : "");
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit", ...(route === "cli-batch" ? { operationIndex: 0 } : {}) }] });
      expect(await fs.readFile("/destination")).toEqual(retained); expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
});
