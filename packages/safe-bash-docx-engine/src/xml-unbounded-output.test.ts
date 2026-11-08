import { expect, it } from "vitest";
import { DocumentXmlEditor } from "./xml-write.js";

it("XML staging and serialization allow omitted and explicit unbounded limits", () => {
  for (const limits of [{}, { maxBytes: Infinity }]) {
    const editor = new DocumentXmlEditor(new TextEncoder().encode("<root>old</root>"), limits);
    editor.setText(editor.root.content[0]!, "é🐈".repeat(32));
    expect(new TextDecoder().decode(editor.serialize())).toBe(`<root>${"é🐈".repeat(32)}</root>`);
  }
});

it("XML mutations still enforce explicit output byte limits", () => {
  const editor = new DocumentXmlEditor(new TextEncoder().encode("<root>old</root>"), { maxBytes: 16 });
  expect(() => editor.setText(editor.root.content[0]!, "more than sixteen bytes")).toThrow(/limit/i);
});
