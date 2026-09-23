import { Volume } from "memfs";
import { expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const native = await compiledPublicRuntime, encode = (value: string) => new TextEncoder().encode(value);
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
const marker = (name: string) => `<!--retained ${name} 海🌊--><?audit ${name}?>`;
const positions = ["content", "block-content", "paragraph", "run", "text", "second-run", "second-paragraph", "fonts", "paragraph-properties", "second-paragraph-properties", "placeholder", "combined", "empty-run", "empty-first-paragraph"] as const;
const scalars = [
  { kind: "plain", properties: "<w:text/>", options: { text: "New\t海\n🌊" }, value: "New\t海\n🌊", display: "New\t海\n🌊" },
  { kind: "rich", properties: "<w:richText/>", options: { text: "New\t海\n🌊" }, value: "New\t海\n🌊", display: "New\t海\n🌊" },
  ...["dropDownList", "comboBox"].map(kind => ({ kind, properties: `<w:${kind}><w:listItem w:value="old" w:displayText="Old"/><w:listItem w:value="new" w:displayText="New 海"/></w:${kind}>`, options: { choice: "new" }, value: "new", display: "New 海" })),
  { kind: "checkbox", properties: '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="0"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>', options: { checked: false }, value: false, display: "☐" },
  { kind: "date", properties: '<w:date w:fullDate="2000-01-01T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>', options: { date: "2000-02-29" }, value: "2000-02-29", display: "2000-02-29" }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const) for (const runtime of ["source", "native"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
for (const operation of ["controls.set", "controls.repeat", "controls.bind", "template.apply"] as const)
for (const scalar of scalars) for (const position of positions)
it(`retains every legal XML comment and PI while filling scalar controls; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; operation=${operation}; scalar=${scalar.kind}; position=${position}`, async () => {
  const product: typeof api = runtime === "native" ? native : api, context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const has = (name: typeof positions[number]) => position === name || position === "combined";
  const fonts = `<w:rFonts w:ascii="Old" w:hAnsi="Old">${has("fonts") ? marker("fonts") : ""}</w:rFonts>`;
  const run = `<w:r>${has("run") || position === "empty-run" ? marker("run-start") : ""}<w:rPr><w:b/>${fonts}</w:rPr>${position === "empty-run" ? "" : `<w:t>${has("text") ? marker("text-start") : ""}Old${has("text") ? marker("text-end") : ""}</w:t>`}${has("run") ? marker("run-end") : ""}</w:r>`;
  const secondRun = has("second-run") ? `<w:r>${marker("second-run-start")}<w:t>Tail${marker("second-text")}</w:t>${marker("second-run-end")}</w:r>` : "";
  const paragraph = `<w:p>${has("paragraph") ? marker("paragraph-start") : ""}<w:pPr><w:keepNext/>${has("paragraph-properties") ? marker("paragraph-properties") : ""}</w:pPr>${position === "empty-first-paragraph" ? "" : run + secondRun}${has("paragraph") ? marker("paragraph-end") : ""}</w:p>`;
  const secondParagraph = has("second-paragraph") || has("second-paragraph-properties") || position === "empty-first-paragraph" ? `<w:p>${marker("second-paragraph-start")}<w:pPr><w:keepNext/>${marker("second-paragraph-properties")}</w:pPr>${position === "empty-first-paragraph" ? run : `<w:r><w:t>Tail${marker("second-paragraph-text")}</w:t></w:r>`}${marker("second-paragraph-end")}</w:p>` : "";
  const block = operation !== "controls.repeat" && ["block-content", "paragraph", "second-paragraph", "paragraph-properties", "second-paragraph-properties", "empty-first-paragraph", "combined"].includes(position);
  const store = "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}";
  const binding = operation === "controls.bind" ? `<w:dataBinding w:storeItemID="${store}" w:xpath="/record/value"/>` : "";
  const field = `<w:sdt><w:sdtPr><w:id w:val="17"/><w:tag w:val="field"/>${scalar.properties}${binding}<w:showingPlcHdr>${has("placeholder") ? marker("placeholder") : ""}</w:showingPlcHdr></w:sdtPr><w:sdtContent>${has("content") || has("block-content") ? marker("content-start") : ""}${block ? paragraph + secondParagraph : run + secondRun}${has("content") || has("block-content") ? marker("content-end") : ""}</w:sdtContent></w:sdt>`;
  const repeatPrefix = position === "empty-first-paragraph" ? `<w:p>${marker("empty-prototype-paragraph")}</w:p>` : "";
  const repeatSuffix = has("second-paragraph") || has("second-paragraph-properties") ? `<w:p>${marker("second-paragraph-start")}<w:pPr><w:keepNext/>${marker("second-paragraph-properties")}</w:pPr><w:r><w:t>${marker("second-paragraph-text")}</w:t></w:r>${marker("second-paragraph-end")}</w:p>` : "";
  const regionBody = repeatPrefix + `<w:p>${has("paragraph") ? marker("paragraph-start") : ""}<w:pPr><w:keepNext/>${has("paragraph-properties") ? marker("paragraph-properties") : ""}</w:pPr>${field}${has("paragraph") ? marker("paragraph-end") : ""}</w:p>` + repeatSuffix;
  const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="10"/><w:tag w:val="records"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="11"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent>${regionBody}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const body = operation === "controls.repeat" ? region : block ? field : `<w:p>${field}</w:p>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Outside 海🌊</w:t></w:r></w:p>' + body + marker("body"), {}, strict, { kind }));
  if (operation === "controls.bind") {
    const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
    const types = new product.DocumentXmlEditor(parts.get("[Content_Types].xml")!); types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/data/props.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/data/item.xml" ContentType="application/xml"/>'); parts.set("[Content_Types].xml", types.serialize());
    parts.set("word/_rels/document.xml.rels", encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="store" Type="${r}/customXml" Target="../data/item.xml"/></Relationships>`));
    parts.set("data/item.xml", encode(`<record xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema"><value xsi:type="xs:${scalar.kind === "checkbox" ? "boolean" : "string"}">${scalar.kind === "checkbox" ? "false" : "Old"}</value></record>`));
    parts.set("data/props.xml", encode(`<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${store}"/>`)); parts.set("data/_rels/item.xml.rels", encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="props" Type="${r}/customXmlProps" Target="props.xml"/></Relationships>`));
  }
  const decoding = codec === "utf16be" ? "utf-16be" : codec === "utf16le" ? "utf-16le" : "utf-8";
  for (const [name, bytes] of parts) {
    const original = new TextDecoder().decode(bytes); let encoded = bytes;
    if (codec !== "utf8") { const buffer = Buffer.from("\ufeff" + original, "utf16le"); if (codec === "utf16be") buffer.swap16(); encoded = new Uint8Array(buffer); expect([...encoded.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]); }
    expect(new TextDecoder(decoding).decode(encoded)).toBe(original); parts.set(name, encoded);
  }
  const trivia = (bytes: Uint8Array) => { const result: unknown[] = [], parser = new SaxesParser({ xmlns: true }); parser.on("comment", text => result.push({ kind: "comment", text })); parser.on("processinginstruction", value => result.push({ kind: "pi", target: value.target, body: value.body })); parser.write(new TextDecoder(decoding).decode(bytes)).close(); return result; };
  const expectedTrivia = trivia(parts.get("word/document.xml")!), memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), record = { values: [{ binding: "field", value: scalar.value }] };
  const arguments_ = operation === "controls.set" ? { control: 1, ...scalar.options } : operation === "controls.repeat" ? { control: 1, data: [record] } : operation === "controls.bind" ? { all: true, binding: "field", valueJson: scalar.value } : { data: record };
  const batch = { version: 1, operations: [{ operation, arguments: arguments_ }] }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route.startsWith("sdk")) {
    if (route === "sdk-batch") await product.executeDocumentBatch(input, batch, { output: "-" }, { ...context, stdout: sink });
    else if (operation === "controls.set") await product.editDocumentControls(input, { control: 1, ...scalar.options, output: "-" }, { ...context, stdout: sink });
    else if (operation === "controls.repeat") await product.editDocumentControlRepeats(input, { control: 1, data: [record], output: "-" }, { ...context, stdout: sink });
    else if (operation === "controls.bind") await product.editDocumentControlBindings(input, { all: true, binding: "field", valueJson: scalar.value, output: "-" }, { ...context, stdout: sink });
    else await product.applyDocumentTemplate(input, { data: record, output: "-" }, { ...context, stdout: sink });
  } else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", encode(JSON.stringify(batch)));
    const flags = operation === "controls.set" ? "--control 1 " + Object.entries(scalar.options).map(([name, value]) => `--${name} ${quote(String(value))}`).join(" ") : operation === "controls.repeat" ? `--control 1 --data-json ${quote(JSON.stringify([record]))}` : operation === "controls.bind" ? `--all --binding field --value-json ${quote(JSON.stringify(scalar.value))}` : `--data-json ${quote(JSON.stringify(record))}`;
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const response = await shell.exec((route === "cli-batch" ? "docx batch /input --ops-file /ops" : `docx ${operation.split(".").join(" ")} /input ${flags}`) + " --output /output --force --json"); if (response.exitCode !== 0) expect(await fs.readFile("/output")).toEqual(destination); expect(response.exitCode, response.stdout + response.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(original); memory.writeFileSync("/output", await fs.readFile("/output")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  assertPackageLinks(new Map([...saved].map(([name, bytes]) => [name, encode(new TextDecoder(decoding, { fatal: true }).decode(bytes))])));
  if (codec !== "utf8") expect([...saved.get("word/document.xml")!.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]);
  expect(trivia(saved.get("word/document.xml")!)).toEqual(expectedTrivia);
  expect([...saved.keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of parts) if (name !== "word/document.xml" && !(operation === "controls.bind" && name === "data/item.xml")) expect(saved.get(name), name).toEqual(bytes);
  expect((await product.extractDocumentText(output, context)).text).toBe("Outside 海🌊\n" + (operation === "controls.repeat" && repeatPrefix ? "\n" : "") + scalar.display + (operation === "controls.repeat" && repeatSuffix ? "\n" : ""));
  const fields = (await product.inspectDocumentControls(output, {}, context)).items.filter(item => item.tag === "field"); expect(fields).toHaveLength(1); expect(fields[0]!.placeholder).toBe(false);
  expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
