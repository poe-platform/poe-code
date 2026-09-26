import { Volume } from "memfs";
import { expect, it, vi } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

// Binding and byte fidelity use the scheduling port without host task latency.
// The external compiled runtime retains real scheduling and its public routes.
vi.mock("@poe-code/office-package", async importOriginal => ({
  ...await importOriginal<typeof import("@poe-code/office-package")>(),
  yieldEventLoop: async () => {}
}));

const store = "{11111111-2222-3333-4444-555555555555}";
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
const attribute = (value: string) => value.split("&").join("&amp;").split('"').join("&quot;").split("<").join("&lt;");
interface Scenario {
  name: string; xpath?: string; mappings?: string; leaf?: string; item?: string;
  value?: string | boolean | number; controlType?: string; propertiesMode?: string;
  alias?: string; error?: string; display?: string; scalar?: string;
  snapshotValue?: string | boolean;
}
const scenarios: Scenario[] = [
  ...[false, true].map(value => ({ name: `typed checkbox ${value}`, controlType: '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="1"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>', leaf: '<v:value xsi:type="xs:boolean">true</v:value>', value, display: value ? "☒" : "☐", snapshotValue: value })),
  ...["dropDownList", "comboBox"].map(type => ({ name: `typed ${type} stored value`, controlType: `<w:${type}><w:listItem w:value="stored" w:displayText="Displayed海"/></w:${type}>`, value: "stored", display: "Displayed海" })),
  { name: "typed choice label refuses", controlType: '<w:dropDownList><w:listItem w:value="stored" w:displayText="Displayed海"/></w:dropDownList>', value: "Displayed海", error: "usage" },
  { name: "typed checkbox string refuses", controlType: '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="1"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>', leaf: '<v:value xsi:type="xs:boolean">true</v:value>', value: "false", error: "unsupported-edit" },
  { name: "typed date leap cache", controlType: '<w:date><w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="en-GB"/><w:calendar w:val="gregorian"/></w:date>', value: "2000-02-29", display: "29/02/2000", snapshotValue: "2000-02-29T00:00:00Z" },
  { name: "string", display: "New海🌊" },
  { name: "empty string", value: "", display: "" },
  { name: "XML literal", value: "<&\r\n]]>", display: "<&\r\n]]>" },
  { name: "self-closing leaf", leaf: "<v:value/>", display: "New海🌊" },
  { name: "CDATA leaf", leaf: "<v:value><![CDATA[Old]]></v:value>", value: "]]>", display: "]]>" },
  { name: "scalar root", xpath: "/v:root", item: '<v:root xmlns:v="urn:original:bound"><![CDATA[Old]]></v:root>', display: "New海🌊" },
  { name: "empty namespace", xpath: "/root/value", mappings: "", item: "<root><value>Old</value></root>", display: "New海🌊" },
  { name: "integer zero", leaf: '<v:value xsi:type="xs:integer">8</v:value>', value: 0, display: "0", scalar: "0" },
  { name: "integer lower safe boundary", leaf: '<v:value xsi:type="xs:integer">8</v:value>', value: Number.MIN_SAFE_INTEGER, display: String(Number.MIN_SAFE_INTEGER) },
  { name: "integer upper safe boundary", leaf: '<v:value xsi:type="xs:integer">8</v:value>', value: Number.MAX_SAFE_INTEGER, display: String(Number.MAX_SAFE_INTEGER) },
  { name: "integer fraction", leaf: '<v:value xsi:type="xs:integer">8</v:value>', value: 0.5, error: "unsupported-edit" },
  { name: "integer unsafe", leaf: '<v:value xsi:type="xs:integer">8</v:value>', value: Number.MAX_SAFE_INTEGER + 1, error: "unsupported-edit" },
  { name: "double exponent", leaf: '<v:value xsi:type="xs:double">8</v:value>', value: 1e-100, display: "1e-100" },
  { name: "double zero", leaf: '<v:value xsi:type="xs:double">8</v:value>', value: 0, display: "0" },
  { name: "wrong schema type namespace", leaf: '<v:value xmlns:z="urn:inert:type" xsi:type="z:string">Old</v:value>', error: "unsupported-edit" },
  { name: "unsupported schema type", leaf: '<v:value xsi:type="xs:decimal">8</v:value>', value: 8, error: "unsupported-edit" },
  { name: "text boolean mismatch", leaf: '<v:value xsi:type="xs:boolean">true</v:value>', value: false, error: "unsupported-edit" },
  { name: "string number mismatch", value: 0, error: "unsupported-edit" },
  { name: "duplicate scalar", leaf: "<v:value>A</v:value><v:value>B</v:value>", error: "unsupported-edit" },
  { name: "missing scalar", leaf: "<v:other/>", error: "unsupported-edit" },
  { name: "wrong scalar namespace", leaf: '<x:value xmlns:x="urn:inert">Old</x:value>', error: "unsupported-edit" },
  ...["<v:value><v:child/></v:value>", "<v:value>Mixed<v:child/>text</v:value>", "<v:value><!--retain--></v:value>", "<v:value><?audit retain?></v:value>"].map((leaf, index) => ({ name: `nonscalar leaf ${index}`, leaf, error: "unsupported-edit" })),
  ...["/v:root//v:value", "/v:root/../v:value", "/v:root/*", "/v:root/v:value[1]", "/v:root/@value", "/v:root/text()", "/v:root/v:value|/v:root/v:other", "/v:root/child::v:value", "v:root/v:value", "/", "/v:root/", "/x:root/x:value"].map(xpath => ({ name: `unsupported selector ${xpath}`, xpath, error: "unsupported-edit" })),
  ...["", "xmlns:v='urn:original:bound' xmlns:v='urn:original:bound'", "xmlns:v=unquoted", "extra='urn:original:bound'", "xmlns:v='urn:wrong'"].map(mappings => ({ name: `invalid mapping ${mappings}`, mappings, error: "unsupported-edit" })),
  ...["missing", "external", "duplicate", "mismatched-id"].map(propertiesMode => ({ name: `properties ownership ${propertiesMode}`, propertiesMode, error: "unsupported-edit" })),
  { name: "locked alias", alias: '<w:lock w:val="contentLocked"/>', error: "unsupported-edit" },
  { name: "unsupported picture alias", alias: "<w:picture/>", error: "unsupported-edit" }
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
for (const scenario of scenarios)
it(`complete binding selector ${scenario.name}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
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
      const command = route.endsWith("batch") ? `docx batch /input --ops-json ${quote(JSON.stringify(operations))}` : `docx controls bind /input --all --binding target --value-json ${quote(JSON.stringify(value))}`;
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
