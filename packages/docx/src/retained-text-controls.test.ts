import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, DocumentXmlEditor, extractDocumentText, openDocumentLocations, removeDocumentContent, replaceDocumentText } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const prefix = "עברית 🌊\r";
const suffix = "\r日本 é";
const cases = [
  { mode: "inherited", with: "shore" },
  { mode: "override", with: "shore", bold: false, italic: true },
  { mode: "native-override", with: "shore", bold: false, italic: true },
  { mode: "cross-run", with: "shore" },
  { mode: "deletion", with: "" },
  { mode: "inserted-controls", with: "shore\r湾\t北\n南" },
  { mode: "repeated", with: "shore" },
  { mode: "range", with: "shore" }
] as const;

for (const strict of [false, true]) for (const scenario of cases)
it(`preserves retained character-reference controls during ${scenario.mode} replacement; strict=${strict}`, async () => {
  const properties = '<w:rPr><w:b/><w:rtl/><w:lang w:val="he-IL" w:eastAsia="ja-JP"/></w:rPr>';
  const first = `<w:t xml:space="preserve">עברית 🌊&#13;${scenario.mode === "cross-run" ? "co" : "coast"}${scenario.mode === "repeated" ? "&#13;coast" : ""}${scenario.mode === "cross-run" ? "" : "&#13;日本 é"}</w:t>`;
  const content = scenario.mode === "native-override" ? `<f:pass>${first}</f:pass>` : first;
  const second = scenario.mode === "cross-run" ? '<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">ast&#13;日本 é</w:t></w:r>' : "";
  const input = await textFixture(`<w:p xmlns:f="urn:original:retained-controls" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:bidi/></w:pPr><w:r>${properties}${content}</w:r>${second}</w:p><w:p><w:r><w:t>Unchanged</w:t></w:r></w:p>`, {}, strict);
  const original = prefix + "coast" + (scenario.mode === "repeated" ? "\rcoast" : "") + suffix;
  expect((await extractDocumentText(input, textContext)).text).toBe(original + "\nUnchanged");
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const document = await openDocumentLocations(input, textContext);
  const selection = scenario.mode === "range" ? { select: document.range(document.at("paragraph", 1).token, [...prefix].length, [...prefix].length + 5).token } : {};
  const format = "bold" in scenario ? { bold: scenario.bold, italic: scenario.italic } : {};
  await replaceDocumentText(input, { find: "coast", with: scenario.with, all: true, output: "-", ...selection, ...format }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }
  });
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const inserted = scenario.with.replaceAll("\r", "\n");
  const expected = prefix + inserted + (scenario.mode === "repeated" ? "\r" + inserted : "") + suffix;
  expect((await extractDocumentText(output, textContext)).text).toBe(expected + "\nUnchanged");
  const model = await Document(output, textContext);
  expect(model.paragraphs[0]!.text).toBe(expected);
  expect(model.paragraphs[0]!.runs[0]!.font.rtl).toBe(true);
  const before = readPackage(input), after = readPackage(output);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const override of [false, true])
it(`preserves literal text control provenance outside replacement; strict=${strict}; override=${override}`, async () => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A&#9;&#10;coast&#9;&#10;Z</w:t></w:r></w:p>', {}, strict);
  const volume = Volume.fromJSON({ "/output": "" });
  await replaceDocumentText(input, { find: "coast", with: "shore\t北\n南", all: true, output: "-", ...(override ? { bold: false } : {}) }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }
  });
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer);
  expect((await extractDocumentText(output, textContext)).text).toBe("A\t\nshore\t北\n南\t\nZ");
  const editor = new DocumentXmlEditor(readPackage(output).get("word/document.xml")!);
  const runs = editor.root.children[0]!.children[0]!.children.filter(node => node.localName === "r");
  const text = runs.flatMap(node => node.children.filter(node => node.localName === "t").map(node => node.text));
  expect(text[0]).toBe(override ? "A\t\n" : "A\t\nshore");
  expect(text.at(-1)).toBe(override ? "\t\nZ" : "南\t\nZ");
  expect(runs.flatMap(node => node.children).filter(node => node.localName === "tab")).toHaveLength(1);
  expect(runs.flatMap(node => node.children).filter(node => node.localName === "br")).toHaveLength(1);
});

for (const strict of [false, true]) for (const kind of ["paragraph", "run"] as const)
it(`preserves retained character-reference controls during ${kind} scalar removal; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>עברית 🌊&#13;coast&#13;日本 é</w:t></w:r></w:p>', {}, strict);
  const document = await openDocumentLocations(input, textContext), paragraph = document.at("paragraph", 1);
  const owner = kind === "paragraph" ? paragraph : document.at("run", 1, { owner: paragraph.token });
  const select = document.range(owner.token, [...prefix].length, [...prefix].length + 5).token;
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  await removeDocumentContent(input, { operation: kind === "paragraph" ? "paragraphs.remove" : "runs.remove", options: { select, markers: "exclude", output: "-" } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }
  });
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer);
  expect((await extractDocumentText(output, textContext)).text).toBe(prefix + suffix);
  const model = await Document(output, textContext);
  expect(model.paragraphs[0]!.runs[0]!.bold).toBe(true);
  expect(model.paragraphs[0]!.runs[0]!.font.rtl).toBe(true);
  const before = readPackage(input), after = readPackage(output);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
