import {expect, it} from "vitest";
import {Volume} from "memfs";
import {Document} from "./index.js";
import {textContext, textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

for (const strict of [false, true]) for (const selected of [false, true])
it(`removing one live tab XML root invalidates only that tab; selected=${selected} strict=${strict}`, async () => {
  const first = '<w:tab w:val="left" w:pos="720"/>', second = '<w:tab w:val="right" w:pos="1440"/>';
  const tabs = `<w:tabs>${first}<!--retained tab trivia-->${second}</w:tabs>`;
  const carrier = selected ? `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w">${tabs}</mc:Choice><mc:Fallback><w:tabs><w:tab w:val="center" w:pos="2000"/></w:tabs></mc:Fallback></mc:AlternateContent>` : tabs;
  const input = await textFixture(`<w:p><w:pPr>${carrier}</w:pPr><w:r><w:t>Coast</w:t></w:r></w:p>`, {}, strict);
  const doc = await Document(input, textContext), stops = doc.paragraphs[0]!.paragraph_format.tab_stops;
  const removed = stops.at(0), retained = stops.at(1), removedXml = removed.element, retainedXml = retained.element;
  removedXml.remove();
  expect(stops.length).toBe(1);
  expect(() => removed.position).toThrowError(expect.objectContaining({code: "stale-selection"}));
  expect(() => removedXml.tag).toThrowError(expect.objectContaining({code: "stale-selection"}));
  expect(retained.position.twips).toBe(1440);
  expect([...retainedXml.attributes].find(([name]) => name.namespaceURI === retainedXml.namespace && name.localName === "pos")?.[1]).toBe("1440");
  expect(stops.at(0).equals(retained)).toBe(true);
  const memory = Volume.fromJSON({"/output": ""}); await doc.save({async write(bytes) {memory.appendFileSync("/output", bytes);}});
  const expected = readPackage(input); expected.set("word/document.xml", new TextEncoder().encode(new TextDecoder().decode(expected.get("word/document.xml")).replace(first, "")));
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer); expect(readPackage(output)).toEqual(expected);
  expect([...(await Document(output, textContext)).paragraphs[0]!.paragraph_format.tab_stops].map(tab => tab.position.twips)).toEqual([1440]);
});

for (const strict of [false, true])
it(`invalid stored tab attributes never return stale cached values; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict);
  const doc = await Document(input, textContext), tabs = doc.paragraphs[0]!.paragraph_format.tab_stops, tab = tabs.at(0);
  expect(tab.position.twips).toBe(720);
  const element = doc.paragraphs[0]!.element.children[0]!.children[0]!.children[0]!;
  element.set_attribute({namespaceURI: element.namespace, localName: "pos"}, "invalid");
  expect(() => tab.position).toThrow("Invalid tab stop properties.");
  expect(() => tab.position).toThrow("Invalid tab stop properties.");
  expect(() => tabs.length).toThrow("Invalid tab stop properties.");
});
