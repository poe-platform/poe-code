import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const encode = (value: string) => new TextEncoder().encode(value);
type Carrier = "direct" | "choice" | "fallback" | "process" | "ignored" | "inactive";
function wrap(carrier: Carrier, value: string) {
  if (carrier === "direct") return value;
  if (carrier === "choice" || carrier === "fallback" || carrier === "inactive")
    return `<mc:AlternateContent><mc:Choice Requires="${carrier === "fallback" ? "u" : "w"}">${carrier === "choice" ? value : ""}</mc:Choice><mc:Fallback>${carrier === "choice" ? "" : value}</mc:Fallback></mc:AlternateContent>`;
  return `<u:${carrier === "process" ? "bridge" : "ignored"}>${value}</u:${carrier === "process" ? "bridge" : "ignored"}>`;
}
const types = [
  { xml: "<w:text/>", kind: "plain-text", value: "Coastal cache", choices: [] },
  { xml: '<w:date w:fullDate="2026-03-04T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>', kind: "date", value: "2026-03-04T00:00:00Z", choices: [] },
  { xml: '<w:dropDownList><w:listItem w:value="coast" w:displayText="Coastal label"/></w:dropDownList>', kind: "dropdown", value: "Coastal cache", choices: [{ value: "coast", label: "Coastal label" }] },
  { xml: '<c:checkbox><c:checked c:val="1"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>', kind: "checkbox", value: true, choices: [] }
] as const;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "ignored", "inactive"] as const)
for (const type of types) for (const route of ["sdk", "cli"] as const)
  it(`${route} reads active control declarations in ${carrier}; ${type.kind}; ${kind}; strict=${strict}`, async () => {
    const declarations = type.xml + '<w:id w:val="31"/><w:tag w:val="coast"/><w:alias w:val="Coastal field"/><w:lock w:val="sdtContentLocked"/><w:showingPlcHdr/><w:dataBinding w:storeItemID="coastal-store" w:xpath="/root/value"/>';
    const input = await textFixture(`<w:p><w:sdt xmlns:mc="${mc}" xmlns:u="urn:original:control-carrier" xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="u c" mc:ProcessContent="u:bridge"><w:sdtPr>${wrap(carrier, declarations)}</w:sdtPr><w:sdtContent><w:r><w:t>Coastal cache</w:t></w:r></w:sdtContent></w:sdt></w:p>`, {}, strict, { kind });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input) });
    let items: readonly api.ControlSnapshot[];
    if (route === "sdk") items = (await api.inspectDocumentControls(input, {}, textContext)).items;
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const read = await shell.exec("docx controls list /input --json");
        expect(read.exitCode, read.stdout + read.stderr).toBe(0);
        items = JSON.parse(read.stdout).data.items;
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject(carrier === "ignored" || carrier === "inactive" ? {
      kind: "rich-text", value: "Coastal cache", id: null, tag: null, alias: null, lock: "unlocked", placeholder: false, binding: null, choices: [], support: "supported"
    } : {
      kind: type.kind, value: type.value, id: "31", tag: "coast", alias: "Coastal field", lock: "sdtContentLocked", placeholder: true,
      binding: { storeItemId: "coastal-store", xpath: "/root/value", prefixMappings: null }, choices: type.choices, support: "supported"
    });
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const type of types) for (const route of ["sdk", "cli"] as const)
  it(`${route} fills active typed control declarations in ${carrier}; ${type.kind}; ${kind}; strict=${strict}`, async () => {
    const declarations = type.xml + '<w:id w:val="31"/><w:tag w:val="coast"/><w:showingPlcHdr/>';
    const input = await textFixture(`<w:p><w:sdt xmlns:mc="${mc}" xmlns:u="urn:original:control-carrier" xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="u c" mc:ProcessContent="u:bridge"><w:sdtPr>${wrap(carrier, declarations)}<w:placeholder><w:docPart w:val="Retained definition"/></w:placeholder><!--retain--><?audit exact?></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Coastal cache</w:t></w:r></w:sdtContent></w:sdt></w:p>`, {}, strict, { kind });
    const values = type.kind === "checkbox" ? { checked: false } : type.kind === "date" ? { date: "2024-02-29" } : type.kind === "dropdown" ? { choice: "coast" } : { text: "Changed 海\t🌊\nCoast" };
    const flags = type.kind === "checkbox" ? "--checked false" : type.kind === "date" ? "--date 2024-02-29" : type.kind === "dropdown" ? "--choice coast" : "--text 'Changed 海\t🌊\nCoast'";
    const expected = type.kind === "checkbox" ? false : type.kind === "date" ? "2024-02-29T00:00:00Z" : type.kind === "dropdown" ? "Coastal label" : "Changed 海\t🌊\nCoast";
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    if (route === "sdk") await api.editDocumentControls(input, { control: 1, ...values, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const edited = await shell.exec(`docx controls set /input --control 1 ${flags} --output /output --json`);
        expect(edited.exitCode, edited.stdout + edited.stderr).toBe(0);
        memory.writeFileSync("/output", await fs.readFile("/output"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    expect((await api.inspectDocumentControls(output, {}, textContext)).items[0]).toMatchObject({ kind: type.kind, value: expected, id: "31", tag: "coast", placeholder: false });
    const before = readPackage(input), after = readPackage(output);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    const xml = new TextDecoder().decode(after.get("word/document.xml"));
    expect(xml).toContain('<w:placeholder><w:docPart w:val="Retained definition"/></w:placeholder><!--retain--><?audit exact?>');
    expect(xml).toContain("<w:i/>");
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const route of ["sdk", "cli"] as const)
  it(`${route} rejects unsynchronized bound control fill in ${carrier}; ${kind}; strict=${strict}`, async () => {
    const input = await textFixture(`<w:p><w:sdt xmlns:mc="${mc}" xmlns:u="urn:original:control-carrier" mc:Ignorable="u" mc:ProcessContent="u:bridge"><w:sdtPr><w:text/>${wrap(carrier, '<w:dataBinding w:storeItemID="coastal-store" w:xpath="/root/value"/>')}</w:sdtPr><w:sdtContent><w:r><w:t>Coastal cache</w:t></w:r></w:sdtContent></w:sdt></w:p>`, {}, strict, { kind });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    if (route === "sdk") {
      await expect(api.editDocumentControls(input, { control: 1, text: "Changed", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(memory.readFileSync("/output")).toHaveLength(0);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", encode("Existing destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const edited = await shell.exec("docx controls set /input --control 1 --text Changed --output /output --force --json");
        expect(edited.exitCode, edited.stdout + edited.stderr).toBe(1);
        expect(JSON.parse(edited.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "unsupported-edit" }] });
        expect(await fs.readFile("/output")).toEqual(encode("Existing destination"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
