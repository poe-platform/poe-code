import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { readArchive, writeArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textFixture, run, textContext, w, r } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const ds = "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
const store = "{11111111-2222-3333-4444-555555555555}";
const xml = {
  "records/island.xml": '<v:data xmlns:v="urn:harbor:forms"><v:value>Stored</v:value></v:data>',
  "records/identity.xml": `<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${store}"><ds:schemaRefs><ds:schemaRef ds:uri="urn:harbor:schema"/></ds:schemaRefs></ds:datastoreItem>`,
  "records/_rels/island.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="identity" Type="${r}/customXmlProps" Target="identity.xml"/><Relationship Id="notes" Type="urn:harbor:notes" Target="notes.bin"/><Relationship Id="external" Type="urn:harbor:external" Target="https://harbor.invalid/inert" TargetMode="External"/></Relationships>`,
  "word/glossary/page.xml": `<w:glossaryDocument xmlns:w="${w}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Harbor card"/><w:guid w:val="{12345678-2222-3333-4444-555555555555}"/><w:category><w:name w:val="Cards"/><w:gallery w:val="quickParts"/></w:category><w:types><w:type w:val="normal"/></w:types><w:behaviors><w:behavior w:val="content"/></w:behaviors></w:docPartPr><w:docPartBody><w:p>${run("Block content retained")}</w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`,
  "word/glossary/_rels/page.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Type="urn:harbor:notes" Target="../../records/notes.bin"/></Relationships>'
};
async function input(bound = false, glossaryBound = bound) {
  const binding = (tag: string, content: string) => `<w:sdt><w:sdtPr><w:text/><w:tag w:val="${tag}"/><w:dataBinding w:storeItemID="${store}" w:xpath="/v:data/v:value" w:prefixMappings="xmlns:v='urn:harbor:forms'"/></w:sdtPr><w:sdtContent>${run(content)}</w:sdtContent></w:sdt>`;
  const archive = await readArchive(await textFixture(`<w:p>${bound ? binding("bay", "Stored") : run("Old")}</w:p>`), textContext);
  const members = archive.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("</Types>", '<Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/records/identity.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override PartName="/word/glossary/page.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/></Types>')) } : member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Type="${r}/customXml" Target="../records/island.xml"/><Relationship Id="blocks" Type="${r}/glossaryDocument" Target="glossary/page.xml"/></Relationships>`) } : member);
  for (const [name, data] of Object.entries(xml)) members.push({ name, bytes: new TextEncoder().encode(glossaryBound && name === "word/glossary/page.xml" ? data.replace(run("Block content retained"), binding("alias", "Stored")) : data), directory: false, modified: new Date("2025-01-02T03:04:06Z") });
  members.push({ name: "records/notes.bin", bytes: new Uint8Array([7, 13, 21]), directory: false, modified: new Date("2025-01-02T03:04:06Z") });
  const fs = Volume.fromJSON({ "/archive": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(fs.readFileSync("/archive") as Buffer);
}
async function setup(bytes: Uint8Array, script = "") {
  const volume = Volume.fromJSON({ "/work/form with spaces.docx": Buffer.from(bytes), "/work/read.sh": script });
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = fs.lstat = async (path, options) => { options?.signal?.throwIfAborted(); const value = volume.lstatSync(path); return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino, dev: value.dev, nlink: value.nlink }; };
  fs.realpath = async path => String(volume.realpathSync(path));
  fs.readFile = async (path, options) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  return { volume, shell: new Shell({ fs, cwd: "/work" }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })) };
}
test("docx inventories relationally declared custom XML metadata through a quoted VFS script", async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes, "docx custom-xml list 'form with spaces.docx' --json\n");
  try {
    const result = await shell.exec("sh read.sh"); assert.equal(result.exitCode, 0, result.stderr); const report = JSON.parse(result.stdout);
    assert.equal(report.affected, 0); assert.equal(report.data.items.length, 1); const item = report.data.items[0];
    assert.equal(item.kind, "custom-xml"); assert.equal(item.name, "/records/island.xml"); assert.equal(item.support, "preserve"); assert.equal(item.location.kind, "part"); assert.equal(item.text, undefined);
    assert.deepEqual(item.details.root, { namespace: "urn:harbor:forms", localName: "data" }); assert.equal(item.details.storeItemId, store); assert.deepEqual(item.details.propertiesParts, ["/records/identity.xml"]); assert.deepEqual(item.details.schemaReferences, ["urn:harbor:schema"]);
    assert.deepEqual(item.details.parts.map((part: { name: string }) => part.name), ["/records/identity.xml", "/records/island.xml", "/records/notes.bin"]);
    assert.ok(item.references.some((reference: { id: string; external: boolean }) => reference.id === "external" && reference.external));
    assert.deepEqual(volume.readFileSync("/work/form with spaces.docx"), Buffer.from(bytes));
  } finally { await shell.dispose(); }
});
test("docx inventories native building-block metadata and internal ancillary parts", async () => {
  const { shell } = await setup(await input());
  try {
    const result = await shell.exec("docx glossary list 'form with spaces.docx' --json"); assert.equal(result.exitCode, 0, result.stderr); const report = JSON.parse(result.stdout), item = report.data.items[0];
    assert.equal(item.name, "/word/glossary/page.xml"); assert.equal(item.text, undefined); assert.equal(item.support, "preserve");
    assert.deepEqual(item.details.buildingBlocks, [{ path: [0, 0], name: "Harbor card", guid: "{12345678-2222-3333-4444-555555555555}", category: "Cards", gallery: "quickParts", types: ["normal"], behaviors: ["content"] }]);
    assert.deepEqual(item.details.parts.map((part: { name: string }) => part.name), ["/records/notes.bin", "/word/glossary/page.xml"]);
  } finally { await shell.dispose(); }
});
test("docx package inventories remain noncreating when declared resources are absent", async () => {
  const bytes = await textFixture(`<w:p>${run("Only body")}</w:p>`), { shell, volume } = await setup(bytes);
  try { for (const kind of ["custom-xml", "glossary"]) { const result = await shell.exec(`docx ${kind} list 'form with spaces.docx' --json`); assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).data.items, []); } assert.deepEqual(volume.readFileSync("/work/form with spaces.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
for (const [part, source] of Object.entries(xml)) test(`docx body mutation preserves original ${part} payload bytes`, async () => {
  const { shell } = await setup(await input());
  try {
    const result = await shell.exec(`docx text replace 'form with spaces.docx' --find Old --with New --first --output - | docx xml get - --part /${part} --raw`);
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, source);
  } finally { await shell.dispose(); }
});
test("docx package inventories inspect binary stdout after an original body mutation", async () => {
  const { shell } = await setup(await input());
  try {
    const report = await shell.exec("docx text replace 'form with spaces.docx' --find Old --with New --first --output - | docx custom-xml list - --json"); assert.equal(report.exitCode, 0, report.stderr); assert.equal(JSON.parse(report.stdout).data.items[0].details.storeItemId, store);
  } finally { await shell.dispose(); }
});
test("docx package inventories reject story selectors with canonical zero-effect usage results", async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes);
  try { for (const kind of ["custom-xml", "glossary"]) { const result = await shell.exec(`docx ${kind} list 'form with spaces.docx' --paragraph 1 --json`); assert.equal(result.exitCode, 2); const report = JSON.parse(result.stdout); assert.equal(report.affected, 0); assert.equal(report.data, null); assert.equal(report.errors[0].code, "usage"); } assert.deepEqual(volume.readFileSync("/work/form with spaces.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
test("docx binding refuses an unsupported same-store glossary recipient instead of changing its store", async () => {
  const supported = await setup(await input(true, false));
  try {
    const result = await supported.shell.exec(`docx controls bind 'form with spaces.docx' --all --scope all-stories --binding bay --value-json '"New"' --output - | docx xml get - --part /records/island.xml --raw`);
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, xml["records/island.xml"].replace("Stored", "New"));
  } finally { await supported.shell.dispose(); }
  const bytes = await input(true), { shell, volume } = await setup(bytes);
  try {
    const result = await shell.exec(`docx controls bind 'form with spaces.docx' --all --scope all-stories --binding bay --value-json '"New"' --dry-run --json`);
    assert.notEqual(result.exitCode, 0); const report = JSON.parse(result.stdout); assert.equal(report.data, null); assert.equal(report.affected, 0); assert.equal(report.errors[0].code, "unsupported-edit");
    assert.deepEqual(volume.readFileSync("/work/form with spaces.docx"), Buffer.from(bytes));
  } finally { await shell.dispose(); }
});
