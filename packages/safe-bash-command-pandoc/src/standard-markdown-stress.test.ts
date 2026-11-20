import {afterAll, beforeAll, expect, it, vi} from "vitest";
import {readArchive, readDocumentArchive, DocumentXmlEditor, type XmlElement} from "safe-bash-docx-engine";
import {SaxesParser} from "saxes";
import {PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import {convert, readDocument} from "./index.js";
vi.mock("../../office-package/src/runtime.js", async importOriginal => {
  const runtime = await importOriginal<typeof import("../../office-package/src/runtime.js")>();
  return {...runtime, yieldEventLoop: async () => {}, defaultRuntime: {...runtime.defaultRuntime, async yieldTurn(signal: AbortSignal) {signal.throwIfAborted();}}};
});
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {yield: async () => {}};
const encode = (text: string) => new TextEncoder().encode(text);
async function convertBytes(markdown: string, to: string) {
  const result = await convert([{bytes: encode(markdown)}], {from: "gfm", to}, context);
  if (result.kind !== "binary") throw new Error("Expected binary output");
  return result.bytes;
}
it("adds one DOCX list marker for a list item containing a blockquote", async () => {
  const bytes = await convertBytes("- Intro\n\n  > Quoted continuation\n\n  Final continuation\n", "docx");
  const archive = await readDocumentArchive(bytes, {signal: new AbortController().signal});
  const xml = new TextDecoder().decode(archive.members.find(member => member.name === "word/document.xml")!.bytes);
  const editor = new DocumentXmlEditor(encode(xml));
  const count = (node: XmlElement): number => Number(node.localName === "numPr") + node.children.reduce((sum, child) => sum + count(child), 0);
  expect(count(editor.root)).toBe(1);
});
it("preserves hyperlink order inside DOCX table cells and after the table", async () => {
  const bytes = await convertBytes("[Before](https://before.example)\n\n| One | Two |\n| --- | --- |\n| [Cell](https://cell.example) | **strong** |\n\n> > [Nested](https://nested.example)\n\n[After](https://after.example)", "docx");
  const document = await readDocument({bytes}, {from: "docx"}, context);
  const text = JSON.stringify(document.blocks);
  for (const url of ["https://before.example", "https://cell.example", "https://nested.example", "https://after.example"]) expect(text).toContain(url);
  expect(text.indexOf("Before")).toBeLessThan(text.indexOf("Cell"));
  expect(text.indexOf("Cell")).toBeLessThan(text.indexOf("Nested"));
  expect(text.indexOf("Nested")).toBeLessThan(text.indexOf("After"));
});
it("embeds combined PDF styles and admits their distinct font count", async () => {
  const markdown = "***combined*** and **`bold code`** and *`italic code`*";
  const bytes = await convertBytes(markdown, "pdf");
  const source = new TextDecoder().decode(bytes);
  for (const font of ["LiberationSans-BoldItalic", "JetBrainsMono-Bold", "JetBrainsMono-Italic"]) expect(source).toContain(font);
  const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(1);
  const fonts=pdf.getPages()[0]!.node.Resources()!.lookup(PDFName.of("Font"),PDFDict);
  for(const value of fonts.values()) {
    const font=pdf.context.lookup(value,PDFDict);
    const descendant=font.lookup(PDFName.of("DescendantFonts"),PDFArray).lookup(0,PDFDict);
    const descriptor=descendant.lookup(PDFName.of("FontDescriptor"),PDFDict);
    expect((pdf.context.lookup(descriptor.get(PDFName.of("FontFile2"))) as PDFRawStream).contents.length).toBeGreaterThan(1000);
  }
  await expect(convert([{bytes: encode(markdown)}], {from: "gfm", to: "pdf"}, {...context, limits: {fonts: 3}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("does not introduce extra PPTX list items for quoted continuations", async () => {
  const bytes = await convertBytes("- Intro\n\n  > Quoted continuation\n\n  Final continuation\n", "pptx");
  const archive = await readArchive(bytes, {signal: new AbortController().signal});
  const slide = archive.members.find(member => member.name === "ppt/slides/slide1.xml")!;
  let markers = 0;
  const parser = new SaxesParser({xmlns: true});
  parser.on("opentag", node => {if (node.local === "buChar") markers++;});
  parser.write(new TextDecoder().decode(slide.bytes)).close();
  expect(markers).toBe(1);
});
it("writes DOCX numbering definitions before numbering instances", async () => {
  const bytes = await convertBytes("- Bullet\n\n1. Ordered\n", "docx");
  const archive = await readDocumentArchive(bytes, {signal: new AbortController().signal});
  const part = archive.members.find(member => member.name === "word/numbering.xml")!;
  const editor = new DocumentXmlEditor(part.bytes);
  expect(editor.root.children.map(child => child.localName)).toEqual(["abstractNum", "abstractNum", "num", "num"]);
});
it("orders DOCX quoted-list paragraph numbering before indentation", async () => {
  const bytes = await convertBytes("> - Quoted bullet\n", "docx");
  const archive = await readDocumentArchive(bytes, {signal: new AbortController().signal});
  const part = archive.members.find(member => member.name === "word/document.xml")!;
  const editor = new DocumentXmlEditor(part.bytes);
  const children: string[] = [];
  const visit = (node: XmlElement): void => {
    if (node.localName === "pPr") children.push(...node.children.map(child => child.localName));
    for (const child of node.children) visit(child);
  };
  visit(editor.root);
  expect(children.indexOf("numPr")).toBeGreaterThanOrEqual(0);
  expect(children.indexOf("numPr")).toBeLessThan(children.indexOf("ind"));
});
it("preserves Greek text using an embedded bold PDF face", async () => {
  const bytes = await convertBytes("**Ω**", "pdf");
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPages()[0]!.node.Contents() as PDFArray;
  const streams = Array.from({length: contents.size()}, (_, index) => new TextDecoder().decode(decodePDFRawStream(contents.lookup(index, PDFRawStream)).decode()));
  const fonts=pdf.getPages()[0]!.node.Resources()!.lookup(PDFName.of("Font"),PDFDict);
  const key=fonts.keys()[0]!;const font=pdf.context.lookup(fonts.get(key),PDFDict);
  expect(font.get(PDFName.of("BaseFont"))?.toString()).toContain("LiberationSans-Bold");
  expect(streams.join("\n")).toContain(`${key.toString()} 12 Tf`);
  const cmap=pdf.context.lookup(font.get(PDFName.of("ToUnicode"))) as PDFRawStream;
  expect(new TextDecoder().decode(decodePDFRawStream(cmap).decode())).toContain("<03A9>");
  const descendant=font.lookup(PDFName.of("DescendantFonts"),PDFArray).lookup(0,PDFDict);
  const descriptor=descendant.lookup(PDFName.of("FontDescriptor"),PDFDict);
    expect((pdf.context.lookup(descriptor.get(PDFName.of("FontFile2"))) as PDFRawStream).contents.length).toBeGreaterThan(1000);
});
