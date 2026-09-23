import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const compiled = await compiledPublicRuntime;
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const noteKind of ["footnote", "endnote"] as const)
for (const noteType of ["normal", "separator", "continuationSeparator", "continuationNotice"] as const)
for (const action of ["author", "initials", "initials-remove", "paragraph-text"] as const)
for (const route of ["model", "sdk-model-batch", "cli-model-batch"] as const)
it(`live classic comment body edit preserves existing note anchor; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; note=${noteKind}; type=${noteType}; action=${action}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document);
  const special = noteType !== "normal", scope = noteKind === "footnote" ? "footnotes" : "endnotes";
  const range = '<w:commentRangeStart w:id="19"/><w:r><w:rPr><w:i/></w:rPr><w:t>Selected海🌊</w:t></w:r><w:commentRangeEnd w:id="19"/><w:r><w:commentReference w:id="19"/></w:r>';
  const normal = special ? `<w:${noteKind} w:id="12"><w:p><w:r><w:t>Ordinary海🌊</w:t></w:r></w:p></w:${noteKind}>` : "";
  const selected = `<w:${noteKind} w:id="${special ? -1 : 12}" w:type="${noteType}"><w:p>${range}</w:p></w:${noteKind}>`;
  const unselected = `<w:${noteKind} w:id="17"><w:p><w:r><w:t>Unselected海🌊</w:t></w:r></w:p></w:${noteKind}>`;
  const input = await encodeWholeXmlFixture(await textFixture(`<w:p><w:r><w:t>Retained body</w:t></w:r><w:r><w:${noteKind}Reference w:id="12"/></w:r><w:r><w:${noteKind}Reference w:id="17"/></w:r></w:p>`, {
    notes: { kind: scope, xml: `<w:${scope} xmlns:w="${w}">${normal}${selected}${unselected}<!--retained--><?audit exact?></w:${scope}>` },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="19" w:author="Coast" w:initials="Old" w:date="2026-03-04T05:06:07Z"><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Retained comment</w:t></w:r></w:p></w:comment><!--retained comments--><?audit exact?></w:comments>` }
  }, strict, { kind }), codec);
  const original = input.slice(), before = readPackage(input), timestamp = new Date("2026-03-04T05:06:07Z");
  const context = { ...textContext, timestamp, encoding: { order: "input", compression: "store" } as const };
  expect((await api.validateDocument(input, context)).valid).toBe(true);
  const locations = await api.openDocumentLocations(input, context, "inventory");
  const expectedNoteText = (special ? "Ordinary海🌊" : "Selected海🌊") + "\n\nUnselected海🌊";
  expect(locations.text({ scope }).text).toBe(expectedNoteText);
  expect(locations.list("story", { scope }).map(item => item.value.story)).toEqual(["/word/notes.xml#" + noteKind + ":12", "/word/notes.xml#" + noteKind + ":17"]);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/noop": "", "/output": "" });
  const document = await api.Document(input, context), originalComment = document.comments.get(19)!;
  expect(originalComment.comment_id).toBe(19);
  expect(originalComment.timestamp!.toISOString()).toBe(timestamp.toISOString());
  expect(originalComment.text).toBe("Retained comment");
  await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/noop", bytes); } });
  expect(new Uint8Array(memory.readFileSync("/noop") as Buffer)).toEqual(original);
  const expectedAuthor = action === "author" ? '"Updated 海🌊 &\n' : "Coast";
  const expectedInitials = action === "initials" ? "I'海🌊&" : action === "initials-remove" ? null : "Old";
  const expectedText = action === "paragraph-text" ? "Updated 海🌊" : "Retained comment";
  const operations: Record<string, unknown>[] = [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 19 }, resultHandle: "comment" }
  ];
  if (action === "paragraph-text") operations.push(
    { operation: "model.comments.Comment.paragraphs.get", receiver: ref("comment"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 0), arguments: { value: expectedText } }
  );
  else operations.push({ operation: `model.comments.Comment.${action === "author" ? "author" : "initials"}.set`, receiver: ref("comment"), arguments: { value: action === "author" ? expectedAuthor : expectedInitials } });
  const observe = [
    { operation: "model.comments.Comment.author.get", receiver: ref("comment"), arguments: {} },
    { operation: "model.comments.Comment.initials.get", receiver: ref("comment"), arguments: {} },
    { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
  ];
  operations.push(...observe);
  if (route === "model") {
    if (action === "author") originalComment.author = expectedAuthor;
    else if (action === "paragraph-text") originalComment.paragraphs[0]!.text = expectedText;
    else originalComment.initials = expectedInitials;
    expect(originalComment.author).toBe(expectedAuthor); expect(originalComment.initials).toBe(expectedInitials); expect(originalComment.text).toBe(expectedText);
    await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk-model-batch") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context);
    expect(batch.results.slice(-3).map(result => result.value)).toEqual([expectedAuthor, expectedInitials, expectedText]);
    await batch.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).data.results.slice(-3).map((result: { data: unknown }) => result.data)).toEqual([expectedAuthor, expectedInitials, expectedText]);
      expect(await fs.readFile("/input")).toEqual(original); memory.writeFileSync("/output", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect((await api.validateDocument(output, context)).valid).toBe(true);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [part, bytes] of before) if (part !== "word/comments.xml") expect(after.get(part), part).toEqual(bytes);
  const prefix = codec === "utf8bom" ? [0xef, 0xbb, 0xbf] : codec === "utf16le" ? [0xff, 0xfe] : codec === "utf16be" ? [0xfe, 0xff] : [];
  expect([...after.get("word/comments.xml")!.subarray(0, prefix.length)]).toEqual(prefix);
  const commentXml = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(after.get("word/comments.xml")!);
  expect(commentXml).toContain('<w:pPr><w:keepNext/></w:pPr>'); expect(commentXml).toContain('w:date="2026-03-04T05:06:07Z"');
  expect(commentXml).toContain("<!--retained comments--><?audit exact?>");
  expect((await api.extractDocumentText(output, context, { scope })).text).toBe(expectedNoteText);
  const read = await api.Document(output, context), comment = read.comments.get(19)!;
  expect(comment.author).toBe(expectedAuthor); expect(comment.initials).toBe(expectedInitials); expect(comment.text).toBe(expectedText);
  expect(comment.timestamp!.toISOString()).toBe(timestamp.toISOString());
  const inventory = await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context);
  expect(inventory.items[0]).toMatchObject({ comment_id: 19, author: expectedAuthor, initials: expectedInitials, text: expectedText, issues: special ? ["unsafe-anchor"] : [] });
  expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
