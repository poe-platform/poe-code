import {expect, it, vi} from "vitest";
import {encode} from "jpeg-js";
import {PDFDocument} from "pdf-lib";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert, writeDocument} from "./engine.js";
import type {Document} from "./types.js";

const attr = ["", [], []] as const;
const context = {yield: async () => {}};
const picture = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
const document: Document = {blocks: [{t: "Para", c: [{t: "Str", c: "BODY"}]}], resources: [], metadata: {
  title: {t: "MetaString", c: "TITLE"}, subtitle: {t: "MetaString", c: "SUBTITLE"},
  author: {t: "MetaList", c: [{t: "MetaString", c: "FIRST"}, {t: "MetaInlines", c: [{t: "Str", c: "SECOND"}]}]},
  date: {t: "MetaBlocks", c: [{t: "Plain", c: [{t: "Str", c: "DATE"}]}]},
}};

it("renders the Pandoc title block in authored order before the document body", async () => {
  const result = await writeDocument(document, {to: "docx"}, context);
  if (result.kind !== "binary") throw Error("Expected DOCX");
  const xml = new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"));
  expect([...xml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map(match => match[1])).toEqual(["TITLE", "SUBTITLE", "FIRST", "SECOND", "DATE", "BODY"]);
});

it.each(["docx", "pdf"] as const)("resolves and renders rich visible metadata resources in %s", async to => {
  const resolve = vi.fn(async () => picture);
  const result = await writeDocument({...document, metadata: {
    title: {t: "MetaInlines", c: [{t: "Str", c: "TITLE"}, {t: "Image", c: [attr, [{t: "Str", c: "ALT"}], ["title.jpg", ""]]}, {t: "Note", c: [{t: "Para", c: [{t: "Str", c: "NOTE"}]}]}]},
    subtitle: {t: "MetaInlines", c: [{t: "RawInline", c: ["html", '<img src="title.jpg">']}]},
  }}, {to}, {...context, resources: {resolve}});
  expect(resolve).toHaveBeenCalledOnce();
  if (result.kind !== "binary") throw Error("Expected binary document");
  if (to === "docx") {
    const parts = readZipArchiveEntries(result.bytes);
    const xml = new TextDecoder().decode(parts.get("word/document.xml"));
    expect([...xml.matchAll(/<w:drawing\b/g)]).toHaveLength(2);
    expect(xml).toContain("w:footnoteReference");
    expect(new TextDecoder().decode(parts.get("word/footnotes.xml"))).toContain("NOTE");
  } else {
    expect((await PDFDocument.load(result.bytes)).getTitle()).toBe("TITLEALT");
    expect(new TextDecoder().decode(result.bytes)).toContain("/Subtype /Image");
  }
});

it.each(["docx", "pdf"] as const)("does not resolve or reject unused metadata content in %s", async to => {
  const resolve = vi.fn(async () => {throw Error("Unused resource");});
  const result = await writeDocument({...document, metadata: {
    title: {t: "MetaBlocks", c: [{t: "Para", c: [{t: "Image", c: [attr, [], ["absent.jpg", ""]]}]}, {t: "Para", c: []}]},
    author: {t: "MetaMap", c: {name: {t: "MetaInlines", c: [{t: "Math", c: ["InlineMath", "unused"]}]}}},
    custom: {t: "MetaInlines", c: [{t: "Image", c: [attr, [], ["absent.jpg", ""]]}, {t: "Math", c: ["InlineMath", "unused"]}]},
  }}, {to}, {...context, limits: {images: 0}, resources: {resolve}});
  expect(result.kind).toBe("binary");
  expect(resolve).not.toHaveBeenCalled();
});

it("renders supported CJK glyphs in visible PDF metadata", async () => {
  const result = await writeDocument({...document, metadata: {title: {t: "MetaString", c: "東京"}}}, {to: "pdf"}, context);
  if (result.kind !== "binary") throw Error("Expected PDF");
  expect((await PDFDocument.load(result.bytes)).getTitle()).toBe("東京");
  const plain = await convert([{bytes: result.bytes}], {from: "pdf", to: "plain"}, context);
  if (plain.kind !== "text") throw Error("Expected extracted PDF text");
  expect(plain.text.trim().split(/\s+/)).toEqual(["東京", "BODY"]);
});

it("rejects unshaped text in visible PDF metadata", async () => {
  await expect(writeDocument({...document, metadata: {title: {t: "MetaString", c: "مرحبا"}}}, {to: "pdf"}, context)).rejects.toMatchObject({
    code: "E_CAPABILITY",
    message: "Unsupported PDF script or combining sequence U+0645; text shaping is not available",
  });
});

it.each(["docx", "pdf"] as const)("applies explicit raw policy before image acquisition in %s", async to => {
  const resolve = vi.fn(async () => {throw Error("Escaped resource");});
  for (const metadata of [false, true]) {
    const raw = {t: "RawInline" as const, c: ["html", '<img src="absent.jpg">'] as const};
    const input: Document = {resources: [], metadata: metadata ? {title: {t: "MetaInlines", c: [raw]}} : {}, blocks: metadata ? [] : [{t: "Para", c: [raw]}]};
    const original = structuredClone(input);
    await expect(writeDocument(input, {to, rawContent: "reject"}, {...context, resources: {resolve}})).rejects.toMatchObject({code: "E_CAPABILITY"});
    const output = await writeDocument(input, {to, rawContent: "escape"}, {...context, resources: {resolve}});
    expect(output.kind).toBe("binary");
    expect(input).toEqual(original);
    expect(resolve).not.toHaveBeenCalled();
  }
});
