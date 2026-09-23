import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const api = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { readPackage } from "../tests/assertions.js";
import { textContext as sourceTextContext, textFixture, w } from "../tests/fixtures/text.js";

// Execute the preserved public scenarios against the compiled package runtime.
const textContext = { limits: sourceTextContext.limits, signal: sourceTextContext.signal };
const enc = (text: string) => new TextEncoder().encode(text), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "cli"] as const)
for (const member of ["settings-owner", "settings-element", "settings-part", "settings-equals-self", "settings-equals-null", "settings-equals-number", "comments-owner", "comments-length", "comments-iteration", "comments-missing", "comment-part", "comment-element", "comment-blocks", "comment-paragraphs", "comment-tables", "comment-text", "comment-no-aliases"] as const)
it(`review public member view; strict=${strict}; kind=${kind}; route=${route}; member=${member}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Retained</w:t></w:r></w:p>', {
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat/><!--native retain--><?audit exact?></w:settings>` },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="23" w:author="Archive"><w:p><w:r><w:t>First</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Last</w:t></w:r></w:p></w:comment><!--native retain--><?audit exact?></w:comments>` }
  }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const operations: Record<string, unknown>[] = [{ operation: "model.document.Document.settings.get", receiver: ref("document"), arguments: {}, resultHandle: "settings" }, { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" }, { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 23 }, resultHandle: "comment" }];
  const targets: Record<string, { operation: string; receiver: { resultHandle: string }; arguments: Record<string, unknown> }> = {
    "settings-owner": { operation: "model.document.Document.settings.get", receiver: ref("document"), arguments: {} },
    "settings-element": { operation: "model.settings.Settings.element.get", receiver: ref("settings"), arguments: {} },
    "settings-part": { operation: "model.settings.Settings.part.get", receiver: ref("settings"), arguments: {} },
    "settings-equals-self": { operation: "model.settings.Settings.__eq__.call", receiver: ref("settings"), arguments: { other: ref("settings") } },
    "settings-equals-null": { operation: "model.settings.Settings.__eq__.call", receiver: ref("settings"), arguments: { other: null } },
    "settings-equals-number": { operation: "model.settings.Settings.__eq__.call", receiver: ref("settings"), arguments: { other: 0 } },
    "comments-owner": { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {} },
    "comments-length": { operation: "model.comments.Comments.__len__.get", receiver: ref("comments"), arguments: {} },
    "comments-iteration": { operation: "model.comments.Comments.__iter__.call", receiver: ref("comments"), arguments: {} },
    "comments-missing": { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 404 } },
    "comment-part": { operation: "model.comments.Comment.part.get", receiver: ref("comment"), arguments: {} },
    "comment-element": { operation: "model.comments.Comment.element.get", receiver: ref("comment"), arguments: {} },
    "comment-blocks": { operation: "model.comments.Comment.iter_inner_content.call", receiver: ref("comment"), arguments: {} },
    "comment-paragraphs": { operation: "model.comments.Comment.paragraphs.get", receiver: ref("comment"), arguments: {} },
    "comment-tables": { operation: "model.comments.Comment.tables.get", receiver: ref("comment"), arguments: {} },
    "comment-text": { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
  };
  const observe = (value: unknown) => {
    const type = (v: unknown) => (v as { type: string }).type;
    if (member === "settings-owner") expect(type(value)).toBe("Settings");
    if (member === "settings-element" || member === "comment-element") expect(type(value)).toBe("XmlElementView");
    if (member === "settings-part") expect(type(value)).toBe("SettingsPart");
    if (member === "settings-equals-self") expect(value).toBe(true);
    if (member === "settings-equals-null" || member === "settings-equals-number") expect(value).toBe(false);
    if (member === "comments-owner") expect(type(value)).toBe("Comments");
    if (member === "comments-length") expect(value).toBe(1);
    if (member === "comments-iteration") expect((value as unknown[]).map(type)).toEqual(["Comment"]);
    if (member === "comments-missing") expect(value).toBeNull();
    if (member === "comment-part") expect(type(value)).toBe("CommentsPart");
    if (member === "comment-blocks") expect((value as unknown[]).map(type)).toEqual(["Paragraph", "Table", "Paragraph"]);
    if (member === "comment-paragraphs") expect((value as unknown[]).map(type)).toEqual(["Paragraph", "Paragraph"]);
    if (member === "comment-tables") expect((value as unknown[]).map(type)).toEqual(["Table"]);
    if (member === "comment-text") expect(value).toBe("First\nLast");
  };
  if (member === "comment-no-aliases") {
    const doc = await api.Document(input, context), comment = doc.comments.get(23)!;
    for (const alias of ["id", "date", "add_run"]) expect(alias in comment).toBe(false);
    expect("paragraphs" in doc.comments).toBe(false);
    for (const readonly of ["comment_id", "timestamp", "text"]) expect(Object.getOwnPropertyDescriptor(api.Comment.prototype, readonly)?.set).toBeUndefined();
    if (route !== "model") {
      const invalid = { version: 1 as const, operations: [...operations, { operation: "model.comments.Comment.id.get", receiver: ref("comment"), arguments: {} }] };
      if (route === "sdk") await expect(api.applyStyleModelBatch(input, invalid, context)).rejects.toMatchObject({ code: "usage" });
      else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(invalid)}' --dry-run --json`); expect(result.exitCode).toBe(2); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "usage" }] }); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
    }
    await doc.save(sink);
  } else if (route === "model") {
    const doc = await api.Document(input, context), comment = doc.comments.get(23)!;
    const value: Record<string, () => unknown> = {
      "settings-owner": () => { expect(doc.settings).toBeInstanceOf(api.Settings); return doc.settings; },
      "settings-element": () => { expect(doc.settings.element.tag.localName).toBe("settings"); return doc.settings.element; },
      "settings-part": () => { expect(String(doc.settings.part.partname)).toBe("/word/settings.xml"); return doc.settings.part; },
      "settings-equals-self": () => doc.settings.equals(doc.settings), "settings-equals-null": () => doc.settings.equals(null), "settings-equals-number": () => doc.settings.equals(0),
      "comments-owner": () => { expect(doc.comments).toBeInstanceOf(api.Comments); return doc.comments; }, "comments-length": () => doc.comments.length,
      "comments-iteration": () => [...doc.comments], "comments-missing": () => doc.comments.get(404), "comment-part": () => { expect(comment.part).toBeInstanceOf(api.StoryPart); return comment.part; },
      "comment-element": () => { expect(comment.element.tag.localName).toBe("comment"); return comment.element; }, "comment-blocks": () => [...comment.iter_inner_content()], "comment-paragraphs": () => comment.paragraphs,
      "comment-tables": () => comment.tables, "comment-text": () => comment.text
    };
    const result = value[member]!();
    if (member === "comments-length" || member === "comments-missing" || member === "comment-text" || member.startsWith("settings-equals")) observe(result);
    if (member === "comment-blocks") expect((result as unknown[]).map(item => item instanceof api.Table ? "Table" : "Paragraph")).toEqual(["Paragraph", "Table", "Paragraph"]);
    if (member === "comment-paragraphs") expect((result as compiledTypes.Paragraph[]).map(item => item.text)).toEqual(["First", "Last"]);
    if (member === "comment-tables") expect((result as compiledTypes.Table[])[0]!.cell(0, 0).text).toBe("Cell");
    if (member === "comments-iteration") expect((result as compiledTypes.Comment[]).map(item => item.comment_id)).toEqual([23]);
    await doc.save(sink);
  } else {
    operations.push(targets[member]!);
    if (route === "sdk") { const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); observe(batch.results.at(-1)!.value); expect(batch.affected).toBe(0); await batch.save(sink); }
    else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = enc("Retained destination"); await fs.writeFile("/destination", retained); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --output /destination --force --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); observe(envelope.data.results.at(-1).data); expect(envelope.affected).toBe(0); expect(await fs.readFile("/destination")).toEqual(retained); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output", input); } finally { await shell.dispose(); } }
  }
  expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input);
  expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
