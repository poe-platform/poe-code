import { expect, it } from "vitest";
import { Volume } from "memfs";
import { readArchive } from "./archive.js";
import { writeArchive } from "./archive-write.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const dc = "http://purl.org/dc/elements/1.1/";
const cus = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
const vt = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
const fmtid = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
async function fixture(core = "", custom = "", extraEdge = "", extended = "") {
  const archive = await readArchive(await textFixture("<w:p/>"), textContext), encode = (s: string) => new TextEncoder().encode(s);
  const values: Record<string, string> = {};
  if (core) values["docProps/core.xml"] = `<cp:coreProperties xmlns:cp="${cp}" xmlns:dc="${dc}">${core}</cp:coreProperties>`;
  if (custom) values["docProps/custom.xml"] = `<Properties xmlns="${cus}" xmlns:vt="${vt}">${custom}</Properties>`;
  if (extended) values["docProps/app.xml"] = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${extended}</Properties>`;
  const edges = (extended ? '<Relationship Id="app" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' : "") + (core ? `<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` : "") + (custom ? '<Relationship Id="custom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>' : "") + extraEdge;
  const overrides = Object.keys(values).map(name => `<Override PartName="/${name}" ContentType="${name.includes("custom") ? "application/vnd.openxmlformats-officedocument.custom-properties+xml" : name.includes("app") ? "application/vnd.openxmlformats-officedocument.extended-properties+xml" : "application/vnd.openxmlformats-package.core-properties+xml"}"/>`).join("");
  const members = archive.members.map(m => m.name === "[Content_Types].xml" ? { ...m, bytes: encode(new TextDecoder().decode(m.bytes).replace("</Types>", overrides + "</Types>")) } : m.name === "_rels/.rels" ? { ...m, bytes: encode(new TextDecoder().decode(m.bytes).replace("</Relationships>", edges + "</Relationships>")) } : m);
  for (const [name, xml] of Object.entries(values)) members.push({ name, bytes: encode(xml), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  const fs = Volume.fromJSON({ "/input": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext); return new Uint8Array(fs.readFileSync("/input") as Buffer);
}
async function edit(bytes: Uint8Array, options: Record<string, unknown>) {
  const { editDocumentProperties } = await import("./document-properties.js"), fs = Volume.fromJSON({ "/output": "" });
  const data = await editDocumentProperties(bytes, { ...options, output: "-" } as Parameters<typeof editDocumentProperties>[1], { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(chunk) { fs.appendFileSync("/output", chunk); } } });
  return { data, bytes: new Uint8Array(fs.readFileSync("/output") as Buffer) };
}
it("reads exact core keys and keeps namespace lookalikes opaque", async () => {
  const { inspectDocumentProperties } = await import("./document-properties.js");
  const data = await inspectDocumentProperties(await fixture('<x:title xmlns:x="urn:original:opaque">Opaque</x:title><dc:title>Harbor</dc:title>'), { name: "title" }, textContext);
  expect(data.items).toHaveLength(1); expect(data.items[0]).toMatchObject({ name: "core:title", support: "edit", properties: [{ type: "string", value: "Harbor", writable: true }] });
});
it("surgically sets Unicode and removes only explicitly selected supported metadata", async () => {
  const kept = '<cp:keywords>Unchanged &amp; exact</cp:keywords>', input = await fixture('<dc:title>Old</dc:title>' + kept);
  const result = await edit(input, { operation: "properties.set", name: "title", value: "海🌊 & <ledger>" });
  expect(new TextDecoder().decode(readPackage(result.bytes).get("docProps/core.xml"))).toContain(kept);
  expect(readPackage(result.bytes).get("word/document.xml")).toEqual(readPackage(input).get("word/document.xml"));
  const removed = await edit(result.bytes, { operation: "properties.remove", name: "title" });
  expect(new TextDecoder().decode(readPackage(removed.bytes).get("docProps/core.xml"))).not.toContain("dc:title");
});
it("creates missing parts and retains exact package bytes for typed no-op edits", async () => {
  const input = await fixture(), changed = await edit(input, { operation: "properties.set", name: "title", value: "Harbor" });
  expect(changed.data.changed).toBe(true); const again = await edit(changed.bytes, { operation: "properties.set", name: "title", value: "Harbor" });
  expect(again.data.changed).toBe(false); expect(again.bytes).toEqual(changed.bytes);
});
it("keeps opaque custom values and width identities while allocating the smallest unused ID", async () => {
  const opaque = `<property fmtid="${fmtid}" pid="2" name="Opaque"><vt:vector size="1" baseType="lpwstr"><vt:lpwstr>Retained</vt:lpwstr></vt:vector></property>`;
  const input = await fixture("", opaque + `<property fmtid="${fmtid}" pid="4" name="Count"><vt:i1>12</vt:i1></property>`);
  const result = await edit(input, { operation: "properties.set", name: "custom:New", value: false, type: "boolean" }); const xml = new TextDecoder().decode(readPackage(result.bytes).get("docProps/custom.xml"));
  expect(xml).toContain(opaque); expect(xml).toContain('pid="3"');
  await expect(edit(input, { operation: "properties.set", name: "Count", value: 128 })).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(edit(input, { operation: "properties.remove", name: "Opaque" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects duplicate root declarations and custom identities before publication", async () => {
  const { inspectDocumentProperties } = await import("./document-properties.js");
  const input = await fixture('<dc:title>Harbor</dc:title>', "", '<Relationship Id="duplicate" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>');
  await expect(inspectDocumentProperties(input, { name: "title" }, textContext)).rejects.toMatchObject({ code: "ambiguous-selection" });
  const collision = await fixture("", `<property fmtid="${fmtid}" pid="2" name="A"><vt:i8>1</vt:i8></property><property fmtid="${fmtid}" pid="2" name="B"><vt:i8>2</vt:i8></property>`);
  await expect(edit(collision, { operation: "properties.set", name: "C", value: 3, type: "integer" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("keeps decimal exponent lexicals invalid and emits retained decimal values without exponents", async () => {
  const { inspectDocumentProperties } = await import("./document-properties.js");
  const invalid = await fixture("", `<property fmtid="${fmtid}" pid="2" name="Score"><vt:decimal>1e2</vt:decimal></property>`);
  expect((await inspectDocumentProperties(invalid, {}, textContext)).items[0]).toMatchObject({ support: "preserve", properties: [{ value: null }] });
});
it("serializes retained decimal width without exponent notation", async () => {
  const input = await fixture("", `<property fmtid="${fmtid}" pid="2" name="Score"><vt:decimal>1.25</vt:decimal></property>`);
  const changed = await edit(input, { operation: "properties.set", name: "Score", value: 0.0000001 });
  expect(new TextDecoder().decode(readPackage(changed.bytes).get("docProps/custom.xml"))).toContain("<vt:decimal>0.0000001</vt:decimal>");
});
it("lists opaque values without guessed type or shadowing exact native names", async () => {
  const { inspectDocumentProperties } = await import("./document-properties.js");
  const input = await fixture('<x:title xmlns:x="urn:original:opaque">Retained</x:title><dc:title>Ledger</dc:title>', `<property fmtid="${fmtid}" pid="2"><vt:vector/></property><property fmtid="${fmtid}" pid="3" name="Ambiguous"><vt:bool>true</vt:bool><vt:i8>1</vt:i8></property>`);
  const data = await inspectDocumentProperties(input, {}, textContext);
  expect(data.items[0]).toMatchObject({ properties: [], support: "preserve", details: { storedType: { namespace: "urn:original:opaque", localName: "title" } } }); expect(data.items[0]).not.toHaveProperty("name");
  expect(data.items.find(i => i.details.id === "2")).not.toHaveProperty("name"); expect(data.items.find(i => i.details.id === "3")).toMatchObject({ properties: [], details: { storedType: null } });
});
it("resolves cross-class names after admission and refuses cached set and removal", async () => {
  const { inspectDocumentProperties } = await import("./document-properties.js");
  const input = await fixture('<dc:title>Core</dc:title>', `<property fmtid="${fmtid}" pid="2" name="title"><vt:bool>true</vt:bool></property>`, "", "<Pages>7</Pages><Company>Retained</Company>");
  await expect(inspectDocumentProperties(input, { name: "title" }, textContext)).rejects.toMatchObject({ code: "ambiguous-selection" });
  for (const operation of ["properties.set", "properties.remove"]) await expect(edit(input, { operation, name: "pages", ...(operation === "properties.set" ? { value: 8 } : {}) })).rejects.toMatchObject({ code: "unsupported-edit" });
  const result = await edit(input, { operation: "properties.set", name: "custom:title", value: false });
  expect(new TextDecoder().decode(readPackage(result.bytes).get("docProps/app.xml"))).toContain("<Pages>7</Pages><Company>Retained</Company>");
});
it("retains lowercase format IDs and narrow integer variants exactly", async () => {
  const input = await fixture("", `<property fmtid="${fmtid.toLowerCase()}" pid="2" name="Count"><vt:ui1>12</vt:ui1></property>`), result = await edit(input, { operation: "properties.set", name: "Count", value: 255 });
  const xml = new TextDecoder().decode(readPackage(result.bytes).get("docProps/custom.xml")); expect(xml).toContain(fmtid.toLowerCase()); expect(xml).toContain("<vt:ui1>255</vt:ui1>");
  await expect(edit(input, { operation: "properties.set", name: "Count", value: -1 })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("creates typed metadata for an original strict template without implicit clocks", async () => {
  const { createDocumentArchive } = await import("./create.js"), archive = await createDocumentArchive({ kind: "dotx", dialect: "strict" }, textContext), fs = Volume.fromJSON({ "/input": "" });
  await writeArchive(archive, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const result = await edit(new Uint8Array(fs.readFileSync("/input") as Buffer), { operation: "properties.set", name: "company", value: "海🌊 & ledger" });
  const parts = readPackage(result.bytes), xml = [...parts].filter(([name]) => name.startsWith("docProps/")).map(([,bytes]) => new TextDecoder().decode(bytes)).join("");
  expect(xml).toContain("http://purl.oclc.org/ooxml/officeDocument/extendedProperties"); expect(xml).not.toContain("created"); expect(xml).not.toContain("modified");
});
it("normalizes dates to whole seconds and retains empty parts on explicit removal", async () => {
  const input = await fixture(), changed = await edit(input, { operation: "properties.set", name: "created", value: "1969-12-31T23:59:59.999Z" });
  const { inspectDocumentProperties } = await import("./document-properties.js"); expect((await inspectDocumentProperties(changed.bytes, { name: "created" }, textContext)).items[0]!.properties[0]!.value).toBe("1969-12-31T23:59:59Z");
  const removed = await edit(changed.bytes, { operation: "properties.remove", name: "created" }); expect([...readPackage(removed.bytes).keys()].some(name => name.startsWith("docProps/"))).toBe(true);
  expect((await inspectDocumentProperties(removed.bytes, {}, textContext)).items).toEqual([]);
  const missing = await edit(removed.bytes, { operation: "properties.remove", name: "title", allowEmpty: true }); expect(missing.data.changes).toEqual([]); expect(missing.bytes).toEqual(removed.bytes);
});
it("does not charge an un-emitted original package against dry-run JSON output", async () => {
  const input = await fixture('<dc:title>Harbor</dc:title>'), { editDocumentProperties } = await import("./document-properties.js");
  const data = await editDocumentProperties(input, { operation: "properties.set", name: "title", value: "Harbor", dryRun: true, json: true, limit: [{ name: "serializedOutput", value: 1024 }] }, { ...textContext, encoding: { order: "input", compression: "store" } });
  expect(data).toMatchObject({ changed: false, dryRun: true, output: null });
});
it.each(["1", "0", "-2", "2.5", "9007199254740992"])("refuses unsafe stored custom ID %s without repairs", async pid => {
  const input = await fixture("", `<property fmtid="${fmtid}" pid="${pid}" name="Stored"><vt:lpwstr>Retained</vt:lpwstr></property>`);
  await expect(edit(input, { operation: "properties.set", name: "New", value: "Original", type: "string" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("refuses invalid format IDs and duplicate stored names", async () => {
  const invalid = await fixture("", '<property fmtid="invalid" pid="2" name="Stored"><vt:lpwstr>Retained</vt:lpwstr></property>');
  await expect(edit(invalid, { operation: "properties.set", name: "Stored", value: "New" })).rejects.toMatchObject({ code: "unsupported-edit" });
  const duplicate = await fixture("", `<property fmtid="${fmtid}" pid="2" name="Stored"><vt:lpwstr>A</vt:lpwstr></property><property fmtid="${fmtid}" pid="3" name="Stored"><vt:lpwstr>B</vt:lpwstr></property>`);
  await expect(edit(duplicate, { operation: "properties.set", name: "New", value: "New", type: "string" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it.each([
  ["Text", "string", "海🌊 & <ledger>", "lpwstr"], ["Flag", "boolean", false, "bool"], ["Count", "integer", -9, "i8"], ["Score", "number", 2.125, "r8"], ["Instant", "date", "2024-02-29T12:34:56.123Z", "filetime"]
] as const)("creates and reads explicitly typed custom %s", async (name, type, value, variant) => {
  const result = await edit(await fixture(), { operation: "properties.set", name: `custom:${name}`, type, value }), { inspectDocumentProperties } = await import("./document-properties.js");
  const data = await inspectDocumentProperties(result.bytes, { name }, textContext); expect(data.items[0]).toMatchObject({ support: "edit", properties: [{ type, value: type === "date" ? "2024-02-29T12:34:56Z" : value }], details: { storedType: { localName: variant }, id: "2" } });
});
it("detects document metadata even when every stored property is opaque", async () => {
  const { inspectDocument } = await import("./inspection.js"), input = await fixture("", `<property fmtid="${fmtid}" pid="2" name="Opaque"><vt:vector/></property>`), data = await inspectDocument(input, textContext);
  expect(data.properties).toEqual([]); expect(data.features.find(feature => feature.id === "F30")).toMatchObject({ detected: true });
});
it("rejects named orphan reads when their metadata group is multiply declared", async () => {
  const { inspectDocumentProperties } = await import("./document-properties.js"), input = await fixture("", `<property fmtid="${fmtid}" pid="2" name="Stored"><vt:lpwstr>Retained</vt:lpwstr></property>`, '<Relationship Id="external1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="https://metadata.example.test/one" TargetMode="External"/><Relationship Id="external2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="https://metadata.example.test/two" TargetMode="External"/>');
  const archive = await readArchive(input, textContext), removed = '<Relationship Id="custom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>', fs = Volume.fromJSON({ "/input": "" });
  const members = archive.members.map(member => member.name !== "_rels/.rels" ? member : { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace(removed, "")) });
  await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  await expect(inspectDocumentProperties(new Uint8Array(fs.readFileSync("/input") as Buffer), { name: "Stored" }, textContext)).rejects.toMatchObject({ code: "ambiguous-selection" });
});
it("names unknown native vocabulary keys while keeping wrong-expanded known keys nameless", async () => {
  const { inspectDocumentProperties } = await import("./document-properties.js"), input = await fixture('<cp:title>Wrong expanded known key</cp:title><cp:Unlisted>Opaque native</cp:Unlisted><dc:title>Actual title</dc:title>', "", "", "<DocSecurity>Opaque cached source</DocSecurity>");
  const data = await inspectDocumentProperties(input, {}, textContext); expect(data.items.find(item => item.details.storedType?.localName === "Unlisted")).toMatchObject({ name: "core:Unlisted", properties: [], support: "preserve" });
  expect(data.items.find(item => item.details.group === "core" && item.details.storedType?.namespace === cp && item.details.storedType?.localName === "title")).not.toHaveProperty("name");
  expect((await inspectDocumentProperties(input, { name: "DocSecurity" }, textContext)).items[0]).toMatchObject({ name: "extended:DocSecurity", properties: [], support: "preserve" });
  for (const operation of ["properties.set", "properties.remove"]) await expect(edit(input, { operation, name: "core:Unlisted", ...(operation === "properties.set" ? { value: "New", type: "string" } : {}) })).rejects.toMatchObject({ code: "unsupported-edit" });
});
