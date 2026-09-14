import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { writeArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textFixture, run, textContext, w, r } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const scalar = (tag: string, declaration = "<w:text/>") => `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/>${declaration}</w:sdtPr><w:sdtContent>${run("Old")}</w:sdtContent></w:sdt>`;
async function setup(input: Uint8Array, script: string) {
  const volume = Volume.fromJSON({ "/work/form.docx": Buffer.from(input), "/work/run.sh": script, "/work/data.json": '[{"values":[{"binding":"bay","value":"One"}]},{"values":[{"binding":"bay","value":"Two"}]}]', "/work/existing.docx": "retain" });
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = fs.lstat = async (path, options) => { options?.signal?.throwIfAborted(); const value = volume.lstatSync(path); return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino, dev: value.dev, nlink: value.nlink }; };
  fs.realpath = async path => String(volume.realpathSync(path));
  fs.readFile = async (path, options) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  return { volume, shell: new Shell({ fs, cwd: "/work" }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })) };
}
test("docx repeats native block controls through a VFS script and explicit JSON file", async () => {
  const region = '<w:sdt><w:sdtPr><v:repeatingSection xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><v:repeatingSectionItem xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"/></w:sdtPr><w:sdtContent><w:p>' + scalar("bay") + '</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>';
  const { shell } = await setup(await textFixture(region), "docx controls repeat form.docx --control 1 --data-file data.json --output - | docx text -\n");
  try { const result = await shell.exec("sh run.sh"); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "One\nTwo"); } finally { await shell.dispose(); }
});
test("docx repeats native table row controls from inline records and binary document stdin", async () => {
  const region = '<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:tr><w:tc><w:p>' + scalar("bay") + '</w:p></w:tc></w:tr></w:sdtContent></w:sdt></w:sdtContent></w:sdt>';
  const { shell } = await setup(await textFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region}</w:tbl>`), `docx controls repeat form.docx --control 1 --data-json '[]' --output - | docx controls repeat - --control 1 --data-json '[{"values":[{"binding":"bay","value":"Row"}]}]' --output - | docx text -\n`);
  try { const result = await shell.exec("sh run.sh"); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "Row"); } finally { await shell.dispose(); }
});
async function bound() {
  const store = "{11111111-2222-3333-4444-555555555555}";
  const declaration = `<w:text/><w:dataBinding w:storeItemID="${store}" w:xpath="/v:root/v:value" w:prefixMappings="xmlns:v='urn:harbor:records'"/>`;
  const xml = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="${w}"><w:body><w:p>${scalar("bay", declaration)}${scalar("alias", declaration)}</w:p></w:body></w:document>`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="store" Type="${r}/customXml" Target="../customXml/item.xml"/></Relationships>`,
    "customXml/item.xml": '<v:root xmlns:v="urn:harbor:records"><v:value>Old</v:value></v:root>',
    "customXml/_rels/item.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="properties" Type="${r}/customXmlProps" Target="props.xml"/></Relationships>`,
    "customXml/props.xml": `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="${store}"/>`
  };
  const volume = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: Object.entries(xml).map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text), directory: false, modified: new Date("2025-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/archive") as Buffer);
}
test("docx synchronizes declared binding aliases through real VFS scripts and binary stdin", async () => {
  const { shell } = await setup(await bound(), `docx controls bind form.docx --all --binding bay --value-json '"New"' --output - | docx controls list - --json\n`);
  try {
    const result = await shell.exec("sh run.sh"); assert.equal(result.exitCode, 0, result.stderr); const data = JSON.parse(result.stdout); assert.deepEqual(data.data.items.map((item: { value: string }) => item.value), ["New", "New"]);
    const store = await shell.exec(`docx controls bind form.docx --all --binding bay --value-json '"New"' --output - | docx xml get - --part /customXml/item.xml --raw`);
    assert.equal(store.exitCode, 0, store.stderr); assert.ok(store.stdout.includes("<v:value>New</v:value>"));
  } finally { await shell.dispose(); }
});
test("docx incomplete binding selection refuses atomically beside its implemented synchronization sibling", async () => {
  const input = await bound(); const { shell, volume } = await setup(input, "");
  try {
    const result = await shell.exec(`docx controls bind form.docx --control 1 --binding bay --value-json '"New"' --force --output existing.docx --json`);
    assert.notEqual(result.exitCode, 0); const report = JSON.parse(result.stdout); assert.equal(report.affected, 0); assert.equal(report.data, null); assert.equal(report.errors[0].code, "unsupported-edit");
    assert.deepEqual(volume.readFileSync("/work/form.docx"), Buffer.from(input)); assert.equal(volume.readFileSync("/work/existing.docx", "utf8"), "retain");
  } finally { await shell.dispose(); }
});
test("docx binding rejects a bounded serialized report before source or destination publication", async () => {
  const input = await bound(); const { shell, volume } = await setup(input, "");
  try {
    const result = await shell.exec(`docx controls bind form.docx --all --binding bay --value-json '"New"' --force --output existing.docx --limit serializedOutput=1 --json`);
    assert.notEqual(result.exitCode, 0); const report = JSON.parse(result.stdout); assert.equal(report.affected, 0); assert.equal(report.data, null); assert.equal(report.errors[0].code, "limit-exceeded");
    assert.deepEqual(volume.readFileSync("/work/form.docx"), Buffer.from(input)); assert.equal(volume.readFileSync("/work/existing.docx", "utf8"), "retain");
  } finally { await shell.dispose(); }
});
