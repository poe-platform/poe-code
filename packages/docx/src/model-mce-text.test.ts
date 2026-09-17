import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, DocumentBudget, applyStyleModelBatch, createDocxInspectionCommandEngine, extractDocumentText, readArchive } from "./index.js";
import { paragraph, run, table, textContext, textFixture, w } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const choice = (active: string, inactive: string, requires = "w") =>
  `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${requires}">${active}</mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent>`;

async function verifyContainerBatch(input: Uint8Array, operations: readonly unknown[], expected: readonly unknown[]) {
  const batch = { version: 1, operations };
  const sdk = await applyStyleModelBatch(input, batch, textContext);
  expect(sdk.affected).toBe(0);
  expect(sdk.results.slice(-expected.length).map(result => result.value)).toEqual(expected);
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/stdout": "", "/stderr": "", "/saved": "" });
  const cli = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input.docx", "--ops-json", JSON.stringify(batch), "--dry-run", "--json"].map(word => new TextEncoder().encode(word)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(cli.exitCode, volume.readFileSync("/stderr", "utf8") as string).toBe(0);
  const result = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
  expect(result.affected).toBe(0);
  expect(result.data.results.slice(-expected.length).map((item: { data: unknown }) => item.data)).toEqual(expected);
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  await sdk.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
  const saved = new Uint8Array(volume.readFileSync("/saved") as Buffer);
  const before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
  expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
  const reloaded = await applyStyleModelBatch(saved, batch, textContext);
  expect(reloaded.results.slice(-expected.length).map(result => result.value)).toEqual(expected);
}

const cases = [
  { name: "selected runs", body: `<w:p>${run("Lead ")}${choice(run("selected"), run("inactive"))}${run(" tail")}</w:p>`, texts: ["Lead selected tail"], runs: ["Lead ", "selected", " tail"] },
  { name: "fallback runs", body: `<w:p>${run("Lead ")}${choice(run("inactive"), run("fallback"), "f")}${run(" tail")}</w:p>`, texts: ["Lead fallback tail"], runs: ["Lead ", "fallback", " tail"] },
  { name: "selected text leaves", body: `<w:p><w:r><w:t>Lead </w:t>${choice("<w:t>selected</w:t>", "<w:t>inactive</w:t>")}<w:tab/><w:t>tail</w:t></w:r></w:p>`, texts: ["Lead selected\ttail"], runs: ["Lead selected\ttail"] },
  { name: "processed wrapper", body: `<w:p xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${run("Lead ")}<f:pass>${run("processed")}</f:pass><f:skip>${run("hidden")}</f:skip>${run(" tail")}</w:p>`, texts: ["Lead processed tail"], runs: ["Lead ", "processed", " tail"] },
  { name: "selected paragraphs", body: paragraph("Lead") + choice(paragraph("selected"), paragraph("inactive")) + paragraph("Tail"), texts: ["Lead", "selected", "Tail"], runs: ["Lead"] },
  { name: "selected hyperlink runs", body: `<w:p><w:hyperlink w:anchor="local">${choice(run("selected"), run("inactive"))}</w:hyperlink>${run(" tail")}</w:p>`, texts: ["selected tail"], runs: [" tail"], hyperlink: "selected" },
  { name: "ignored wrapper", body: `<w:p xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f">${run("Lead")}<f:skip>${run("hidden")}</f:skip></w:p>`, texts: ["Lead"], runs: ["Lead"] }
];

it("reads an ordinary hundred-paragraph document within an explicit two-megabyte retained budget", async () => {
  const expected = Array.from({ length: 100 }, (_, index) => `Record ${index}`);
  const input = await textFixture(expected.map(text => paragraph(text)).join(""));
  const budget = new DocumentBudget({ retainedBytes: 2 * 1024 * 1024 });
  const document = await Document(input, { ...textContext, budget });
  expect(document.paragraphs.map(p => p.text)).toEqual(expected);
  expect(budget.usage.retainedBytes).toBeLessThanOrEqual(budget.limits.retainedBytes);
});

it("refreshes logical reads after an unrelated edit and retains alternatives after a refused edit", async () => {
  const input = await textFixture(paragraph("Lead") + choice(paragraph("selected"), paragraph("inactive")));
  const document = await Document(input, textContext);
  const [lead, selected] = document.paragraphs;
  expect(selected!.text).toBe("selected");
  const original = document.element.serialize();
  expect(() => { selected!.text = "forbidden"; }).toThrow();
  expect(document.element.serialize()).toEqual(original);
  expect(selected!.text).toBe("selected");
  lead!.text = "Changed";
  expect(document.paragraphs.map(p => p.text)).toEqual(["Changed", "selected"]);
  expect(selected!.text).toBe("selected");
});

it("keeps repeated logical reads bounded, owner-specific and cancellable", async () => {
  const input = await textFixture(choice(paragraph("selected"), paragraph("inactive")) + paragraph("ordinary"));
  const abort = new AbortController();
  const budget = new DocumentBudget({}, abort.signal);
  const first = await Document(input, { ...textContext, signal: abort.signal, budget });
  const second = await Document(input, textContext);
  const selected = first.paragraphs[0]!;
  expect(selected.text).toBe("selected");
  const before = budget.usage;
  for (let i = 0; i < 100; i++) expect(selected.text).toBe("selected");
  expect(budget.usage.retainedBytes).toBe(before.retainedBytes);
  expect(budget.usage.work).toBeGreaterThan(before.work);
  second.paragraphs[1]!.text = "second only";
  expect(first.paragraphs[1]!.text).toBe("ordinary");
  expect(second.paragraphs[1]!.text).toBe("second only");
  abort.abort();
  expect(() => selected.text).toThrow("cancelled");
  expect(second.paragraphs[0]!.text).toBe("selected");
});

for (const strict of [false, true]) it(`reads selected comment blocks in ${strict ? "Strict" : "Transitional"} markup`, async () => {
  const selected = paragraph("selected comment") + table([paragraph("selected cell")]);
  const inactive = paragraph("inactive comment") + table([paragraph("inactive cell")]);
  const input = await textFixture(paragraph("Body"), {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="0" w:author="Reviewer">${choice(selected, inactive)}</w:comment></w:comments>` }
  }, strict);
  const document = await Document(input, textContext);
  const comment = document.comments.get(0)!;
  expect(comment.text).toBe("selected comment");
  expect(comment.paragraphs.map(p => p.text)).toEqual(["selected comment"]);
  expect(comment.tables[0]!.cell(0, 0).text).toBe("selected cell");
  expect([...comment.iter_inner_content()].map(block => block.constructor.name)).toEqual(["Paragraph", "Table"]);
  await verifyContainerBatch(input, [
    { operation: "model.document.Document.comments.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: { resultHandle: "comments" }, arguments: { commentId: 0 }, resultHandle: "comment" },
    { operation: "model.comments.Comment.tables.get", receiver: { resultHandle: "comment" }, arguments: {}, resultHandle: "tables" },
    { operation: "model.table.Table.cell.call", receiver: { resultHandle: "tables", index: 0 }, arguments: { rowIdx: 0, colIdx: 0 }, resultHandle: "cell" },
    { operation: "model.table._Cell.text.get", receiver: { resultHandle: "cell" }, arguments: {} },
    { operation: "model.comments.Comment.text.get", receiver: { resultHandle: "comment" }, arguments: {} }
  ], ["selected cell", "selected comment"]);
});

for (const strict of [false, true]) it(`enumerates only selected comments in ${strict ? "Strict" : "Transitional"} markup`, async () => {
  const comment = (id: number, value: string) => `<w:comment w:id="${id}" w:author="Reviewer">${paragraph(value)}</w:comment>`;
  const input = await textFixture(paragraph("Body"), {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}">${choice(comment(1, "selected"), comment(2, "inactive"))}</w:comments>` }
  }, strict);
  const document = await Document(input, textContext);
  expect(document.comments.length).toBe(1);
  expect([...document.comments].map(item => [item.comment_id, item.text])).toEqual([[1, "selected"]]);
  expect(document.comments.get(2)).toBeNull();
  await verifyContainerBatch(input, [
    { operation: "model.document.Document.comments.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: { resultHandle: "comments" }, arguments: { commentId: 1 }, resultHandle: "comment" },
    { operation: "model.comments.Comment.text.get", receiver: { resultHandle: "comment" }, arguments: {} },
    { operation: "model.comments.Comments.get.call", receiver: { resultHandle: "comments" }, arguments: { commentId: 2 } }
  ], ["selected", null]);
});

for (const strict of [false, true]) it(`includes selected paragraphs and section boundaries in ${strict ? "Strict" : "Transitional"} markup`, async () => {
  const selected = `<w:p><w:pPr><w:sectPr><w:pgSz w:w="10000" w:h="15000"/></w:sectPr></w:pPr>${run("first section")}</w:p>`;
  const input = await textFixture(choice(selected, paragraph("inactive")) + paragraph("second section") + "<w:sectPr/>", {}, strict);
  const document = await Document(input, textContext);
  expect(document.sections.length).toBe(2);
  expect(document.sections[0]!.page_width!.twips).toBe(10000);
  expect([...document.sections[0]!.iter_inner_content()].map(block => "text" in block ? block.text : "table")).toEqual(["first section"]);
  expect([...document.sections[1]!.iter_inner_content()].map(block => "text" in block ? block.text : "table")).toEqual(["second section"]);
  await verifyContainerBatch(input, [
    { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
    { operation: "model.section.Sections.__getitem__.get", receiver: { resultHandle: "sections" }, arguments: { index: 0 }, resultHandle: "first" },
    { operation: "model.section.Section.iter_inner_content.call", receiver: { resultHandle: "first" }, arguments: {} },
    { operation: "model.section.Sections.__len__.get", receiver: { resultHandle: "sections" }, arguments: {} }
  ], [[expect.objectContaining({ type: "Paragraph", owner: "document" })], 2]);
});

for (const strict of [false, true]) it.each(cases)(
  `reads $name through model, SDK and CLI without rewriting ${strict ? "Strict" : "Transitional"} markup`,
  async ({ body, texts, runs, hyperlink }) => {
    const input = await textFixture(body, {}, strict);
    const document = await Document(input, textContext);
    expect((await extractDocumentText(input, textContext)).text).toBe(texts.join("\n"));
    expect(document.paragraphs.map(p => p.text)).toEqual(texts);
    expect(document.paragraphs[0]!.runs.map(r => r.text)).toEqual(runs);
    expect(document.paragraphs[0]!.runs.flatMap(r => [...r.iter_inner_content()])).toEqual(runs);
    if (hyperlink) expect(document.paragraphs[0]!.hyperlinks[0]!.text).toBe(hyperlink);
    const operations = [
      { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
      ...texts.map((_, index) => ({ operation: "model.text.paragraph.Paragraph.text.get", receiver: { resultHandle: "paragraphs", index }, arguments: {} }))
    ];
    const batch = { version: 1, operations };
    const sdk = await applyStyleModelBatch(input, batch, textContext);
    expect(sdk.affected).toBe(0);
    expect(sdk.results.slice(1).map(result => result.value)).toEqual(texts);
    const files = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/saved.docx": "", "/stdout": "", "/stderr": "" });
    const cli = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["batch", "/input.docx", "--ops-json", JSON.stringify(batch), "--json"].map(word => new TextEncoder().encode(word)),
      cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(files.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { files.appendFileSync("/stdout", chunk); } },
      stderr: { async write(chunk) { files.appendFileSync("/stderr", chunk); } }
    });
    expect(cli.exitCode, files.readFileSync("/stderr", "utf8") as string).toBe(0);
    const result = JSON.parse(files.readFileSync("/stdout", "utf8") as string);
    expect(result.affected).toBe(0);
    expect(result.data.results.slice(1).map((item: { data: string }) => item.data)).toEqual(texts);
    expect(files.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    await document.save({ async write(chunk) { files.appendFileSync("/saved.docx", chunk); } });
    const saved = new Uint8Array(files.readFileSync("/saved.docx") as Buffer);
    const before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
    expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
    expect((await Document(saved, textContext)).paragraphs.map(p => p.text)).toEqual(texts);
  }
);
