import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const type of ["paragraph", "table", "numbering"] as const)
for (const existing of [false, true]) for (const route of ["sdk", "shell"] as const)
it(`${route} switches ${type} default while inserting only the selected tab; strict=${strict}; kind=${kind}; existing=${existing}`, async () => {
  const oldProps = '<w:pPr><w:tabs><w:tab w:pos="720" w:val="center" f:identity="old"/></w:tabs></w:pPr>', selectedProps = existing ? '<w:pPr><w:tabs><w:tab w:pos="1800" w:val="decimal" f:identity="selected"/></w:tabs></w:pPr>' : "";
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:tab-default" mc:Ignorable="f"><w:style w:type="${type}" w:styleId="old" w:default="1"><w:name w:val="Old Native"/>${oldProps}</w:style><w:style w:type="${type}" w:styleId="selected"><w:name w:val="New Native"/>${selectedProps}<!--retain--><?audit keep?></w:style></w:styles>`}}, strict)), memory = Volume.fromJSON({"/input": "", "/out": ""});
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), tabStopAdd = {position: {value: 360, unit: "twip" as const}}, context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}};
  if (route === "sdk") await api.editDocumentStyles(input, {operation: "styles.set", name: "New Native", defaultForType: true, tabStopAdd, output: "-"}, context);
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try {const r = await shell.exec(`docx styles set /input --name 'New Native' --default-for-type true --tab-stop-add-json '${JSON.stringify(tabStopAdd)}' --output /out --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out"));} finally {await shell.dispose();}}
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext), xml = new api.DocumentXmlEditor(after.get("word/styles.xml")!), nodes = xml.root.children.filter(n => n.localName === "style"), old = nodes[0]!, selected = nodes[1]!;
  expect(old.attributes.some(a => a.namespace === old.namespace && a.localName === "default")).toBe(false);
  expect(selected.attributes.find(a => a.namespace === selected.namespace && a.localName === "default")?.value).toBe("1");
  const positions = (node: api.XmlElement) => node.children.find(n => n.localName === "pPr")!.children.find(n => n.localName === "tabs")!.children.map(n => Number(n.attributes.find(a => a.namespace === node.namespace && a.localName === "pos")!.value));
  expect(positions(old)).toEqual([720]); expect(positions(selected)).toEqual(existing ? [360, 1800] : [360]);
  const saved = new TextDecoder().decode(after.get("word/styles.xml")); expect(saved).toContain(oldProps); if (existing) expect(saved).toContain('f:identity="selected"'); expect(saved.split("<!--retain-->")).toHaveLength(2); expect(saved.split("<?audit keep?>")).toHaveLength(2); expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
