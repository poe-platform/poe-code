import "docx";
import {expect, it, vi, beforeAll, afterAll} from "vitest";
import {PDFDocument} from "pdf-lib";
import {convert, readDocument, writeDocument} from "./index.js";

vi.mock("../../office-package/src/runtime.js", async importOriginal => {
  const runtime = await importOriginal<typeof import("../../office-package/src/runtime.js")>();
  return {...runtime, yieldEventLoop: async () => {}, defaultRuntime: {...runtime.defaultRuntime, async yieldTurn(signal: AbortSignal) {signal.throwIfAborted();}}};
});
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const markdown = `# Heading 1

Paragraph with **bold**, *italic*, \`code\`, and a [link](https://example.com).

- bullet 1
- bullet 2

1. ordered 1
2. ordered 2

> A blockquote.

| Name | Score |
| ---- | ----- |
| Alice | 95 |
`;
const context = {yield: async () => {}};
it.each(["docx", "pptx", "pdf"])("converts standard Markdown to %s without injected capabilities", async to => {
  const result = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: "gfm", to}, context);
  expect(result.kind).toBe("binary");
  if (result.kind !== "binary") throw new Error("Expected binary document");
  const document = await readDocument({bytes: result.bytes}, {from: to}, context);
  const plain = await writeDocument(document, {to: "plain"}, context);
  if (plain.kind !== "text") throw new Error("Expected text");
  const text = plain.text;
  for (const value of ["Heading 1", "bold", "italic", "code", "link", "bullet 1", "ordered 2", "A blockquote.", "Alice", "95"]) expect(text).toContain(value);
  if (to === "docx") {
    expect(JSON.stringify(document.blocks)).toContain('"t":"Link"');
    expect(JSON.stringify(document.blocks)).toContain("https://example.com");
    expect(JSON.stringify(document.blocks)).toContain('"t":"Table"');
  }
  if (to === "pdf") {
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
    const source = new TextDecoder().decode(result.bytes);
    for (const font of ["Helvetica-Bold", "Helvetica-Oblique", "Courier"]) expect(source).toContain(font);
  }
});
it.each(["docx", "pdf"])("supports horizontal rules in %s", async to => {
  const result = await convert([{bytes: new TextEncoder().encode("Before\n\n---\n\nAfter")}], {from: "commonmark", to}, context);
  expect(result.kind).toBe("binary");
});
