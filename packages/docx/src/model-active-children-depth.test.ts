import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentBudget, DocumentXmlEditor } from "./index.js";
import { activeModelChildren } from "./model-active-children.js";
import type { ModelStore } from "./model-store.js";

for (const strict of [false, true])
it(`model compatibility projection honors admitted native depth without recursive stack; ${strict}`, () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const start = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr/>';
  const memory = Volume.fromJSON({ "/story.xml": `<w:document xmlns:w="${w}"><w:body>${start.repeat(8192)}<w:p><w:r><w:t>日本 עברית é 🌊</w:t></w:r></w:p>${"<w:p/></w:tc></w:tr></w:tbl>".repeat(8192)}</w:body></w:document>` });
  const budget = new DocumentBudget({ xmlDepth: 32768, retainedBytes: 1024 ** 3, work: 1024 ** 3 });
  const original = new Uint8Array(memory.readFileSync("/story.xml") as Buffer), editor = new DocumentXmlEditor(original, {}, undefined, budget);
  // ModelStore's admitted editor/context are the projection's only domain ports.
  // Mock retrieval, not the projection or its real compatibility authority.
  const store = { xml: () => editor, context: { budget } } as unknown as ModelStore;
  let children: (node: typeof editor.root) => readonly (typeof editor.root)[];
  expect(() => { children = activeModelChildren(store, "/word/document.xml"); }).not.toThrow();
  expect(children!(editor.root)).toEqual([editor.root.children[0]!]);
  expect(children!(editor.root.children[0]!)).toEqual([editor.root.children[0]!.children[0]!]);
  expect(activeModelChildren(store, "/word/document.xml")).toBe(children!);
  expect(new Uint8Array(memory.readFileSync("/story.xml") as Buffer)).toEqual(original);
});
