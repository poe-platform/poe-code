import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
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
for (const noteKind of ["footnote", "endnote"] as const)
for (const noteType of ["normal", "separator", "continuationSeparator", "continuationNotice"] as const)
for (const action of ["set", "remove"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`existing comment anchor stays in an admitted ordinary note story; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; note=${noteKind}; type=${noteType}; action=${action}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const rejected = noteType !== "normal", scope = noteKind === "footnote" ? "footnotes" : "endnotes";
  const range = '<w:commentRangeStart w:id="19"/><w:r><w:rPr><w:i/></w:rPr><w:t>Selected海🌊</w:t></w:r><w:commentRangeEnd w:id="19"/><w:r><w:commentReference w:id="19"/></w:r>';
  const unselected = `<w:${noteKind} w:id="17"><w:p><w:r><w:t>Unselected海🌊</w:t></w:r></w:p></w:${noteKind}>`;
  const normal = rejected ? `<w:${noteKind} w:id="12"><w:p><w:r><w:t>Ordinary海🌊</w:t></w:r></w:p></w:${noteKind}>` : "";
  const selected = `<w:${noteKind} w:id="${rejected ? -1 : 12}" w:type="${noteType}"><w:p>${range}</w:p></w:${noteKind}>`;
  const notesXml = `<w:${scope} xmlns:w="${w}">${normal}${selected}${unselected}<!--retained--><?audit exact?></w:${scope}>`;
  const input = await encodeWholeXmlFixture(await textFixture(`<w:p><w:r><w:t>Retained body</w:t></w:r><w:r><w:${noteKind}Reference w:id="12"/></w:r><w:r><w:${noteKind}Reference w:id="17"/></w:r></w:p>`, {
    notes: { kind: scope, xml: notesXml },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="19" w:author="Coast"><w:p><w:r><w:t>Retained comment</w:t></w:r></w:p></w:comment></w:comments>` }
  }, strict, { kind }), codec);
  const original = input.slice(), before = readPackage(input);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  expect((await api.validateDocument(input, context)).valid).toBe(true);
  const locations = await api.openDocumentLocations(input, context);
  expect(locations.text({ scope }).text).toBe((rejected ? "Ordinary海🌊" : "Selected海🌊") + "\n\nUnselected海🌊");
  expect(locations.list("story", { scope }).map(item => item.value.story)).toEqual(["/word/notes.xml#" + noteKind + ":12", "/word/notes.xml#" + noteKind + ":17"]);
  const inventory = await api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, context);
  const memory = Volume.fromJSON({ "/output": "", "/noop": "" });
  const document = await api.Document(input, context);
  expect(document.comments.get(19)!.text).toBe("Retained comment");
  await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/noop", bytes); } });
  expect(new Uint8Array(memory.readFileSync("/noop") as Buffer)).toEqual(original);
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
      const command = route === "cli-batch" ? "docx batch /input --ops-file /operations" : `docx comments ${action} /input --comment 1` + (action === "set" ? " --text 'Updated海🌊'" : "");
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit", ...(route === "cli-batch" ? { operationIndex: 0 } : {}) }] }); expect(await fs.readFile("/destination")).toEqual(retained); } else memory.writeFileSync("/output", await fs.readFile("/destination"));
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(inventory.items[0]).toMatchObject({ comment_id: 19, text: "Retained comment", issues: rejected ? ["unsafe-anchor"] : [] });
  if (!rejected) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    expect((await api.extractDocumentText(output, context, { scope })).text).toBe("Selected海🌊\n\nUnselected海🌊");
    const final = await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context);
    if (action === "set") expect(final.items[0]).toMatchObject({ comment_id: 19, text: "Updated海🌊", issues: [] }); else expect(final.items).toEqual([]);
    const dirty = action === "set" ? ["word/comments.xml"] : ["word/comments.xml", "word/notes.xml"];
    const prefix = codec === "utf8bom" ? [0xef, 0xbb, 0xbf] : codec === "utf16le" ? [0xff, 0xfe] : codec === "utf16be" ? [0xfe, 0xff] : [];
    for (const part of dirty) expect([...after.get(part)!.subarray(0, prefix.length)]).toEqual(prefix);
    for (const [part, bytes] of before) if (!dirty.includes(part)) expect(after.get(part), part).toEqual(bytes);
    const decoded = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(after.get("word/notes.xml")!);
    expect(decoded).toContain(unselected); expect(decoded).toContain("<!--retained--><?audit exact?>");
    expect(after.has("word/comments.xml")).toBe(true);
  }
  expect(input).toEqual(original);
});
