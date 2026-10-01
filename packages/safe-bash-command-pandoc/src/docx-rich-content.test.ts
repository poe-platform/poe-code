import "docx";
import {expect, it} from "vitest";
import {encode as jpeg} from "jpeg-js";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {SaxesParser} from "saxes";
import {createMemoryFileSystem} from "@poe-code/safe-fs/core";
import {toByteSource} from "safe-bash-contracts/io";
import {createPandocCommand} from "./command.js";
import {convert, writeDocument} from "./engine.js";
import type {Inline} from "./ast-types.js";
const context = {yield: async () => {}};
const attr = ["", [], []] as const;
const str = (c: string): Inline => ({t: "Str", c});

it.each(["Strikeout", "Superscript", "Subscript", "Underline"] as const)("preserves nested %s formatting and hyperlinks in DOCX", async t => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [{t: "Strong", c: [{t, c: [str("styled")]}]}], ["https://example.com", ""]]}]}], metadata: {}, resources: []}, {to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  const xml = new TextDecoder().decode(parts.get("word/document.xml"));
  new SaxesParser({xmlns: true}).write(xml).close();
  expect(xml).toContain(t === "Strikeout" ? '<w:strike/>' : t === "Underline" ? '<w:u ' : `w:val="${t.toLowerCase()}"`);
  expect(xml).toContain("w:hyperlink");
  expect(xml).toContain("styled");
  expect(xml).toContain("w:b");
});
it("resolves local images through the CLI and preserves output when an image limit is exceeded", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input.md", new TextEncoder().encode("Before ![fruit](fruit.jpg) after."));
  await fs.writeFile("/work/fruit.jpg", new Uint8Array(jpeg({width: 2, height: 1, data: Buffer.alloc(8, 255)}, 80).data));
  const errors: string[] = [];
  const execution = {command: "pandoc", args: ["input.md", "-o", "output.docx"], cwd: "/work", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}},
    stderr: {async write(bytes: Uint8Array) {errors.push(new TextDecoder().decode(bytes));}}};
  expect(await createPandocCommand().execute(execution), errors.join("")).toMatchObject({exitCode: 0});
  const original = await fs.readFile("/work/output.docx");
  expect([...readZipArchiveEntries(original).keys()].some(name => name.startsWith("word/media/"))).toBe(true);
  expect((await createPandocCommand({limits: {images: 0}}).execute(execution)).exitCode).not.toBe(0);
  expect(await fs.readFile("/work/output.docx")).toEqual(original);
});
it("writes typographic quotation marks in DOCX", async () => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Quoted", c: ["DoubleQuote", [str("quotation")]]}]}], metadata: {}, resources: []}, {to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  expect(new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"))).toContain("quotation");
  const plain = await convert([{bytes: result.bytes}], {from: "docx", to: "plain"}, context);
  expect(plain).toMatchObject({text: "“quotation”\n"});
});
it("embeds an inline image with alt text, dimensions and a valid relationship inside a table", async () => {
  const bytes = new Uint8Array(jpeg({width: 2, height: 1, data: Buffer.alloc(8, 255)}, 80).data);
  const result = await writeDocument({blocks: [{t: "Div", c: [attr, [{t: "Table", c: [attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], [[attr, [[attr, "AlignDefault", 1, 1, [{t: "Para", c: [str("before"), {t: "Image", c: [["", [], [["width", "1in"]]], [str("Apple & pear")], ["fruit.jpg", "Photo"]]}, str("after")]}]]]]]]], [attr, []]]}]]}], metadata: {}, resources: [{id: "fruit.jpg", bytes}]}, {to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  const xml = new TextDecoder().decode(parts.get("word/document.xml"));
  new SaxesParser({xmlns: true}).write(xml).close();
  expect(xml).toContain('descr="Apple &amp; pear"');
  expect(xml).toContain('cx="914400" cy="457200"');
  expect(xml.indexOf("before")).toBeLessThan(xml.indexOf("w:drawing"));
  expect(xml.indexOf("w:drawing")).toBeLessThan(xml.indexOf("after"));
  expect([...parts].filter(([name]) => name.startsWith("word/media/")).map(([, data]) => data)).toEqual([bytes]);
  const relationships = new TextDecoder().decode(parts.get("word/_rels/document.xml.rels"));
  expect(relationships).toContain("/image");
  expect(new TextDecoder().decode(parts.get("[Content_Types].xml"))).toContain("image/jpeg");
});

it('writes lists, quotes, rules, tables and divs without dropping their content', async () => {
  const markdown = '# Title\n\n- bullet\n\n3. numbered\n\n> quotation\n\n---\n\n| Name | Value |\n| --- | --- |\n| [link](https://example.com) | ~~old~~ |\n';
  const result = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: 'markdown', to: 'docx'}, context);
  if (result.kind !== 'binary') throw new Error('Expected DOCX');
  const parts = readZipArchiveEntries(result.bytes);
  const xml = new TextDecoder().decode(parts.get('word/document.xml'));
  new SaxesParser({xmlns: true}).write(xml).close();
  for (const fragment of ['Title', 'bullet', 'numbered', 'quotation', 'w:numPr', 'w:pBdr', 'w:tbl', 'w:hyperlink', 'w:strike']) expect(xml).toContain(fragment);
  const numbering = new TextDecoder().decode(parts.get('word/numbering.xml'));
  expect(numbering).toContain('w:val="bullet"');
  expect(numbering).toContain('w:val="decimal"');
  expect(numbering).toContain('w:start w:val="3"');
  const div = await writeDocument({blocks: [{t: 'Div', c: [attr, [{t: 'Para', c: [str('contained')]}]]}], metadata: {}, resources: []}, {to: 'docx'}, context);
  if (div.kind !== 'binary') throw new Error('Expected DOCX');
  expect(new TextDecoder().decode(readZipArchiveEntries(div.bytes).get('word/document.xml'))).toContain('contained');
});

it("round trips inline code, including spaces, nested styles and linked code", async () => {
  const blocks = [{t: "Para" as const, c: [
    {t: "Code" as const, c: [attr, "a b < c"] as const},
    {t: "Strong" as const, c: [{t: "Code" as const, c: [attr, "bold code"] as const}]},
    {t: "Link" as const, c: [attr, [{t: "Code" as const, c: [attr, "linked code"] as const}], ["https://example.com", ""]] as const}
  ]}];
  const output = await writeDocument({blocks, metadata: {}, resources: []}, {to: "docx"}, context);
  if(output.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(output.bytes);
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain('w:rStyle w:val="VerbatimChar"');
  expect(new TextDecoder().decode(parts.get("word/styles.xml"))).toContain('w:styleId="VerbatimChar"');
  const result = await convert([{bytes: output.bytes}], {from: "docx", to: "json"}, context);
  if(result.kind !== "text") throw new Error("Expected JSON");
  expect(JSON.parse(result.text).blocks).toEqual(blocks);
});
it("splits DOCX text runs into literal words, spaces and line breaks", async () => {
  const output = await writeDocument({blocks: [{t: "Para", c: [{t: "Emph", c: [str("two  words\nnext *literal*")]}]}], metadata: {}, resources: []}, {to: "docx"}, context);
  if(output.kind !== "binary") throw new Error("Expected DOCX");
  const result = await convert([{bytes: output.bytes}], {from: "docx", to: "json"}, context);
  if(result.kind !== "text") throw new Error("Expected JSON");
  expect(JSON.parse(result.text).blocks).toEqual([{t: "Para", c: [{t: "Emph", c: [str("two"), {t: "Space"}, {t: "Space"}, str("words"), {t: "LineBreak"}, str("next"), {t: "Space"}, str("*literal*")]}]}]);
});
