import {expect, it} from "vitest";
import {readFileSync} from "node:fs";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert, convertToOutput, readDocument, writeDocument} from "./engine.js";

const basic = '<p>BODY<sup><a id="ref" role="doc-noteref" href="#note">1</a></sup>.</p><section class="footnotes" role="doc-endnotes"><ol><li id="note"><p>NOTE BODY <strong>BOLD</strong>. <a role="doc-backlink" href="#ref">↩</a></p></li></ol></section>';
const input = (html: string) => ({bytes: new TextEncoder().encode(html)});
const read = (html: string, limits = {}) => readDocument(input(html), {from: "html"}, {limits, yield: async () => {}});

for (const workingFiles of [false, true]) {
  it(`maps semantic HTML footnotes through the normal Session flow (workingFiles=${workingFiles})`, async () => {
    const chunks: Uint8Array[] = [];
    await convertToOutput([input(basic)], {from: "html", to: "docx"}, {
      ...(workingFiles ? {workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384}} : {}),
      output: {async write(bytes) {chunks.push(bytes.slice());}, async close() {}, async abort() {}}
    });
    const parts = readZipArchiveEntries(Buffer.concat(chunks));
    const document = new TextDecoder().decode(parts.get("word/document.xml"));
    const notes = new TextDecoder().decode(parts.get("word/footnotes.xml"));
    expect(document.match(/<w:footnoteReference /g)).toHaveLength(1);
    expect(document).not.toContain("NOTE BODY");
    expect(notes).toContain("NOTE BODY"); expect(notes).toContain("BOLD"); expect(notes).toContain("<w:b/>");
    expect(notes).not.toContain("↩"); expect(notes.match(/w:val="superscript"/g)).toHaveLength(1);
    expect(notes).toContain('w:name="note"'); expect(document).toContain('w:name="ref"');
  });
}

it("consumes the separator and anchors from actual Pandoc HTML5 footnote structure", async () => {
  // Pandoc 2.19: pandoc -f markdown -t html5, input: Text[^1].\n\n[^1]: Note.
  const html = readFileSync(new URL("./fixtures/pandoc-html-footnotes.html", import.meta.url), "utf8");
  const document = await read(html);
  const serialized = JSON.stringify(document.blocks);
  expect(serialized).toContain('"t":"Note"'); expect(serialized).not.toContain('"t":"HorizontalRule"');
  expect(serialized).not.toContain('"t":"OrderedList"'); expect(serialized).not.toContain("↩");
  expect(serialized).toContain('"footnotes"');
});

it("preserves repeated rich note bodies, definition styling, links and unrelated lists", async () => {
  const html = '<p><a href="#inside">Jump</a><a role="doc-noteref" href="#note">1</a><a role="doc-noteref" href="#note">1</a></p><section role="doc-endnotes" style="color:#123456"><ol><li id="note"><p id="inside">First <strong>bold</strong>.</p><p>Second <a href="https://example.com">link</a>.</p></li></ol></section><ol><li>Ordinary</li></ol><p><a role="doc-backlink" href="#inside">ordinary backlink</a></p>';
  const document = await read(html), serialized = JSON.stringify(document.blocks);
  expect(serialized.match(/"t":"Note"/g)).toHaveLength(2);
  expect(serialized).toContain("color:#123456"); expect(serialized).toContain("doc-backlink"); expect(serialized).toContain("backlink");
  expect(document.blocks.at(-2)?.t).toBe("OrderedList");
  const result = await convert([input(html)], {from: "html", to: "docx"}, {});
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes), notes = new TextDecoder().decode(parts.get("word/footnotes.xml"));
  expect(notes.match(/<w:footnote w:id=/g)).toHaveLength(2); expect(notes).toContain('w:val="123456"');
  expect(notes.match(/w:name="inside"/g)).toHaveLength(1);
});

it.each([
  ["a%20b", "#a%20b"], ["a b", "#a%20b"], ["a+b", "#a+b"], ["�", "#%FF"],
  ["x%ZZé", "#x%ZZ%C3%A9"], ["\ufeffnote", "#%EF%BB%BFnote"], ["%20", "#%2520"]
])("resolves literal and once-decoded note ID %s from %s", async (id, href) => {
  const document = await read(`<p><a role="doc-noteref" href="${href}">1</a></p><section role="doc-endnotes"><ol><li id="${id}"><p>Note</p></li></ol></section>`);
  expect(JSON.stringify(document.blocks)).toContain('"t":"Note"');
});

it("prefers exact encoded IDs before decoding another definition", async () => {
  const document = await read('<p><a role="doc-noteref" href="#a%20b">1</a><a role="doc-noteref" href="#a b">2</a></p><section role="doc-endnotes"><ol><li id="a b"><p>DECODED</p></li><li id="a%20b"><p>LITERAL</p></li></ol></section>');
  const json = JSON.stringify(document.blocks);
  expect(json.indexOf("LITERAL")).toBeLessThan(json.indexOf("DECODED"));
});

it("uses data-heading only when a note definition has no id attribute", async () => {
  const html = '<p><a role="doc-noteref" href="#n">1</a></p><section role="doc-endnotes"><ol><li data-heading="n"><p>Note</p></li></ol></section>';
  expect(JSON.stringify((await read(html)).blocks)).toContain('"t":"Note"');
  await expect(read(html.replace('<li data-heading=', '<li id="" data-heading='))).rejects.toMatchObject({code: "E_PARSE", message: "HTML footnote definitions require list items with IDs"});
});

it("keeps nested acyclic notes in PDF and rejects unsupported Word nesting", async () => {
  const html = '<p>BODY<a role="doc-noteref" href="#outer">1</a></p><section role="doc-endnotes"><ol><li id="outer"><p>OUTER<a role="doc-noteref" href="#inner">2</a></p></li><li id="inner"><p>INNER</p></li></ol></section>';
  const document = await read(html);
  expect(JSON.stringify(document.blocks).match(/"t":"Note"/g)).toHaveLength(2);
  const pdf = await convert([input(html)], {from: "html", to: "pdf"}, {});
  if (pdf.kind !== "binary") throw new Error("Expected PDF");
  const plain = await writeDocument(await readDocument({bytes: pdf.bytes}, {from: "pdf"}, {}), {to: "plain"}, {});
  if (plain.kind !== "text") throw new Error("Expected text");
  for (const token of ["BODY", "OUTER", "INNER"]) expect(plain.text).toContain(token);
  let published = false;
  await expect(convert([input(html)], {from: "html", to: "docx"}, {output: {async publish() {published = true;}}})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(published).toBe(false);
});

it.each([
  '<p><a role="doc-noteref" href="#missing">1</a></p>',
  '<p><a role="doc-noteref" href="https://example.com/note">1</a></p>',
  '<p><a role="doc-noteref" href="#n">1</a></p><section role="doc-endnotes"><p>Stray text</p><ol><li id="n">Note</li></ol></section>',
  '<p><a role="doc-noteref" href="#n">1</a></p><section role="doc-endnotes"><ol><li id="n">A</li><li id="n">B</li></ol></section>',
  '<p><a role="doc-noteref" href="#n">1</a></p><section role="doc-endnotes"><ol><li id="n"><a role="doc-noteref" href="#n">cycle</a></li></ol></section>',
  '<section role="doc-endnotes"><ol><li id="unused">Not referenced</li></ol></section>',
  '<p><a role="doc-noteref" href="#%2520">1</a></p><section role="doc-endnotes"><ol><li id=" ">No double decoding</li></ol></section>'
])("rejects malformed or unresolved note markup instead of losing content", async html => {
  await expect(read(html)).rejects.toMatchObject({code: "E_PARSE", format: "html"});
});

it("bounds repeated expansion before publishing an output or resolving resources", async () => {
  const reference = '<a role="doc-noteref" href="#n">1</a>';
  const html = `<p>${reference.repeat(20)}</p><section role="doc-endnotes"><ol><li id="n"><p>${'<strong>word</strong> '.repeat(20)}</p><img src="image.png"></li></ol></section>`;
  let resolved = false, published = false;
  await expect(convert([input(html)], {from: "html", to: "docx"}, {limits: {nodes: 300}, resources: {async resolve() {resolved = true; throw new Error("Unexpected resource lookup");}}, output: {async publish() {published = true;}}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(resolved).toBe(false); expect(published).toBe(false);
});

it("keeps filters and embedded image admission on the existing Session path", async () => {
  const html = '<p><a role="doc-noteref" href="#n">1</a><a role="doc-noteref" href="#n">1</a></p><section role="doc-endnotes"><ol><li id="n"><p>Image <img src="pixel.bmp"></p></li></ol></section>';
  const image = new Uint8Array(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/html-images/pixel.bmp", import.meta.url)));
  let filtered = false;
  const result = await convert([input(html)], {from: "html", to: "docx", filters: [{kind: "json", path: "/filter"}]}, {
    filters: {async apply(document) {expect(JSON.stringify(document.blocks).match(/"t":"Note"/g)).toHaveLength(2); filtered = true; return document;}},
    resources: {async resolve(id) {expect(filtered).toBe(true); expect(id).toBe("pixel.bmp"); return image;}}
  });
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  expect([...parts.keys()].filter(name => name.startsWith("word/media/"))).toHaveLength(1);
  expect(new TextDecoder().decode(parts.get("word/footnotes.xml")).match(/<w:drawing(?:\s|>)/g)).toHaveLength(2);
  await expect(convert([input(html)], {from: "html", to: "docx"}, {limits: {images: 1}, resources: {async resolve() {return image;}}})).rejects.toMatchObject({code: "E_LIMIT"});
});

it("preserves semantic emphasis from definition ancestors", async () => {
  const html = '<p><a role="doc-noteref" href="#n">1</a></p><strong><section role="doc-endnotes"><ol><li id="n"><p>Inherited</p></li></ol></section></strong>';
  const result = await convert([input(html)], {from: "html", to: "docx"}, {});
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes), notes = new TextDecoder().decode(parts.get("word/footnotes.xml"));
  expect(notes).toContain("Inherited"); expect(notes).toContain("<w:b/>");
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).not.toContain("Inherited");
});

it.each(["pre", "code", "tt", "samp", "var", "kbd", "math", "svg"])("rejects a real note reference inside literal %s content", async tag => {
  await expect(read(`<${tag}><a role="doc-noteref" href="#n">1</a></${tag}><section role="doc-endnotes"><ol><li id="n"><p>Must not disappear</p></li></ol></section>`)).rejects.toMatchObject({code: "E_PARSE", message: "HTML footnote markup inside literal content is unsupported"});
});

it("keeps escaped note markup as ordinary code text", async () => {
  const document = await read('<pre><code>&lt;a role="doc-noteref" href="#missing"&gt;1&lt;/a&gt;</code></pre>');
  expect(document.blocks).toEqual([{t: "CodeBlock", c: [["", [], []], '<a role="doc-noteref" href="#missing">1</a>']}]);
});
