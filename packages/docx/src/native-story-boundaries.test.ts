import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, WD_STYLE_TYPE, type DocxEnumValue } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const scenario of ["id-type", "style-type", "value-type", "foreign-style", "missing-name"] as const)
it(`rejects ${scenario} before creating native story style definitions; strict=${strict}`, async () => {
  const input = await textFixture("<w:p/>", {}, strict), doc = await Document(input, textContext);
  const other = await Document(input, textContext);
  const foreign = other.styles.add_style("Foreign coast", WD_STYLE_TYPE.PARAGRAPH);
  const memory = Volume.fromJSON({ "/before": "", "/after": "" });
  const sink = (path: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(path, bytes); } });
  await doc.save(sink("/before"));
  expect(() => {
    if (scenario === "id-type") doc.part.get_style(3 as never, WD_STYLE_TYPE.PARAGRAPH);
    if (scenario === "style-type") doc.part.get_style(null, null as unknown as DocxEnumValue<"WD_STYLE_TYPE">);
    if (scenario === "value-type") doc.part.get_style_id(4 as never, WD_STYLE_TYPE.PARAGRAPH);
    if (scenario === "foreign-style") doc.part.get_style_id(foreign, WD_STYLE_TYPE.PARAGRAPH);
    if (scenario === "missing-name") doc.part.get_style_id("Missing coast", WD_STYLE_TYPE.PARAGRAPH);
  }).toThrow();
  await doc.save(sink("/after"));
  expect(readPackage(new Uint8Array(memory.readFileSync("/after") as Buffer))).toEqual(readPackage(new Uint8Array(memory.readFileSync("/before") as Buffer)));
});

for (const strict of [false, true]) for (const [attributes, expected] of [
  ['id="0"', 1], ['id="00021"', 22], ['id="not-an-id" w:id="99"', 1], ['id="9007199254740990"', Number.MAX_SAFE_INTEGER]
] as const)
it(`allocates a native story ID after ${attributes} without changing part bytes; strict=${strict}`, async () => {
  const input = await textFixture(`<w:p ${attributes}/>`, {}, strict), doc = await Document(input, textContext);
  const before = doc.part.blob; expect(doc.part.next_id).toBe(expected); expect(doc.part.blob).toEqual(before);
});

for (const strict of [false, true])
it(`reserves numeric IDs in inactive compatibility branches and rejects exhausted native IDs; strict=${strict}`, async () => {
  const markup = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:future"><mc:Choice Requires="u"><u:opaque id="98"/></mc:Choice><mc:Fallback><w:p id="2"/></mc:Fallback></mc:AlternateContent>';
  const doc = await Document(await textFixture(markup, {}, strict), textContext); expect(doc.part.next_id).toBe(99);
  const exhausted = await Document(await textFixture('<w:p id="9007199254740991"/>', {}, strict), textContext);
  expect(() => exhausted.part.next_id).toThrow();
});
