import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
const enc = (value: string) => new TextEncoder().encode(value), dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes), ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const sample of [{ raw: "7", id: 7 }, { raw: "4294967296", id: 4294967296 }, { raw: "9007199254740991", id: Number.MAX_SAFE_INTEGER }, { raw: "+007", id: 7 }, { raw: " &#x9;+007&#xA; ", id: 7 }, { raw: "-0", id: 0 }, { raw: " &#x9;-0&#xA; ", id: 0 }])
for (const route of ["model", "model-sdk", "model-cli", "sdk", "cli", "sdk-batch", "cli-batch"] as const)
for (const action of ["read", "edit", "allocate"] as const)
it(`native comment integer; strict=${strict}; kind=${kind}; raw=${sample.raw}; route=${route}; action=${action}`, async () => {
  const end = "00" + sample.id, reference = ` &#x9;+00${sample.id}&#xA; `;
  const body = `<w:p><w:commentRangeStart w:id="${sample.raw}"/><w:r><w:rPr><w:b/></w:rPr><w:t>Range</w:t></w:r><w:commentRangeEnd w:id="${end}"/><w:r><w:commentReference w:id="${reference}"/></w:r></w:p><w:p><w:r><w:t>Fresh</w:t></w:r></w:p>`;
  const input = await textFixture(body, { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="Comment Text"/></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="Comment Reference"/></w:style></w:styles>` }, comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="${sample.raw}" w:author="Archive"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Note海🌊</w:t></w:r></w:p></w:comment><!--native retain--><?audit exact?></w:comments>` } }, strict, { kind });
  const parts = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const, stdout: sink };
  const next = sample.id >= 2147483647 ? 0 : sample.id + 1;
  const modelOps: Record<string, unknown>[] = [{ operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" }, { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: sample.id }, resultHandle: "comment" }, { operation: "model.comments.Comment.comment_id.get", receiver: ref("comment"), arguments: {} }];
  if (action === "edit") modelOps.push({ operation: "model.comments.Comment.paragraphs.get", receiver: ref("comment"), arguments: {}, resultHandle: "paragraphs" }, { operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 0), arguments: { value: "Edited" } });
  if (action === "allocate") modelOps.push({ operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "Fresh note", author: "Reviewer" }, resultHandle: "freshComment" }, { operation: "model.comments.Comment.comment_id.get", receiver: ref("freshComment"), arguments: {} });
  if (route === "model") {
    const doc = await api.Document(input, context), comment = doc.comments.get(sample.id)!;
    expect(comment.comment_id).toBe(sample.id); expect(doc.comments.get(sample.id === Number.MAX_SAFE_INTEGER ? 42 : sample.id + 100)).toBeNull(); expect([...doc.comments].map(comment => comment.comment_id)).toEqual([sample.id]);
    if (action === "edit") comment.paragraphs[0]!.text = "Edited";
    if (action === "allocate") expect(doc.comments.add_comment("Fresh note", "Reviewer").comment_id).toBe(next);
    await doc.save(sink);
  } else if (route === "model-sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations: modelOps }, context);
    expect(result.results[2]!.value).toBe(sample.id); if (action === "allocate") expect(result.results.at(-1)!.value).toBe(next); await result.save(sink);
  } else {
    const document = await api.openDocumentLocations(input, context), paragraph = document.list("paragraph", { scope: "body" })[1]!, select = document.range(paragraph.token, 0, 5).token;
    const arguments_ = action === "allocate" ? { select, text: "Fresh note", author: "Reviewer", timestamp: "2026-03-04T05:06:07Z" } : action === "edit" ? { comment: 1, text: "Edited" } : { comment: 1 };
    const operation = action === "allocate" ? "comments.add" : action === "edit" ? "comments.set" : "comments.get";
    if (route === "sdk" || route === "sdk-batch") {
      const read = await api.inspectDocumentComments(input, { operation: "comments.get", options: { comment: 1 } }, context);
      expect(read.items[0]).toMatchObject({ comment_id: sample.id, text: "Note海🌊", issues: [], range: { start: { part: "/word/document.xml" }, end: { part: "/word/document.xml" }, reference: { part: "/word/document.xml" } } }); expect(read.issues).toEqual([]);
      if (action !== "read") {
        if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation, arguments: arguments_ }] }, { output: "-" }, context);
        else if (action === "edit") await api.editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "Edited", output: "-" } }, context);
        else await api.editDocumentComments(input, { operation: "comments.add", options: { select, text: "Fresh note", author: "Reviewer", timestamp: "2026-03-04T05:06:07Z", output: "-" } }, context);
      } else { if (route === "sdk-batch") { const result = await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "comments.get", arguments: { comment: 1 } }] }, { dryRun: true }, context); expect(result.results[0]!.affected).toBe(0); } memory.writeFileSync("/output", input); }
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = enc("Retained destination"); await fs.writeFile("/destination", retained);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits, }) }));
      try {
        const command = route === "model-cli" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: modelOps })}'` : route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation, arguments: arguments_ }] })}'` : action === "read" ? "docx comments get /input --comment 1" : action === "edit" ? "docx comments set /input --comment 1 --text Edited" : `docx comments add /input --select ${select} --text 'Fresh note' --author Reviewer --timestamp 2026-03-04T05:06:07Z`;
        const result = await shell.exec(command + (action === "read" ? route === "cli" ? "" : " --dry-run" : " --output /destination --force") + (route === "model-cli" && action === "allocate" ? " --timestamp 2026-03-04T05:06:07Z" : "") + " --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        if (route === "model-cli") { expect(JSON.parse(result.stdout).data.results[2].data).toBe(sample.id); if (action === "allocate") expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(next); }
        else if (action === "read" && route === "cli") expect(JSON.parse(result.stdout).data.item).toMatchObject({ properties: expect.arrayContaining([expect.objectContaining({ name: "comment_id", value: sample.id })]), details: { commentId: sample.id, author: "Archive", modern: false } });
        if (action === "read") { expect(await fs.readFile("/destination")).toEqual(retained); memory.writeFileSync("/output", input); } else memory.writeFileSync("/output", await fs.readFile("/destination"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  if (action === "read") expect(output).toEqual(input);
  else { const xml = dec(saved.get("word/comments.xml")!); expect(xml).toContain(`w:id="${sample.raw}"`); expect(xml).toContain('<!--native retain--><?audit exact?>'); for (const [name, bytes] of parts) if (name !== "word/comments.xml" && !(action === "allocate" && name === "word/document.xml")) expect(saved.get(name), name).toEqual(bytes); }
  expect((await api.Document(output, context)).comments.get(sample.id)!.comment_id).toBe(sample.id);
  if (action === "allocate") expect((await api.Document(output, context)).comments.get(next)!.text).toBe("Fresh note");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`native numeric existing-anchor guard; strict=${strict}; kind=${kind}`, async () => {
  const input = await textFixture('<w:p><w:commentRangeStart w:id="+007"/><w:r><w:t>Range</w:t></w:r><w:commentRangeEnd w:id="007"/><w:r><w:commentReference w:id=" &#x9;007&#xA; "/></w:r></w:p><w:p><w:r><w:t>Fresh</w:t></w:r></w:p>', { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7"><w:p/></w:comment></w:comments>` } }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), doc = await api.Document(input, textContext), run = doc.paragraphs[1]!.runs[0]!;
  expect(() => run.mark_comment_range(run, 7)).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } }); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input);
  for (const value of [-7, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => doc.comments.get(value)).toThrowError(expect.objectContaining({ code: "usage" }));
});
