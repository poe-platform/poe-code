import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, run } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc = (value: string) => new TextEncoder().encode(value);
const store = "{11111111-2222-3333-4444-555555555555}";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const operation of ["controls.set", "controls.repeat", "controls.bind", "template.apply"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
for (const existing of [false, true]) for (const date of ["0001-01-01", "0000-01-01"])
it(`native date control calendar; strict=${strict}; kind=${kind}; operation=${operation}; route=${route}; existing=${existing}; date=${date}`, async () => {
  const binding = operation === "controls.bind" ? `<w:dataBinding w:storeItemID="${store}" w:xpath="/root/value"/>` : "";
  const field = `<w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="day"/>${binding}<w:date${existing ? ' w:fullDate="2000-01-01T00:00:00Z"' : ""}><w:dateFormat w:val="yyyy-MM-dd"/></w:date></w:sdtPr><w:sdtContent>${run("Old")}</w:sdtContent></w:sdt>`;
  const body = operation === "controls.repeat" ? `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${field}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>` : `<w:p>${field}</w:p>`;
  const parts = readPackage(await textFixture(body, {}, strict, { kind }));
  if (operation === "controls.bind") {
    const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
    const xml = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
    xml.insertChildren(xml.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/customXml/item.xml" ContentType="application/xml"/><Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/customXml/props.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>');
    parts.set("[Content_Types].xml", xml.serialize());
    parts.set("word/_rels/document.xml.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="store" Type="${r}/customXml" Target="../customXml/item.xml"/></Relationships>`));
    parts.set("customXml/item.xml", enc("<root><value>2000-01-01</value></root>"));
    parts.set("customXml/_rels/item.xml.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="properties" Type="${r}/customXmlProps" Target="props.xml"/></Relationships>`));
    parts.set("customXml/props.xml", enc(`<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${store}"/>`));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: sink };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), record = { values: [{ binding: "day", value: date }] };
  const arguments_ = operation === "controls.set" ? { control: 1, date } : operation === "controls.repeat" ? { control: 1, data: [record] } : operation === "controls.bind" ? { all: true, binding: "day", valueJson: date } : { data: record };
  const ops = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
  const refusal = date.startsWith("0000");
  if (route.startsWith("sdk")) {
    const pending = route === "sdk-batch" ? api.executeDocumentBatch(input, ops, { output: "-" }, context) : operation === "controls.set" ? api.editDocumentControls(input, { control: 1, date, output: "-" }, context) : operation === "controls.repeat" ? api.editDocumentControlRepeats(input, { control: 1, data: [record], output: "-" }, context) : operation === "controls.bind" ? api.editDocumentControlBindings(input, { all: true, binding: "day", valueJson: date, output: "-" }, context) : api.applyDocumentTemplate(input, { data: record, output: "-" }, context);
    if (refusal) await expect(pending).rejects.toMatchObject({ code: "usage" }); else await pending;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = enc("Retained destination"); await fs.writeFile("/destination", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const flags = operation === "controls.set" ? `--control 1 --date ${date}` : operation === "controls.repeat" ? `--control 1 --data-json '${JSON.stringify([record])}'` : operation === "controls.bind" ? `--all --binding day --value-json '"${date}"'` : `--data-json '${JSON.stringify(record)}'`;
      const result = await shell.exec((route === "cli" ? `docx ${operation.split(".").join(" ")} /input ${flags}` : `docx batch /input --ops-json '${JSON.stringify(ops)}'`) + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(refusal ? 2 : 0);
      if (refusal) { expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "usage" }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
      else memory.writeFileSync("/output", await fs.readFile("/destination"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (refusal) expect(memory.statSync("/output").size).toBe(0);
  else {
    const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
    expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(date + "T00:00:00Z");
    for (const [part, bytes] of parts) if (part !== "word/document.xml" && !(operation === "controls.bind" && part === "customXml/item.xml")) expect(after.get(part), part).toEqual(bytes);
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
