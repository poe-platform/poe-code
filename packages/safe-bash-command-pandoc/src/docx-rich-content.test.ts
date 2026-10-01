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

it.each(["Strikeout", "Superscript", "Subscript"] as const)("preserves nested %s formatting and hyperlinks in DOCX", async t => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [{t: "Strong", c: [{t, c: [str("styled")]}]}], ["https://example.com", ""]]}]}], metadata: {}, resources: []}, {to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  const xml = new TextDecoder().decode(parts.get("word/document.xml"));
  new SaxesParser({xmlns: true}).write(xml).close();
  expect(xml).toContain(t === "Strikeout" ? '<w:strike/>' : `w:val="${t.toLowerCase()}"`);
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
