import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { readArchive, writeArchive } from "./index.js";
import { textFixture, textContext, run, r } from "../tests/fixtures/text.js";
import { inspectDocumentControls } from "./controls.js";
import * as xmlParser from "./package-xml.js";
import { ResourceLimitError } from "./archive.js";

const store = "{11111111-2222-3333-4444-555555555555}";
it("preserves parser resource failure when admitting stored mappings", async () => {
  const input = await fixture(), original = xmlParser.parseDocumentXml;
  const spy = vi.spyOn(xmlParser, "parseDocumentXml").mockImplementation((bytes, limits, budget) => { if (new TextDecoder().decode(bytes).startsWith("<mapping ")) throw new ResourceLimitError("Mapping budget"); return original(bytes, limits, budget); });
  try { await expect(bind(input, "New", { dryRun: true })).rejects.toBeInstanceOf(ResourceLimitError); } finally { spy.mockRestore(); }
});
it("keeps QName validation within the invocation parser budget", async () => {
  const input = await fixture(); const spy = vi.spyOn(xmlParser, "parseDocumentXml");
  try {
    await bind(input, "New", { dryRun: true, limit: [{ name: "xmlNodes", value: 100000 }] });
    const names = spy.mock.calls.filter(([bytes]) => new TextDecoder().decode(bytes).includes('="urn:validation"'));
    expect(names.length).toBeGreaterThan(0); expect(names.every(([, , budget]) => budget?.limits.xmlNodes === 100000)).toBe(true);
  } finally { spy.mockRestore(); }
});
const binding = (tag: string, extra = "", xpath = "/v:root/v:value") => `<w:sdt><w:sdtPr><w:text/><w:tag w:val="${tag}"/><w:dataBinding w:storeItemID="${store}" w:xpath="${xpath}" w:prefixMappings="xmlns:v='urn:harbor:records'"/>${extra}</w:sdtPr><w:sdtContent>${run("Old")}</w:sdtContent></w:sdt>`;
async function fixture(body = binding("bay") + binding("alias"), scalar = "<v:value>Old</v:value>") {
  const archive = await readArchive(await textFixture(`<w:p>${body}</w:p>`), textContext);
  const enc = new TextEncoder();
  const members = archive.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: enc.encode(new TextDecoder().decode(member.bytes).replace("</Types>", '<Default Extension="xml" ContentType="application/xml"/></Types>')) } : member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: enc.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="store" Type="${r}/customXml" Target="../customXml/item.xml"/></Relationships>`) } : member);
  for (const [name, xml] of Object.entries({ "customXml/item.xml": `<v:root xmlns:v="urn:harbor:records" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema">${scalar}</v:root>`, "customXml/_rels/item.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="properties" Type="${r}/customXmlProps" Target="props.xml"/></Relationships>`, "customXml/props.xml": `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="${store}"/>` })) members.push({ name, bytes: enc.encode(xml), directory: false, modified: new Date("2025-01-02T03:04:06Z") });
  const fs = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(fs.readFileSync("/archive") as Buffer);
}
async function bind(input: Uint8Array, valueJson: string | number | boolean, options = {}) {
  const { editDocumentControlBindings } = await import("./control-bindings.js");
  const fs = Volume.fromJSON({ "/output": "" });
  const result = await editDocumentControlBindings(input, { all: true, binding: "bay", valueJson, output: "-", ...options }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } });
  const bytes = new Uint8Array(fs.readFileSync("/output") as Buffer);
  return { result, bytes };
}
it.each(["New", "", "<&\r\n"])("synchronizes singleton store and differently tagged aliases for %j", async value => {
  const { bytes, result } = await bind(await fixture(), value);
  expect(result.changes).toHaveLength(2);
  expect((await inspectDocumentControls(bytes, {}, textContext)).items.map(item => item.value)).toEqual([value, value]);
  const xml = new TextDecoder().decode((await readArchive(bytes, textContext)).members.find(member => member.name === "customXml/item.xml")!.bytes);
  const { parseDocumentXml } = await import("./package-xml.js");
  expect(parseDocumentXml(new TextEncoder().encode(xml)).root.children[0]!.text).toBe(value);
  expect((await inspectDocumentControls(bytes, {}, textContext)).items.every(item => item.binding !== null)).toBe(true);
});
it("retains false in an explicitly boolean store and checkbox recipient", async () => {
  const checkbox = binding("bay").replace("<w:text/>", '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="1"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>');
  const { bytes } = await bind(await fixture(checkbox, '<v:value xsi:type="xs:boolean">true</v:value>'), false);
  expect((await inspectDocumentControls(bytes, {}, textContext)).items[0]!.value).toBe(false);
});
it("validates without publishing in dry run", async () => {
  const { result, bytes } = await bind(await fixture(), "New", { dryRun: true });
  expect(bytes.length).toBe(0); expect(result).toMatchObject({ changed: true, dryRun: true, output: null });
});
it("reuses an empty scalar leaf for a subsequent binding", async () => {
  const first = await bind(await fixture(), ""); const second = await bind(first.bytes, "Again");
  expect((await inspectDocumentControls(second.bytes, {}, textContext)).items.map(item => item.value)).toEqual(["Again", "Again"]);
});
it("fills an original self-closing custom XML scalar leaf", async () => {
  const { bytes } = await bind(await fixture(undefined, "<v:value/>"), "New");
  expect((await inspectDocumentControls(bytes, {}, textContext)).items.map(item => item.value)).toEqual(["New", "New"]);
});
it("fills a scalar CDATA leaf using ordinary string identity", async () => {
  const { bytes } = await bind(await fixture(undefined, "<v:value><![CDATA[Old]]></v:value>"), "]]>");
  const archive = await readArchive(bytes, textContext); const xml = archive.members.find(member => member.name === "customXml/item.xml")!.bytes;
  const { parseDocumentXml } = await import("./package-xml.js"); expect(parseDocumentXml(xml).root.children[0]!.text).toBe("]]>");
});
it("fills a scalar root CDATA store without changing its root declarations", async () => {
  const input = await fixture(binding("bay", "", "/v:root")); const archive = await readArchive(input, textContext);
  const members = archive.members.map(member => member.name === "customXml/item.xml" ? { ...member, bytes: new TextEncoder().encode('<v:root xmlns:v="urn:harbor:records"><![CDATA[Old]]></v:root>') } : member);
  const fs = Volume.fromJSON({ "/archive": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  const { bytes } = await bind(new Uint8Array(fs.readFileSync("/archive") as Buffer), "]]>");
  const { parseDocumentXml } = await import("./package-xml.js"); const result = await readArchive(bytes, textContext);
  expect(parseDocumentXml(result.members.find(member => member.name === "customXml/item.xml")!.bytes).root.text).toBe("]]>");
});
it("keeps numeric zero under an explicit integer declaration", async () => {
  const { bytes } = await bind(await fixture(undefined, '<v:value xsi:type="xs:integer">8</v:value>'), 0);
  expect((await inspectDocumentControls(bytes, {}, textContext)).items.map(item => item.value)).toEqual(["0", "0"]);
});
it("rejects incomplete recipient selection atomically", async () => {
  await expect(bind(await fixture(), "New", { all: undefined, control: 1 })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects conflicting declarations sharing the binding key outside a narrow selection", async () => {
  await expect(bind(await fixture(binding("bay") + binding("bay", "", "/v:root/v:other"), "<v:value>Old</v:value><v:other>Other</v:other>"), "New", { all: undefined, control: 1 })).rejects.toMatchObject({ code: "ambiguous-selection" });
});
it("binds an unprefixed empty-namespace child path without mappings", async () => {
  const plain = binding("bay", "", "/v:root/value").replace("/v:root/value", "/root/value").replace(" w:prefixMappings=\"xmlns:v='urn:harbor:records'\"", "");
  const input = await fixture(plain, "<value>Old</value>");
  const archive = await readArchive(input, textContext);
  const members = archive.members.map(member => member.name === "customXml/item.xml" ? { ...member, bytes: new TextEncoder().encode("<root><value>Old</value></root>") } : member);
  const fs = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  const { bytes } = await bind(new Uint8Array(fs.readFileSync("/archive") as Buffer), "New");
  expect((await inspectDocumentControls(bytes, {}, textContext)).items[0]!.value).toBe("New");
});
it("preserves an unrelated unsupported binding beside a supported target", async () => {
  const unrelated = binding("unrelated", "", "/v:root/v:value[1]").replace(store, "{99999999-2222-3333-4444-555555555555}");
  const { bytes } = await bind(await fixture(binding("bay") + unrelated), "New", { all: undefined, control: 1 });
  expect((await inspectDocumentControls(bytes, {}, textContext)).items.map(item => item.value)).toEqual(["New", "Old"]);
});
it("preserves unrelated external custom XML properties beside an internal binding store", async () => {
  const archive = await readArchive(await fixture(binding("bay")), textContext), modified = new Date("2025-01-02T03:04:06Z");
  const members = [...archive.members, { name: "customXml/unrelated.xml", bytes: new TextEncoder().encode("<unrelated/>"), directory: false, modified }, { name: "customXml/_rels/unrelated.xml.rels", bytes: new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="${r}/customXmlProps" Target="https://harbor.invalid/properties" TargetMode="External"/></Relationships>`), directory: false, modified }];
  const fs = Volume.fromJSON({ "/archive": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  const { bytes } = await bind(new Uint8Array(fs.readFileSync("/archive") as Buffer), "New");
  expect((await readArchive(bytes, textContext)).members.find(member => member.name === "customXml/_rels/unrelated.xml.rels")!.bytes).toEqual(members.at(-1)!.bytes);
});
it.each(["external", "missing", "duplicate"])("rejects %s properties ownership for the selected store", async mode => {
  const archive = await readArchive(await fixture(binding("bay")), textContext);
  const edge = `<Relationship Id="properties" Type="${r}/customXmlProps" Target="${mode === "external" ? "https://harbor.invalid/selected" : "props.xml"}"${mode === "external" ? ' TargetMode="External"' : ""}/>`;
  const xml = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${mode === "missing" ? "" : edge}${mode === "duplicate" ? edge.replace('Id="properties"', 'Id="second"') : ""}</Relationships>`;
  const members = archive.members.map(member => member.name === "customXml/_rels/item.xml.rels" ? { ...member, bytes: new TextEncoder().encode(xml) } : member);
  const fs = Volume.fromJSON({ "/archive": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  await expect(bind(new Uint8Array(fs.readFileSync("/archive") as Buffer), "New", { dryRun: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects an unresolved same-store selector that may alias the singleton target", async () => {
  await expect(bind(await fixture(binding("bay") + binding("alias", "", "/v:root/v:value[1]")), "New", { all: undefined, control: 1, dryRun: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects unsupported same-target aliases using different namespace prefixes", async () => {
  const alias = binding("alias").replace("<w:text/>", "<w:picture/>").replaceAll("v:", "q:").replace("xmlns:v=", "xmlns:q=");
  await expect(bind(await fixture(binding("bay") + alias), "New", { dryRun: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it.each(["/v:root//v:value", "/v:root/v:value[1]", "/v:root/@value"])("rejects unsupported selector %s", async xpath => {
  await expect(bind(await fixture(binding("bay", "", xpath)), "New")).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects a locked alias before either store or recipient publication", async () => {
  await expect(bind(await fixture(binding("bay") + binding("alias", '<w:lock w:val="contentLocked"/>')), "New")).rejects.toMatchObject({ code: "unsupported-edit" });
});
it.each(["ins", "del", "moveFrom", "moveTo"])("rejects a bound control beneath a stored %s revision", async kind => {
  await expect(bind(await fixture(`<w:${kind} w:id="9">${binding("bay")}</w:${kind}>`), "New", { dryRun: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects nonsingleton scalar leaves and numeric type mismatch", async () => {
  await expect(bind(await fixture(undefined, "<v:value>A</v:value><v:value>B</v:value>"), "New")).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(bind(await fixture(undefined, '<v:value xsi:type="xs:integer">8</v:value>'), 0.5)).rejects.toMatchObject({ code: "unsupported-edit" });
});

async function glossaryFixture(descriptor = binding("hidden")) {
  const original = await readArchive(await fixture(binding("bay")), textContext), enc = new TextEncoder();
  const members = original.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: enc.encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Override PartName="/resources/blocks.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/></Types>')) } : member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: enc.encode(new TextDecoder().decode(member.bytes).replace('</Relationships>', `<Relationship Id="blocks" Type="${r}/glossaryDocument" Target="../resources/blocks.xml"/></Relationships>`)) } : member);
  members.push({ name: "resources/blocks.xml", bytes: enc.encode(`<w:glossaryDocument xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docParts><w:docPart><w:docPartBody><w:p>${descriptor}</w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`), directory: false, modified: new Date("2025-01-01") });
  const fs = Volume.fromJSON({ "/input": "" }); await writeArchive({ ...original, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(fs.readFileSync("/input") as Buffer);
}
it.each([binding("hidden"), binding("hidden", "", "//v:value")])("refuses same-target or unresolvable same-store unsupported glossary declarations", async descriptor => {
  const { editDocumentControlBindings } = await import("./control-bindings.js"); const fs = Volume.fromJSON({ "/output": "" });
  await expect(editDocumentControlBindings(await glossaryFixture(descriptor), { all: true, scope: "all-stories", binding: "bay", valueJson: "New", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" }); expect(fs.readFileSync("/output").length).toBe(0);
});
it("retains a different-store unsupported glossary declaration byte-identically during binding", async () => {
  const input = await glossaryFixture(binding("hidden").replace(store, "{22222222-2222-3333-4444-555555555555}")), before = await readArchive(input, textContext);
  const { bytes } = await bind(input, "New", { scope: "all-stories" }), after = await readArchive(bytes, textContext);
  expect(after.members.find(member => member.name === "resources/blocks.xml")!.bytes).toEqual(before.members.find(member => member.name === "resources/blocks.xml")!.bytes);
  for (const member of before.members.filter(member => member.name !== "customXml/item.xml" && member.name !== "word/document.xml")) expect(after.members.find(candidate => candidate.name === member.name)!.bytes).toEqual(member.bytes);
});
