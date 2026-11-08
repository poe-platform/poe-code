import "safe-bash-docx-engine";
import {expect, it} from "vitest";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {SaxesParser} from "saxes";
import {convert} from "./engine.js";

it("writes distinct DOCX footnotes with formatted blocks and note relationships", async () => {
  const markdown = "Text with a note[^1] and another[^2].\n\n[^1]: Footnote **text**.\n\n    Second paragraph with [link](https://example.com).\n\n[^2]: Other note.\n";
  const result = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: "markdown", to: "docx"}, {});
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  const xml = (name: string) => {
    expect(parts.has(name), name).toBe(true);
    const text = new TextDecoder().decode(parts.get(name));
    new SaxesParser({xmlns: true}).write(text).close();
    return text;
  };
  const main = xml("word/document.xml");
  expect(main).toContain('<w:footnoteReference w:id="1"/>');
  expect(main).toContain('<w:footnoteReference w:id="2"/>');
  expect(main).toContain("Text with a note");
  expect(main).not.toContain("Footnote ");
  const notes = xml("word/footnotes.xml");
  expect(notes).toContain('<w:footnote w:id="1">');
  expect(notes).toContain('<w:footnote w:id="2">');
  for (const text of ["Footnote ", "text", "Second paragraph with ", "Other note.", "w:b", "w:hyperlink", "w:footnoteRef"]) expect(notes).toContain(text);
  expect(xml("word/_rels/document.xml.rels")).toContain('Target="footnotes.xml"');
  expect(xml("word/_rels/footnotes.xml.rels")).toContain('Target="https://example.com"');
  expect(xml("[Content_Types].xml")).toContain('ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"');
});

it("preserves lists and embedded images in notes and enforces image limits", async () => {
  const {encode} = await import("jpeg-js");
  const image = new Uint8Array(encode({width: 1, height: 1, data: Buffer.alloc(4, 255)}, 80).data);
  const markdown = "Before ![main](fruit.jpg) note[^1] after.\n\n[^1]: First paragraph.\n\n    - Item with **bold** text\n    - ![note](fruit.jpg)\n";
  const input = [{bytes: new TextEncoder().encode(markdown)}];
  const context = {resources: {async resolve() {return image;}}};
  const result = await convert(input, {from: "markdown", to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  const notes = new TextDecoder().decode(parts.get("word/footnotes.xml"));
  new SaxesParser({xmlns: true}).write(notes).close();
  expect(notes).toContain("w:numPr");
  expect(notes).toContain("w:drawing");
  expect(notes).toContain("Item with ");
  const relationships = new TextDecoder().decode(parts.get("word/_rels/footnotes.xml.rels"));
  expect(relationships).toContain('Target="media/image-1.jpg"');
  expect(relationships).toContain('Target="numbering.xml"');
  expect([...parts.keys()].filter(name => name.startsWith("word/media/"))).toHaveLength(1);
  await expect(convert(input, {from: "markdown", to: "docx"}, {...context, limits: {images: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
});

it("does not add footnote parts to documents without notes", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("Ordinary text.")}], {from: "markdown", to: "docx"}, {});
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  expect(readZipArchiveEntries(result.bytes).has("word/footnotes.xml")).toBe(false);
});

it("keeps table-cell note references in the document and note tables in the footnote part", async () => {
  const markdown = "| Main |\n| --- |\n| Text[^1] |\n\n[^1]: | Note header |\n    | --- |\n    | Note cell |\n";
  const result = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: "markdown", to: "docx"}, {});
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  const main = new TextDecoder().decode(parts.get("word/document.xml"));
  const notes = new TextDecoder().decode(parts.get("word/footnotes.xml"));
  for (const xml of [main, notes]) new SaxesParser({xmlns: true}).write(xml).close();
  expect(main).toContain('<w:footnoteReference w:id="1"/>');
  expect(main).toContain("Main");
  expect(main).not.toContain("Note cell");
  expect(notes).toContain("w:tbl");
  expect(notes).toContain("Note header");
  expect(notes).toContain("Note cell");
  expect(notes).not.toContain("Main");
});
