import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, table, textContext, textFixture } from "../tests/fixtures/text.js";

async function remove(body: string, operation: "paragraphs.remove" | "runs.remove" | "tables.remove", options: Record<string, unknown>, strict = false) {
  const input = await textFixture(body, {}, strict);
  const fs = Volume.fromJSON({ "/out": "" });
  const data = await docx.removeDocumentContent(input, { operation, options: { output: "-", ...options } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes: Uint8Array) { fs.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(fs.readFileSync("/out") as Uint8Array);
  const xml = new TextDecoder().decode(await docx.getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  return { data, bytes, xml, text: (await docx.extractDocumentText(bytes, textContext)).text };
}
async function range(body: string, start: number, end: number, kind: "paragraph" | "run" = "paragraph") {
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  return document.range(document.at(kind, 1, kind === "run" ? { owner: document.at("paragraph", 1).token } : {}).token, start, end).token;
}

it.each([false, true])("removes only the selected paragraph and retains its neighbors (%s)", async strict => {
  const result = await remove(paragraph("North") + paragraph("Discard") + paragraph("South"), "paragraphs.remove", { paragraph: 2 }, strict);
  expect(result.text).toBe("North\nSouth");
  expect(result.data.changes).toMatchObject([{ kind: "remove", after: null }]);
});
it("removes scalar endpoints across formatted runs and retains exact suffix properties", async () => {
  const body = '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>🌊abc</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>def 海</w:t></w:r></w:p>';
  const result = await remove(body, "paragraphs.remove", { select: await range(body, 1, 6), markers: "exclude" });
  expect(result.text).toBe("🌊f 海");
  expect(result.xml).toContain('<w:rPr><w:b/></w:rPr>');
  expect(result.xml).toContain('<w:rPr><w:i/></w:rPr>');
  expect(result.xml).toContain('<w:keepNext/>');
  expect(result.data.changes[0]?.after?.value.range).toEqual({ start: 1, end: 1 });
});
it("removes run-local scalar text without deleting its properties or neighboring runs", async () => {
  const body = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>abcd</w:t></w:r>' + run(" tail") + '</w:p>';
  const result = await remove(body, "runs.remove", { select: await range(body, 1, 3, "run"), markers: "exclude" });
  expect(result.text).toBe("ad tail");
  expect(result.xml).toContain('<w:rPr><w:b/></w:rPr>');
});
it("removes a whole run while retaining the paragraph and remaining formatting", async () => {
  const result = await remove('<w:p>' + run("Old") + '<w:r><w:rPr><w:i/></w:rPr><w:t>Keep</w:t></w:r></w:p>', "runs.remove", { paragraph: 1, run: 1 });
  expect(result.text).toBe("Keep");
  expect(result.xml).toContain('<w:rPr><w:i/></w:rPr>');
});
it("preserves paragraph-owned section breaks in empty retained paragraphs", async () => {
  const body = '<w:p><w:pPr><w:sectPr><w:cols w:num="2"/></w:sectPr></w:pPr>' + run("Remove") + '</w:p>' + paragraph("After");
  const result = await remove(body, "paragraphs.remove", { paragraph: 1 });
  expect(result.text).toBe("\nAfter");
  expect(result.xml).toContain('<w:pPr><w:sectPr><w:cols w:num="2"/></w:sectPr></w:pPr>');
});
it("retains a required terminal empty cell paragraph", async () => {
  const body = table([paragraph("Cell")]);
  const result = await remove(body, "paragraphs.remove", { table: 1, cell: "A1", paragraph: 1 });
  const document = await docx.openDocumentLocations(result.bytes, textContext);
  expect(document.list("paragraph")).toHaveLength(1);
  expect(result.text).toBe("");
});
it("removes a complete table with exact surrounding paragraph content", async () => {
  const result = await remove(paragraph("Before") + table([paragraph("Cell")]) + paragraph("After"), "tables.remove", { table: 1 });
  expect(result.text).toBe("Before\nAfter");
  expect(result.xml).not.toContain('<w:tbl>');
});
it("retains a valid body paragraph when all paragraphs are selected", async () => {
  const result = await remove(paragraph("First") + paragraph("Second"), "paragraphs.remove", { all: true });
  expect(result.text).toBe("");
  expect((await docx.openDocumentLocations(result.bytes, textContext)).list("paragraph")).toHaveLength(1);
});
it.each(["exclude", "include"] as const)("applies explicit inclusion to proof markers at range endpoints: %s", async markers => {
  const body = '<w:p><w:proofErr w:type="spellStart"/>' + run("word") + '<w:proofErr w:type="spellEnd"/>' + run(" tail") + '</w:p>';
  const result = await remove(body, "paragraphs.remove", { select: await range(body, 0, 4), markers });
  expect(result.text).toBe(" tail");
  expect(result.xml.includes('<w:proofErr')).toBe(markers === "exclude");
});
it("requires explicit marker inclusion for ranges", async () => {
  const body = paragraph("word");
  await expect(remove(body, "paragraphs.remove", { select: await range(body, 0, 4) })).rejects.toThrow();
});
it.each([
  '<w:bookmarkStart w:id="1" w:name="Anchor"/>' + run("word") + '<w:bookmarkEnd w:id="1"/>',
  '<w:fldSimple w:instr="DATE">' + run("word") + '</w:fldSimple>',
  '<w:ins w:id="1" w:author="Editor">' + run("word") + '</w:ins>',
  '<w:r><w:footnoteReference w:id="1"/></w:r>'
])("rejects affected annotation, field, revision or note structures before output", async content => {
  const input = await textFixture('<w:p>' + content + '</w:p>');
  let writes = 0;
  await expect(docx.removeDocumentContent(input, { operation: "paragraphs.remove", options: { paragraph: 1, output: "-" } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { writes++; } }
  })).rejects.toThrow();
  expect(writes).toBe(0);
});
it("rejects removal inside a cross-paragraph bookmark", async () => {
  const body = '<w:p><w:bookmarkStart w:id="1" w:name="Anchor"/>' + run("Before") + '</w:p>' + paragraph("Inside") + '<w:p>' + run("After") + '<w:bookmarkEnd w:id="1"/></w:p>';
  await expect(remove(body, "paragraphs.remove", { paragraph: 2 })).rejects.toThrow();
});
it("dry-run performs the same safety checks without writing", async () => {
  const input = await textFixture(paragraph("Keep") + paragraph("Remove"));
  let writes = 0;
  const result = await docx.removeDocumentContent(input, { operation: "paragraphs.remove", options: { paragraph: 2, dryRun: true } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { writes++; } }
  });
  expect(result.changed).toBe(true); expect(result.output).toBeNull(); expect(writes).toBe(0);
});
it("retains paragraph properties when the cell needs an empty paragraph", async () => {
  const body = table(['<w:p><w:pPr><w:keepNext/></w:pPr>' + run("Cell") + '</w:p>']);
  const result = await remove(body, "paragraphs.remove", { table: 1, cell: "A1", paragraph: 1 });
  expect(result.text).toBe(""); expect(result.xml).toContain('<w:keepNext/>');
});
it("reports an unchanged required empty paragraph as a no-op", async () => {
  const result = await remove('<w:p/>', "paragraphs.remove", { paragraph: 1 });
  expect(result.data.changed).toBe(false); expect(result.data.changes).toEqual([]);
});
it("rejects a run owned by a complex field spanning paragraphs", async () => {
  const body = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>DATE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>' + paragraph("Cached") + '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  await expect(remove(body, "runs.remove", { paragraph: 2, run: 1 })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects story and cell scalar endpoints instead of flattening their paragraphs", async () => {
  const input = await textFixture(paragraph("First") + table([paragraph("Cell")]));
  const document = await docx.openDocumentLocations(input, textContext);
  for (const location of [document.list("story")[0]!, document.cell(document.at("table", 1).token, "A1")]) {
    const value = { ...location.value, range: { start: 0, end: 2 } };
    await expect(docx.removeDocumentContent(input, { operation: "paragraphs.remove", options: { select: docx.encodeLocation(value), markers: "include", dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "stale-selection" });
  }
});
it("advertises precise removal schema and bounded capabilities", () => {
  const args = ["schema", "paragraphs", "remove", "--json"].map(s => new TextEncoder().encode(s));
  const discovery = docx.getDocxDiscovery(docx.parseDocxArguments(args));
  expect((discovery!.data as docx.DocxSchemaData).operations[0]).toMatchObject({ id: "paragraphs.remove", support: "edit", featureIds: ["F44"] });
  expect(docx.getDocxOperationSchema("paragraphs.remove").properties?.markers).toMatchObject({ enum: ["exclude", "include"] });
});
it("retains every shared media byte and relationship during unrelated run removal", async () => {
  const { replacementFixture, replacementContext } = await import("../tests/fixtures/image-replacement.js");
  const setup = Volume.fromJSON({ "/out": "" });
  await docx.editDocumentParagraphs(await replacementFixture(), { operation: "runs.add", options: { paragraph: 1, text: "Discard", output: "-" } }, {
    ...replacementContext, stdout: { async write(bytes) { setup.appendFileSync("/out", bytes); } }
  });
  const input = new Uint8Array(setup.readFileSync("/out") as Uint8Array);
  const document = await docx.openDocumentLocations(input, textContext);
  const runs = document.list("run", { owner: document.at("paragraph", 1).token });
  const fs = Volume.fromJSON({ "/out": "" });
  await docx.removeDocumentContent(input, { operation: "runs.remove", options: { select: runs.at(-1)!.token, output: "-" } }, {
    ...replacementContext, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(fs.readFileSync("/out") as Uint8Array);
  expect((await docx.openDocumentLocations(bytes, textContext)).list("image")).toHaveLength(2);
  const before = await docx.readDocumentArchive(input, textContext), after = await docx.readDocumentArchive(bytes, textContext);
  for (const member of before.members.filter(m => m.name !== "word/document.xml")) expect(after.members.find(m => m.name === member.name)?.bytes).toEqual(member.bytes);
  let writes = 0;
  const image = document.list("image")[0]!;
  const owner = document.list("paragraph").find(p => p.value.path.every((i, n) => image.value.path[n] === i))!;
  await expect(docx.removeDocumentContent(input, { operation: "paragraphs.remove", options: { select: owner.token, output: "-" } }, {
    ...replacementContext, stdout: { async write() { writes++; } }
  })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(writes).toBe(0);
});
it.each(["footnote", "endnote"])("rejects referenced note deletion without touching its body: %s", async kind => {
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const input = await textFixture('<w:p>' + run("Keep") + `<w:r><w:${kind}Reference w:id="1"/></w:r></w:p>`, {
    [kind + "s"]: { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="1">${paragraph("Original note")}</w:${kind}></w:${kind}s>` }
  });
  await docx.openDocumentLocations(input, textContext);
  await expect(docx.removeDocumentContent(input, { operation: "paragraphs.remove", options: { paragraph: 1, dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects deletion of a valid classic comment range and body", async () => {
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const input = await textFixture('<w:p><w:commentRangeStart w:id="1"/>' + run("Review") + '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="1" w:author="Mira">${paragraph("Retain comment")}</w:comment></w:comments>` }
  });
  await docx.openDocumentLocations(input, textContext);
  await expect(docx.removeDocumentContent(input, { operation: "paragraphs.remove", options: { paragraph: 1, dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("reports the surviving required paragraph with fresh path and display positions", async () => {
  const result = await remove(paragraph("First") + paragraph("Last"), "paragraphs.remove", { all: true });
  const after = result.data.changes.at(-1)!.after!;
  expect(after.value.path).toEqual([0, 0]);
  expect(after.positions?.paragraph).toBe(1);
});
it.each(["paragraphs", "runs", "tables"])("keeps removal help readable at ordinary terminal widths: %s", resource => {
  const args = [resource, "remove", "--help"].map(s => new TextEncoder().encode(s));
  const help = docx.getDocxDiscovery(docx.parseDocxArguments(args))!.human;
  expect(help.split("\n").every(line => line.length <= 140)).toBe(true);
});
