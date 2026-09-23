import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const quoted = (value: string) => "'" + value.split("'").join("'\\''") + "'";
const run = '<w:r><w:rPr><w:b/><w:rFonts w:ascii="Old" w:hAnsi="Old"/></w:rPr><w:t>Old</w:t></w:r>';
const control = (properties: string, content = run, id = 17) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:tag w:val="bay"/><w:alias w:val="Original alias"/><w:showingPlcHdr/><w:placeholder><w:docPart w:val="Original definition"/></w:placeholder>${properties}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const checkbox = (checked = "2612", unchecked = "2610", font = "Symbol", extra = "") => `<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="0"/><c:checkedState c:val="${checked}" c:font="${font}"/><c:uncheckedState c:val="${unchecked}" c:font="${font}"/>${extra}</c:checkbox>`;
type Scenario = { name: string; body: string; options: Record<string, string | number | boolean>; error?: string; expected?: string | boolean; display?: string; kind?: string; font?: string };
const scenarios: Scenario[] = [];
for (const type of ["text", "richText"]) for (const text of ["", "A\t海\n🌊'&<"])
  scenarios.push({ name: `${type} exact scalar ${JSON.stringify(text)}`, body: `<w:p>${control(`<w:${type}/><u:metadata xmlns:u="urn:original:control" value="retained"/>`)}</w:p>`, options: { control: 1, text }, expected: text, display: text, kind: type === "text" ? "plain-text" : "rich-text" });
for (const type of ["dropDownList", "comboBox"]) {
  const body = `<w:p>${control(`<w:${type}><w:listItem w:value="a" w:displayText="Harbor"/><w:listItem w:value="b" w:displayText="Coast 海"/></w:${type}>`)}</w:p>`;
  scenarios.push({ name: `${type} declared value`, body, options: { control: 1, choice: "b" }, expected: "Coast 海", display: "Coast 海" });
  scenarios.push({ name: `${type} label is not value`, body, options: { control: 1, choice: "Coast 海" }, error: "usage" });
  scenarios.push({ name: `${type} duplicate stored values`, body: `<w:p>${control(`<w:${type}><w:listItem w:value="a" w:displayText="First"/><w:listItem w:value="a" w:displayText="Second"/></w:${type}>`)}</w:p>`, options: { control: 1, choice: "a" }, error: "unsupported-edit" });
}
for (const checked of [false, true]) {
  scenarios.push({ name: `checkbox explicit ${checked}`, body: `<w:p>${control(checkbox())}</w:p>`, options: { control: 1, checked }, expected: checked, display: checked ? "☒" : "☐", font: "Symbol" });
  scenarios.push({ name: `checkbox supplementary scalar ${checked}`, body: `<w:p>${control(checkbox("1f30a", "10ffff", "Original Glyph"))}</w:p>`, options: { control: 1, checked }, expected: checked, display: String.fromCodePoint(checked ? 0x1f30a : 0x10ffff), font: "Original Glyph" });
}
for (const invalid of ["", "0", "D800", "DFFF", "110000", "1234567", "ZZZZ"])
  scenarios.push({ name: `checkbox unused invalid glyph ${invalid}`, body: `<w:p>${control(checkbox("2612", invalid))}</w:p>`, options: { control: 1, checked: true }, error: "unsupported-edit" });
for (const font of ["", " Symbol", "Symbol ", "Symbol&#10;Injected"])
  scenarios.push({ name: `checkbox invalid font ${font}`, body: `<w:p>${control(checkbox("2612", "2610", font))}</w:p>`, options: { control: 1, checked: false }, error: "unsupported-edit" });
for (const extra of ['<c:unknown/>', '<c:checkedState c:val="2612" c:font="Symbol"/>', '<c:checkedState c:val="2612" c:font="Symbol" c:unknown="x"/>'])
  scenarios.push({ name: `checkbox unknown or duplicate metadata ${extra}`, body: `<w:p>${control(checkbox("2612", "2610", "Symbol", extra))}</w:p>`, options: { control: 1, checked: true }, error: "unsupported-edit" });
for (const carrier of ["choice", "fallback", "process", "ignored", "inactive-extension-choice"]) for (const checked of [false, true]) {
  const declarations = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:checkbox-carrier" xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"';
  const hidden = carrier === "ignored" || carrier === "inactive-extension-choice";
  const properties = carrier === "process" || carrier === "ignored" ? `<u:bridge ${declarations} mc:Ignorable="u"${carrier === "process" ? ' mc:ProcessContent="u:bridge"' : ""}>${checkbox()}</u:bridge>` :
    `<mc:AlternateContent ${declarations}><mc:Choice Requires="${carrier === "choice" ? "w" : carrier === "fallback" ? "u" : "c"}">${carrier === "fallback" ? '<w:text/>' : checkbox()}</mc:Choice><mc:Fallback>${carrier === "fallback" ? checkbox() : '<w:text/>'}</mc:Fallback></mc:AlternateContent>`;
  scenarios.push({ name: `checkbox carrier ${carrier} ${checked}`, body: `<w:p>${control(properties)}</w:p>`, options: { control: 1, checked }, ...(hidden ? { error: "unsupported-edit" } : { expected: checked, display: checked ? "☒" : "☐", font: "Symbol" }) });
}
const nested = (properties: string) => `<w:p>${control(properties, control("<w:text/>", run, 18))}</w:p>`;
scenarios.push({ name: "unlocked nested leaf", body: nested("<w:richText/>"), options: { control: 2, text: "Leaf 海" }, expected: "Leaf 海", display: "Leaf 海" });
scenarios.push({ name: "parent cannot erase nested leaf", body: nested("<w:richText/>"), options: { control: 1, text: "Erase" }, error: "unsupported-edit" });
for (const lock of ["sdtLocked", "contentLocked", "sdtContentLocked", "unknown"])
  scenarios.push({ name: `nested ancestor ${lock}`, body: nested(`<w:richText/><w:lock w:val="${lock}"/>`), options: { control: 2, text: "Denied" }, error: "unsupported-edit" });
scenarios.push({ name: "unsupported nested ancestor", body: nested("<w:docPartObj/>"), options: { control: 2, text: "Denied" }, error: "unsupported-edit" });
scenarios.push({ name: "bound scalar remains attached", body: `<w:p>${control('<w:text/><w:dataBinding w:xpath="/root/value" w:storeItemID="abc"/>')}</w:p>`, options: { control: 1, text: "Denied" }, error: "unsupported-edit" });
scenarios.push({ name: "mixed all preflight", body: `<w:p>${control("<w:text/>")}${control("<w:date/>", run, 18)}</w:p>`, options: { all: true, scope: "body", text: "Denied" }, error: "unsupported-edit" });
scenarios.push({ name: "unsupported stored scalar kind", body: `<w:p>${control('<w:docPartObj><w:docPartGallery w:val="Page Numbers"/></w:docPartObj>')}</w:p>`, options: { control: 1, text: "Denied" }, error: "unsupported-edit" });
scenarios.push({ name: "cached field intersection", body: `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${control("<w:text/>")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`, options: { control: 1, text: "Denied" }, error: "unsupported-edit" });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "native-sdk", "cli", "native-cli"] as const) for (const scenario of scenarios)
it(`complete scalar control variant ${scenario.name}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const product = route.startsWith("native") ? native : api;
  const input = await textFixture('<w:p><w:r><w:t>Outside unchanged</w:t></w:r></w:p><!--retain--><?audit exact?>' + scenario.body, {
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat/><!--settings retain--></w:settings>` }
  }, strict, { kind });
  const original = input.slice(), before = readPackage(input), memory = Volume.fromJSON({ "/output": "" });
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "sdk" || route === "native-sdk") {
    const pending = product.editDocumentControls(input, { ...scenario.options, output: "-" } as api.DocxOperationArguments<"controls.set">, context);
    if (scenario.error) {
      await expect(pending).rejects.toMatchObject({ code: scenario.error });
      if (scenario.error === "usage") await expect(pending).rejects.toBeInstanceOf(product.InvalidValueError);
    }
    else expect(await pending).toMatchObject({ changed: true, dryRun: false });
  } else {
    const fs = new MemoryFileSystem(), destination = encode("Retained forced destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination);
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const flags = Object.entries(scenario.options).map(([name, value]) => `--${name}${name === "all" ? "" : " " + quoted(String(value))}`).join(" ");
      const response = await shell.exec(`docx controls set /input ${flags} --output /output --force --json`);
      const envelope = JSON.parse(response.stdout);
      if (scenario.error) { expect(response.exitCode, response.stdout + response.stderr).toBe(scenario.error === "usage" ? 2 : 1); expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: scenario.error }] }); expect(await fs.readFile("/output")).toEqual(destination); }
      else { expect(response.exitCode, response.stdout + response.stderr).toBe(0); expect(envelope).toMatchObject({ ok: true, data: { changed: true } }); memory.writeFileSync("/output", await fs.readFile("/output")); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
  if (scenario.error) { expect(memory.statSync("/output").size).toBe(0); expect(readPackage(input)).toEqual(before); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output); assertPackageLinks(after);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const controls = (await product.inspectDocumentControls(output, {}, context)).items, index = Number(scenario.options.control) - 1;
  expect(controls[index]).toMatchObject({ value: scenario.expected, placeholder: false, tag: "bay", alias: "Original alias", lock: "unlocked", ...(scenario.kind ? { kind: scenario.kind } : {}) });
  const savedXml = new TextDecoder().decode(after.get("word/document.xml")!);
  expect(savedXml).toContain("<!--retain-->"); expect(savedXml).toContain("<?audit exact?>"); expect(savedXml).toContain("Original definition"); expect(savedXml).toContain("<w:b/>");
  if (scenario.font) { expect(savedXml).toContain(`w:ascii="${scenario.font}"`); expect(savedXml).toContain(`w:hAnsi="${scenario.font}"`); }
  expect(xmlStructure(after.get("word/document.xml")!).children.length).toBeGreaterThan(0);
  expect((await product.extractDocumentText(output, context)).text).toBe("Outside unchanged\n" + scenario.display);
  expect(readPackage(input)).toEqual(before);
});
