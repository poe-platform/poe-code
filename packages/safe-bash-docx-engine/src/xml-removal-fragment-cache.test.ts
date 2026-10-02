import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textFixture, textContext, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { documentXmlCache } from "./budget.js";
import { parseDocumentXml } from "./package-xml.js";

for (const strict of [false, true])
it(`removes a paragraph without charging a preserved XML part matching the synthetic wrapper; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Removed</w:t></w:r></w:p><w:p><w:r><w:t>Retained</w:t></w:r></w:p>', {}, strict));
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/audit/shadow.xml" ContentType="application/xml"/>');
  parts.set("[Content_Types].xml", types.serialize());
  parts.set("audit/shadow.xml", new TextEncoder().encode(`<fragment xmlns:w="${strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w}" xmlns:r="${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r}"></fragment>`));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const budget = new api.DocumentBudget({ insertedNodes: 0 }, textContext.signal), document = await api.Document(new Uint8Array(memory.readFileSync("/input") as Buffer), { ...textContext, budget });
  document.paragraphs[0]!.element.remove();
  expect(budget.usage.insertedNodes).toBe(0);
  await document.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  const saved = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer));
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(document.paragraphs.map(p => p.text)).toEqual(["Retained"]);
});

for (const strict of [false, true]) for (const cached of [false, true]) for (const capacity of [0, 1])
it(`charges actual replacement nodes independently of fragment cache; strict=${strict}; cached=${cached}; capacity=${capacity}`, () => {
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const encode = (value: string) => new TextEncoder().encode(value);
  const budget = new api.DocumentBudget({ insertedNodes: capacity });
  const source = encode(`<w:document xmlns:w="${namespace}"><w:body><w:p/></w:body></w:document>`);
  if (cached) {
    const shadow = encode(`<fragment xmlns:w="${namespace}"><w:p/></fragment>`);
    budget[documentXmlCache].entries = new Map();
    budget[documentXmlCache].admitted = new WeakSet([shadow]);
    parseDocumentXml(shadow, {}, budget);
  }
  const editor = new api.DocumentXmlEditor(source, {}, undefined, budget);
  const paragraph = editor.root.children[0]!.children[0]!;
  if (!capacity) {
    expect(() => editor.replaceElement(paragraph, "<w:p/>")).toThrow(api.ResourceLimitError);
    expect(editor.serialize()).toEqual(source);
    expect(budget.usage.insertedNodes).toBe(0);
  } else {
    editor.replaceElement(paragraph, "<w:p/>");
    expect(budget.usage.insertedNodes).toBe(1);
    expect(editor.serialize()).toEqual(source);
  }
});
