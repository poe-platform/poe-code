import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

it("stages owned XML subtree replacements with validation and opaque guards", () => {
  const editor = new docx.DocumentXmlEditor(new TextEncoder().encode(`<w:p xmlns:w="${w}"><w:r><w:t>coast</w:t></w:r></w:p>`));
  const node = editor.root.children[0]!.children[0]!;
  expect(editor.sourceXml(node)).toBe("<w:t>coast</w:t>");
  expect(() => editor.replaceElement(node, '<w:t>broken')).toThrow();
  editor.replaceElement(node, '<w:t xml:space="preserve"> shore </w:t>');
  expect(new TextDecoder().decode(editor.serialize())).toBe(`<w:p xmlns:w="${w}"><w:r><w:t xml:space="preserve"> shore </w:t></w:r></w:p>`);
});

async function replace(body: string, options: Record<string, unknown> = {}, strict = false) {
  const input = await textFixture(body, {}, strict);
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.replaceDocumentText(input, { find: "coast", with: "shore", all: true, output: "-", ...options }, {
    ...textContext, encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const text = await docx.extractDocumentText(bytes, textContext, { view: "all" });
  const xml = new TextDecoder().decode(await docx.getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  return { data, text, xml, bytes, input };
}

it("replaces across runs while preserving exact outside text and direct properties", async () => {
  const body = '<w:p><w:pPr><w:bidi/></w:pPr><w:r w:rsidR="00ABCDEF"><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>Pre co</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>ast tail</w:t></w:r></w:p>';
  const result = await replace(body);
  expect(result.text.text).toBe("Pre shore tail");
  expect(result.text.segments.map(s => [s.text, s.formatting.bold, s.formatting.italic])).toEqual([["Pre shore", true, null], [" tail", null, true]]);
  expect(result.xml).toContain('<w:color w:val="123456"/>');
  expect(result.xml).toContain('w:rsidR="00ABCDEF"');
  expect(result.data.changes).toHaveLength(1);
  expect(result.data.changes[0]!.after.value.generation).toBe(1);
});

it.each([false, true])("handles deletion, spaces, controls and Unicode in dialect %s", async strict => {
  const deleted = await replace(paragraph("coastcoast"), { with: "" }, strict);
  expect(deleted.text.text).toBe("");
  expect(deleted.xml).toContain("<w:p>");
  const result = await replace(paragraph("🌊coast海"), { with: " é\t北\n南\r! " }, strict);
  expect(result.text.text).toBe("🌊 é\t北\n南\n! 海");
  expect(result.xml).toContain('xml:space="preserve"');
  expect(result.xml).toContain("<w:tab");
  expect(result.xml).toContain("<w:br");
});

it("selects nonoverlapping matches left to right from original text only", async () => {
  expect((await replace(paragraph("aaaaa"), { find: "aa", with: "aaa" })).text.text).toBe("aaaaaaa");
  expect((await replace(paragraph("coast coast") + paragraph("coast"), { all: undefined, occurrence: 2 })).text.text).toBe("coast shore\ncoast");
  expect((await replace(paragraph("coast coast"), { all: undefined, first: true })).text.text).toBe("shore coast");
});

it.each([
  '<w:r><w:t>co</w:t><w:drawing/><w:t>ast</w:t></w:r>',
  run("co") + '<w:hyperlink w:anchor="local">' + run("ast") + '</w:hyperlink>',
  run("co") + '<w:ins w:id="1" w:author="Editor">' + run("ast") + '</w:ins>',
  run("co") + '<w:del w:id="2" w:author="Editor"><w:r><w:delText>old</w:delText></w:r></w:del>' + run("ast"),
  run("co") + '<w:fldSimple w:instr="PAGE">' + run("ast") + '</w:fldSimple>',
  run("co") + '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>ast</w:t><w:fldChar w:fldCharType="end"/></w:r>',
  run("co") + '<w:sdt><w:sdtContent>' + run("ast") + '</w:sdtContent></w:sdt>'
])("does not bridge structural barriers: %s", async content => {
  await expect(replace(`<w:p>${content}</w:p>`)).rejects.toMatchObject({ code: "missing-selection" });
  expect((await replace(`<w:p>${content}</w:p>`, { allowEmpty: true })).data.changed).toBe(false);
});

it("matches within a container and preserves revision views", async () => {
  const body = '<w:p><w:hyperlink w:anchor="local">' + run("co") + run("ast") + '</w:hyperlink><w:ins w:id="1" w:author="Editor">' + run("coast") + '</w:ins><w:del w:id="2" w:author="Editor"><w:r><w:delText>coast</w:delText></w:r></w:del></w:p>';
  const result = await replace(body);
  expect(result.text.text).toBe("shoreshorecoast");
  expect((await replace(body, { view: "original" })).text.text).toBe("shorecoastshore");
});

it("requires cardinality and rejects missing occurrences unless allowEmpty is explicit", async () => {
  for (const options of [{ all: undefined }, { first: true }, { occurrence: 1 }, { find: "" }, { with: "\ud800" }])
    await expect(replace(paragraph("coast"), options)).rejects.toBeDefined();
  await expect(replace(paragraph("coast"), { all: undefined, occurrence: 2 })).rejects.toMatchObject({ code: "missing-selection" });
  expect((await replace(paragraph("coast"), { all: undefined, occurrence: 2, allowEmpty: true })).data.changed).toBe(false);
});

it("uses checked Unicode scalar ranges and rejects stale selections", async () => {
  const input = await textFixture(paragraph("🌊coast coast"));
  const document = await docx.openDocumentLocations(input, textContext);
  const selected = document.range(document.at("paragraph", 1).token, 1, 6);
  expect((await replace(paragraph("🌊coast coast"), { select: selected.token })).text.text).toBe("🌊shore coast");
  await expect(replace(paragraph("different coast"), { select: selected.token })).rejects.toMatchObject({ code: "stale-selection" });
  expect(() => document.range(document.at("paragraph", 1).token, 0, Number.MAX_SAFE_INTEGER)).toThrow();
});

it("supports explicit formatting without changing surviving fragments", async () => {
  const result = await replace('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>pre coast tail</w:t></w:r></w:p>', { bold: false, italic: true });
  expect(result.text.segments.map(s => [s.text, s.formatting.bold, s.formatting.italic])).toEqual([["pre ", true, null], ["shore", false, true], [" tail", true, null]]);
});

it("preserves untouched XML, including comments and custom prefixes", async () => {
  const result = await replace('<w:p><!--keep--><w:r><w:rPr><w:i/></w:rPr><w:t>coast</w:t></w:r><q:r xmlns:q="' + w + '"><q:t> suffix</q:t></q:r></w:p>');
  expect(result.xml).toContain('<!--keep-->');
  expect(result.xml).toContain('<q:r xmlns:q="' + w + '"><q:t> suffix</q:t></q:r>');
  expect(result.text.text).toBe("shore suffix");
});

it("leaves identical substitutions byte-exact with no changed generation", async () => {
  const result = await replace(paragraph("coast"), { with: "coast" });
  expect(result.data).toMatchObject({ changed: false, changes: [] });
  expect(await docx.getDocumentXml(result.bytes, textContext, { part: "/word/document.xml", raw: true }))
    .toEqual(await docx.getDocumentXml(result.input, textContext, { part: "/word/document.xml", raw: true }));
});

it("still inherits first-run formatting when equal text spans unlike runs", async () => {
  const result = await replace('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>co</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>ast</w:t></w:r></w:p>', { with: "coast" });
  expect(result.text.segments.map(s => [s.text, s.formatting.bold, s.formatting.italic])).toEqual([["coast", true, null]]);
  expect(result.data.changed).toBe(true);
});

it("refuses matching edits inside locked controls", async () => {
  const body = '<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' + run("coast") + '</w:sdtContent></w:sdt></w:p>';
  await expect(replace(body)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("keeps locally declared formatting namespaces when splitting a run", async () => {
  const body = `<w:p><w:r><w:rPr xmlns:q="${w}"><q:b/><q:color q:val="224466"/></w:rPr><w:t>coast</w:t></w:r></w:p>`;
  const result = await replace(body, { italic: true });
  expect(result.text.segments.map(s => [s.text, s.formatting.bold, s.formatting.italic])).toEqual([["shore", true, true]]);
  expect(result.xml).toContain('q:color q:val="224466"');
});

it("uses owned XML positions when comments contain text-node markup", async () => {
  const result = await replace('<w:p><w:r><!--<w:t>coast</w:t>--><w:t>coast</w:t></w:r></w:p>', { italic: true });
  expect(result.text.segments.map(s => [s.text, s.formatting.italic])).toEqual([["shore", true]]);
  expect(result.xml).toContain('<!--<w:t>coast</w:t>-->');
});

it("matches tabs and line breaks across runs without flattening outside controls", async () => {
  const body = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> A </w:t><w:tab/></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>B</w:t><w:br/><w:t>C</w:t><w:tab/><w:t>tail</w:t></w:r></w:p>';
  const result = await replace(body, { find: "A \tB\nC", with: "shore" });
  expect(result.text.segments.map(s => [s.text, s.formatting.bold, s.formatting.italic])).toEqual([[" shore", true, null], ["\t", null, true], ["tail", null, true]]);
});

it("keeps cached field instructions and cannot match across paragraph or selected-run edges", async () => {
  const body = '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> MERGEFIELD coast </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>coast</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const result = await replace(body);
  expect(result.text.text).toBe("shore");
  expect(result.xml).toContain('<w:instrText xml:space="preserve"> MERGEFIELD coast </w:instrText>');
  await expect(replace(paragraph("co") + paragraph("ast"), { find: "co\nast" })).rejects.toMatchObject({ code: "missing-selection" });
  await expect(replace('<w:p>' + run("co") + run("ast") + '</w:p>', { paragraph: 1, run: 1 })).rejects.toMatchObject({ code: "missing-selection" });
});

it("honors scalar ranges relative to selected runs", async () => {
  const body = '<w:p>' + run("earlier") + run("🌊coast coast") + '</w:p>';
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const paragraph = document.at("paragraph", 1);
  const selected = document.range(document.at("run", 2, { owner: paragraph.token }).token, 7, 12);
  expect((await replace(body, { select: selected.token })).text.text).toBe("earlier🌊coast shore");
});

it("refuses unsafe moves, shared stories and opaque matches", async () => {
  await expect(replace('<w:p><w:moveTo w:id="3" w:author="Editor">' + run("coast") + '</w:moveTo></w:p>')).rejects.toMatchObject({ code: "unsupported-edit" });
  const input = await textFixture(paragraph("body") + '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="head"/></w:sectPr></w:pPr></w:p><w:sectPr/>', {
    head: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("coast")}</w:hdr>` }
  });
  await expect(docx.replaceDocumentText(input, { find: "coast", with: "shore", all: true, scope: "headers", dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "ambiguous-selection" });
  const body = `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:opaque" mc:Ignorable="x">${run("co")}<x:marker/>${run("ast")}</w:p>`;
  await expect(replace(body)).rejects.toMatchObject({ code: "missing-selection" });
});

it("isolates unsupported formatting revisions from neighboring runs", async () => {
  const body = '<w:p>' + run("co") + '<w:r><w:rPr><w:rPrChange w:id="7" w:author="Editor"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>ast</w:t></w:r></w:p>';
  await expect(replace(body)).rejects.toMatchObject({ code: "missing-selection" });
  await expect(replace(body, { find: "ast" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects exhausted output and match budgets before writing any bytes", async () => {
  const input = await textFixture(paragraph("coast coast"));
  for (const limit of [{ name: "matches" as const, value: 0 }, { name: "serializedOutput" as const, value: 1 }]) {
    let writes = 0;
    await expect(docx.replaceDocumentText(input, { find: "coast", with: "shore", all: true, output: "-", limit: [limit] }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { writes++; } }
    })).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(writes).toBe(0);
  }
});

it("admits the complete JSON result including its transport newline", async () => {
  const input = await textFixture(paragraph("coast"));
  const options = { find: "coast", with: "shore", first: true, dryRun: true, json: true } as const;
  const context = { ...textContext, encoding: { order: "input", compression: "store" } } as const;
  const data = await docx.replaceDocumentText(input, options, context);
  const envelope = JSON.stringify({ version: 1, operation: "text.replace", ok: true, data, affected: data.changes.length,
    locations: data.changes.map(change => change.after), warnings: [], errors: [] }) + "\n";
  await expect(docx.replaceDocumentText(input, { ...options, limit: [{ name: "serializedOutput", value: new TextEncoder().encode(envelope).length - 1 }] }, context))
    .rejects.toMatchObject({ code: "limit-exceeded" });
});
