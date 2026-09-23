import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const store = "{11111111-2222-3333-4444-555555555555}";
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
const attribute = (value: string) => value.split("&").join("&amp;").split('"').join("&quot;").split("<").join("&lt;");
interface Scenario {
  name: string; xpath?: string; mappings?: string; leaf?: string; item?: string;
  value?: string | boolean | number; controlType?: string; propertiesMode?: string;
  alias?: string; error?: string; display?: string; scalar?: string;
  snapshotValue?: string | boolean; jsonValueLexeme?: string;
}
const scenarios: Scenario[] = [
  { name: "double largest finite", leaf: '<v:value xsi:type="xs:double">8</v:value>', value: Number.MAX_VALUE, display: String(Number.MAX_VALUE), jsonValueLexeme: BigInt(Number.MAX_VALUE).toString() },
  { name: "double smallest positive", leaf: '<v:value xsi:type="xs:double">8</v:value>', value: Number.MIN_VALUE, display: String(Number.MIN_VALUE) },
  { name: "double positive Infinity", leaf: '<v:value xsi:type="xs:double">8</v:value>', value: Infinity, error: "usage", jsonValueLexeme: "1e999" },
  { name: "double negative Infinity", leaf: '<v:value xsi:type="xs:double">8</v:value>', value: -Infinity, error: "usage", jsonValueLexeme: "-1e999" },
  { name: "double NaN", leaf: '<v:value xsi:type="xs:double">8</v:value>', value: NaN, error: "usage", jsonValueLexeme: "NaN" }
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
for (const scenario of scenarios)
it(`finite binding boundary ${scenario.name}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const product = route.startsWith("native") ? native : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
  const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
  const descriptor = `<w:dataBinding w:storeItemID="${store}" w:xpath="${attribute(scenario.xpath ?? "/v:root/v:value")}" w:prefixMappings="${attribute(scenario.mappings ?? "xmlns:v='urn:original:bound'")}"/>`;
  const control = (tag: string, extra = "") => `<w:sdt><w:sdtPr>${scenario.controlType ?? "<w:text/>"}<w:tag w:val="${tag}"/>${descriptor}${extra}</w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>`;
  const alias = scenario.alias === "<w:picture/>" ? control("alias").replace("<w:text/>", "<w:picture/>") : control("alias", scenario.alias);
  const edge = `<Relationship Id="properties" Type="${r}/customXmlProps" Target="${scenario.propertiesMode === "external" ? "https://example.invalid/no-fetch" : "props.xml"}"${scenario.propertiesMode === "external" ? ' TargetMode="External"' : ""}/>`;
  const values = new Map<string, string>([
    ["[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/stories/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml"/><Override PartName="/data/props.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`],
    ["_rels/.rels", `<Relationships xmlns="${pr}"><Relationship Id="main" Type="${r}/officeDocument" Target="stories/main.xml"/></Relationships>`],
    ["stories/main.xml", `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Outside retained</w:t></w:r></w:p><w:p>${control("target")}${alias}</w:p><!--retain--><?audit body?></w:body></w:document>`],
    ["stories/_rels/main.xml.rels", `<Relationships xmlns="${pr}"><Relationship Id="store" Type="${r}/customXml" Target="../data/item.xml"/><Relationship Id="audit" Type="urn:original:inert" Target="https://example.invalid/no-fetch" TargetMode="External"/><!--retain--></Relationships>`],
    ["data/item.xml", scenario.item ?? `<v:root xmlns:v="urn:original:bound" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema">${scenario.leaf ?? "<v:value>Old</v:value>"}<!--retain--><?audit data?></v:root>`],
    ["data/props.xml", `<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${scenario.propertiesMode === "mismatched-id" ? "{99999999-2222-3333-4444-555555555555}" : store}"/>`],
    ["data/_rels/item.xml.rels", `<Relationships xmlns="${pr}">${scenario.propertiesMode === "missing" ? "" : edge}${scenario.propertiesMode === "duplicate" ? edge.replace('Id="properties"', 'Id="second"') : ""}<!--retain--><?audit props?></Relationships>`]
  ]);
  const parts = new Map([...values].map(([name, xml]) => { const bytes = codec === "utf8" ? new TextEncoder().encode(xml) : Buffer.from("\ufeff" + xml, "utf16le"); if (codec === "utf16be") (bytes as Buffer).swap16(); return [name, new Uint8Array(bytes)] as const; }));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), value = scenario.value ?? "New海🌊";
  const arguments_ = { all: true, binding: "target", valueJson: value }, operations = { version: 1 as const, operations: [{ operation: "controls.bind" as const, arguments: arguments_ }] };
  if (route.includes("sdk")) {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route.endsWith("batch") ? product.executeDocumentBatch(input, operations, { output: "-" }, io) : product.editDocumentControlBindings(input, { ...arguments_, output: "-" }, io);
    if (scenario.error) await expect(pending).rejects.toMatchObject({ code: scenario.error }); else await pending;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = new TextEncoder().encode("Retained forced destination"); await fs.writeFile("/output", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      if (value === Number.MAX_VALUE) {
        const rounded = route.endsWith("batch") ? `docx batch /input --ops-json ${quote(JSON.stringify(operations))}` : `docx controls bind /input --all --binding target --value-json ${quote(JSON.stringify(value))}`;
        const rejected = await shell.exec(rounded + " --output /output --force --json");
        expect(rejected.exitCode, rejected.stdout + rejected.stderr).toBe(2);
        expect(JSON.parse(rejected.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
        expect(await fs.readFile("/output")).toEqual(retained);
        expect(await fs.readFile("/input")).toEqual(original);
      }
      const encodedOperations = scenario.jsonValueLexeme ? JSON.stringify(operations).replace('"valueJson":' + JSON.stringify(value), '"valueJson":' + scenario.jsonValueLexeme) : JSON.stringify(operations);
      const command = route.endsWith("batch") ? `docx batch /input --ops-json ${quote(encodedOperations)}` : `docx controls bind /input --all --binding target --value-json ${quote(scenario.jsonValueLexeme ?? JSON.stringify(value))}`;
      const response = await shell.exec(command + " --output /output --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(scenario.error ? scenario.error === "usage" ? 2 : 1 : 0);
      if (scenario.error) { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: scenario.error }] }); expect(await fs.readFile("/output")).toEqual(retained); }
      else { expect(JSON.parse(response.stdout).ok).toBe(true); memory.writeFileSync("/output", await fs.readFile("/output")); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
  if (scenario.error) { expect(memory.statSync("/output").size).toBe(0); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect([...after.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) if (!["stories/main.xml", "data/item.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const snapshots = (await product.inspectDocumentControls(output, {}, context)).items;
  const snapshotValue = scenario.snapshotValue ?? scenario.display;
  expect(snapshots.map(item => item.value)).toEqual([snapshotValue, snapshotValue]);
  expect(snapshots.map(item => item.binding)).toEqual([snapshots[0]!.binding, snapshots[0]!.binding]); expect(snapshots[0]!.binding!.storeItemId).toBe(store);
  expect((await product.extractDocumentText(output, context)).text).toBe("Outside retained\n" + scenario.display + scenario.display);
  const parsed = await product.parseDocumentXmlAsync(after.get("data/item.xml")!);
  const leaf = scenario.name === "scalar root" ? parsed.root : parsed.root.children[0]!;
  expect(leaf.text).toBe(String(value)); expect((await product.validateDocument(output, context)).valid).toBe(true);
});
