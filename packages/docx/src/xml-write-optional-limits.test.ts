import { expect, it } from "vitest";
import { DocumentBudget } from "./budget.js";
import { documentXmlSettings, type DocumentXmlLimits } from "./package-xml.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { ResourceLimitError } from "./archive.js";

const encode = (value: string) => new TextEncoder().encode(value);

const limitsCases: DocumentXmlLimits[] = [{}, { maxBytes: Infinity }, { maxDepth: 2 }];
it.each(limitsCases)("normalizes omitted XML writer bytes to Infinity with %j", limits => {
  expect(documentXmlSettings(limits).maxBytes).toBe(Infinity);
  const editor = new DocumentXmlEditor(encode("<r>old</r>"), limits);
  editor.replaceScalarText(editor.root, "雪<&");
  expect(new TextDecoder().decode(editor.serialize())).toBe("<r>雪&lt;&amp;</r>");
});

it("enforces explicit and document-budget byte quotas while preserving rejected edits", () => {
  for (const editor of [
    new DocumentXmlEditor(encode("<r>old</r>"), { maxBytes: 16 }),
    new DocumentXmlEditor(encode("<r>old</r>"), {}, undefined, new DocumentBudget({ xmlPartBytes: 16 }))
  ]) {
    // Four characters fit the early character check, but twelve UTF-8 bytes
    // plus markup exceed the serialized output quota.
    expect(() => editor.replaceScalarText(editor.root, "雪雪雪雪")).toThrow(ResourceLimitError);
    expect(new TextDecoder().decode(editor.serialize())).toBe("<r>old</r>");
    expect(() => editor.replaceScalarText(editor.root, "x".repeat(17))).toThrow(ResourceLimitError);
    editor.replaceScalarText(editor.root, "new");
    expect(new TextDecoder().decode(editor.serialize())).toBe("<r>new</r>");
  }
});
