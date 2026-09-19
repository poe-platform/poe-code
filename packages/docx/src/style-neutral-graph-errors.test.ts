import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const type of ["PARAGRAPH", "CHARACTER", "TABLE"] as const)
for (const cycle of ["self", "two-node"])
it(`rejects a style base cycle with a neutral value error before mutation; ${cycle}; ${type}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>');
  const d = await api.Document(input, textContext), a = d.styles.add_style("Atlas", api.WD_STYLE_TYPE[type]), b = d.styles.add_style("Birch", api.WD_STYLE_TYPE[type]);
  if (!(a instanceof api.CharacterStyle) || !(b instanceof api.CharacterStyle)) throw new Error("Expected styles with base formatting.");
  if (cycle === "two-node") b.base_style = a;
  const memory = Volume.fromJSON({ "/before": "", "/after": "" }); await d.save({ async write(bytes) { memory.appendFileSync("/before", bytes); } });
  const before = d.styles.part.blob;
  expect(() => { a.base_style = cycle === "self" ? a : b; }).toThrow(api.InvalidValueError);
  expect(d.styles.part.blob).toEqual(before); expect(a.base_style).toBeNull();
  await d.save({ async write(bytes) { memory.appendFileSync("/after", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/after") as Buffer))).toEqual(readPackage(new Uint8Array(memory.readFileSync("/before") as Buffer)));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const type of ["PARAGRAPH", "CHARACTER", "TABLE", "LIST"] as const)
it(`reports ambiguous style name through the neutral value class; ${type}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const d = await api.Document(input, textContext), a = d.styles.add_style("Atlas", api.WD_STYLE_TYPE[type]), b = d.styles.add_style("Birch", api.WD_STYLE_TYPE[type]);
  b.name = a.name;
  const before = d.styles.part.blob;
  expect(() => d.styles.at("Atlas")).toThrow(api.InvalidValueError); expect(d.styles.part.blob).toEqual(before);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`reports a stored unknown style type through the neutral value class; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const d = await api.Document(input, textContext), style = d.styles.add_style("Atlas", api.WD_STYLE_TYPE.PARAGRAPH), node = style.element;
  node.set_attribute({ namespaceURI: node.namespace, localName: "type" }, "unlisted");
  const before = d.styles.part.blob;
  expect(() => style.type).toThrow(api.InvalidValueError); expect(d.styles.part.blob).toEqual(before);
});
