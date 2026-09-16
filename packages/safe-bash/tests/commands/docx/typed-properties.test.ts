import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { writeArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textContext, w, r } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError } from "../../../src/contracts/errors.js";
import { agentCommands } from "../../../src/plugins/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/filesystem.js";
import { dirname } from "../../../src/contracts/path.js";
import { Shell } from "../../../src/shell/index.js";

const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const dc = "http://purl.org/dc/elements/1.1/";
const vt = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
const cus = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
const fmtid = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
const coreXml = `<cp:coreProperties xmlns:cp="${cp}" xmlns:dc="${dc}" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Survey</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-02T03:04:05Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2024-02-03T04:05:06Z</dcterms:modified></cp:coreProperties>`;
const appXml = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Island office</Company><Pages>19</Pages><Words>73</Words></Properties>';
const customProperty = (name: string, id: string, value: string) => `<property name="${name}" pid="${id}" fmtid="${fmtid}">${value}</property>`;
async function input(kind: "docx" | "dotx" = "docx", duplicateId = false) {
  const customXml = `<Properties xmlns="${cus}" xmlns:vt="${vt}">${customProperty("Reviewed", "2", "<vt:bool>true</vt:bool>")}${customProperty("Count", "4", "<vt:i4>9</vt:i4>")}${customProperty("Note", duplicateId ? "4" : "5", "<vt:lpwstr>Stored note</vt:lpwstr>")}${customProperty("Opaque", "8", '<vt:vector size="1" baseType="lpwstr"><vt:lpwstr>Retained</vt:lpwstr></vt:vector>')}</Properties>`;
  const files = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + (kind === "docx" ? "document" : "template") + '.main+xml"/><Override PartName="/meta/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/meta/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/meta/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="word/document.xml"/><Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="meta/core.xml"/><Relationship Id="app" Type="${r}/extended-properties" Target="meta/app.xml"/><Relationship Id="custom" Type="${r}/custom-properties" Target="meta/custom.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Original body</w:t></w:r></w:p></w:body></w:document>`,
    "meta/core.xml": coreXml,
    "meta/app.xml": appXml,
    "meta/custom.xml": customXml
  };
  const volume = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: Object.entries(files).map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml), directory: false, modified: new Date("2024-01-01T00:00:00Z") })) }, { async write(bytes) { volume.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/archive") as Buffer);
}
async function setup(bytes: Uint8Array, script = "") {
  const volume = Volume.fromJSON({ "/work/survey notes.docx": Buffer.from(bytes), "/work/survey.sh": script });
  const fs: FileSystem = new MemoryFileSystem(); await fs.mkdir("/work");
  const identityScope = {};
  const snapshot = (path: string): FileStat => { const stat = volume.lstatSync(path); return { type: stat.isDirectory() ? "directory" : "file", size: stat.size, mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, atimeMs: stat.atimeMs, ino: stat.ino, dev: stat.dev, nlink: stat.nlink, revision: stat.mtimeMs, identityScope }; };
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = fs.lstat = async (path, options) => { options?.signal?.throwIfAborted(); if (!volume.existsSync(path)) throw new FsError("ENOENT", { path }); return snapshot(path); };
  fs.realpath = async path => String(volume.realpathSync(path));
  fs.readFile = async (path, options) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  fs.writeFile = async (path, bytes, options) => { options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes); };
  fs.writeStream = async (path, source, options) => { options?.signal?.throwIfAborted(); volume.writeFileSync(path, ""); for await (const bytes of source) { options?.signal?.throwIfAborted(); volume.appendFileSync(path, bytes); } };
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileStaging: true, open: true, randomAccessWrite: true });
  fs.open = async (path, options) => {
    options.signal?.throwIfAborted();
    if (options.creation === "exclusive" && volume.existsSync(path)) throw new FsError("EEXIST", { path });
    if (!volume.existsSync(path) && (options.creation ?? "never") === "never") throw new FsError("ENOENT", { path });
    const flag = options.creation === "exclusive" ? "wx+" : options.append ? "a+" : options.truncate || !volume.existsSync(path) ? "w+" : options.access === "read" ? "r" : "r+";
    const descriptor = volume.openSync(path, flag, options.mode); let closed = false;
    const check = (signal?: AbortSignal) => { signal?.throwIfAborted(); if (closed) throw new FsError("EBADF", { path }); };
    return {
      capabilities: { positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile" },
      async stat(forwarded) { check(forwarded?.signal); return snapshot(path); },
      async read(buffer, position, forwarded) { check(forwarded?.signal); if (options.access === "write") throw new FsError("EBADF", { path }); return volume.readSync(descriptor, buffer, 0, buffer.length, position); },
      async write(buffer, position, forwarded) { check(forwarded?.signal); if (options.access === "read") throw new FsError("EBADF", { path }); return volume.writeSync(descriptor, buffer, 0, buffer.length, position); },
      async truncate(length, forwarded) { check(forwarded?.signal); volume.ftruncateSync(descriptor, length); },
      async sync(ignoredDataOnly, forwarded) { check(forwarded?.signal); },
      async close() { if (!closed) { closed = true; volume.closeSync(descriptor); } }
    };
  };
  fs.compareEntry = async (path, peer, other, options) => { options?.signal?.throwIfAborted(); return peer === fs ? snapshot(path).ino === snapshot(other).ino ? "same" : "distinct" : "unknown"; };
  fs.createStagedFile = async (directory, name, content, options) => {
    options.signal?.throwIfAborted(); const parent = dirname(directory); assert.equal(snapshot(parent).ino, options.parent.ino);
    volume.mkdirSync(directory); assert.equal(content.type, "file"); if (content.type !== "file") throw new Error("Expected file staging"); volume.writeFileSync(`${directory}/${name}`, content.data);
    return { parent: { path: parent, stat: snapshot(parent) }, directory: { path: directory, stat: snapshot(directory) }, file: { path: `${directory}/${name}`, stat: snapshot(`${directory}/${name}`) } };
  };
  fs.publishStagedFile = async (stage, path, options) => {
    options.signal?.throwIfAborted(); const current = volume.existsSync(path) ? snapshot(path) : null, expected = options.destination;
    if ((current === null) !== (expected === null) || (["ino", "dev", "revision", "size", "mode", "mtimeMs", "ctimeMs"] as const).some(key => current?.[key] !== expected?.[key])) throw new FsError("EAGAIN", { path });
    volume.renameSync(stage.file.path, path);
  };
  fs.removeStagedFile = async stage => { volume.rmSync(stage.directory.path, { recursive: true }); };
  return { volume, shell: new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })) };
}
test("docx properties list runs a quoted VFS script with JSON redirection", async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes, "docx properties list 'survey notes.docx' --json > inventory.json\ncat inventory.json\n");
  try {
    const result = await shell.exec("sh survey.sh"); assert.equal(result.exitCode, 0, result.stderr); const report = JSON.parse(result.stdout);
    assert.equal(report.affected, 0); assert.equal(report.data.items.length, 10);
    const item = report.data.items.find((value: { name: string }) => value.name === "custom:Opaque");
    assert.deepEqual(item.properties, []); assert.equal(item.kind, "property"); assert.equal(item.support, "preserve"); assert.equal(item.text, undefined); assert.equal(item.location.kind, "part"); assert.deepEqual(item.details, { kind: "property", group: "custom", storedType: { namespace: vt, localName: "vector" }, id: "8" });
    assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes));
  } finally { await shell.dispose(); }
});
for (const kind of ["docx", "dotx"] as const) test(`docx properties get reports typed stored metadata from ${kind}`, async () => {
  const { shell } = await setup(await input(kind));
  try { const result = await shell.exec("docx properties get 'survey notes.docx' --name extended:pages --json"); assert.equal(result.exitCode, 0, result.stderr); const item = JSON.parse(result.stdout).data.item; assert.equal(item.name, "extended:pages"); assert.equal(item.support, "read"); assert.deepEqual(item.properties, [{ name: "pages", type: "integer", value: 19, writable: false, cached: true }]); } finally { await shell.dispose(); }
});
for (const [name, flags, value] of [
  ["custom:Reviewed", "--value false", false],
  ["custom:Count", "--value 0", 0],
  ["custom:Note", "--value ''", ""],
  ["core:title", "--value '港 & <data>'", "港 & <data>"],
  ["custom:Rate", "--type number --value -1.25", -1.25],
  ["custom:Instant", "--type date --value 1969-12-31T23:59:59.900Z", "1969-12-31T23:59:59Z"]
] as const) test(`docx property binary pipeline retains typed ${name} value`, async () => {
  const { shell } = await setup(await input());
  try { const result = await shell.exec(`docx properties set 'survey notes.docx' --name ${name} ${flags} --output - | docx properties get - --name ${name} --json`); assert.equal(result.exitCode, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.item.properties[0].value, value); } finally { await shell.dispose(); }
});
for (const [part, xml] of [["/meta/core.xml", coreXml], ["/meta/app.xml", appXml]] as const) test(`docx custom edit preserves exact unrelated ${part} payload`, async () => {
  const { shell } = await setup(await input());
  try { const result = await shell.exec(`docx properties set 'survey notes.docx' --name custom:Reviewed --value false --output - | docx xml get - --part ${part} --raw`); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, xml); } finally { await shell.dispose(); }
});
test("docx property creation allocates the smallest unused custom ID", async () => {
  const { shell } = await setup(await input());
  try { const result = await shell.exec("docx properties set 'survey notes.docx' --name custom:New --type string --value Added --output - | docx properties get - --name custom:New --json"); assert.equal(result.exitCode, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.item.details.id, "3"); } finally { await shell.dispose(); }
});
test("docx properties remove deletes only explicitly selected supported metadata", async () => {
  const { shell } = await setup(await input());
  try { const result = await shell.exec("docx properties remove 'survey notes.docx' --name custom:Reviewed --output - | docx properties list - --json"); assert.equal(result.exitCode, 0, result.stderr); const items = JSON.parse(result.stdout).data.items; assert.equal(items.some((item: { name: string }) => item.name === "custom:Reviewed"), false); assert.equal(items.find((item: { name: string }) => item.name === "custom:Count").properties[0].value, 9); assert.equal(items.find((item: { name: string }) => item.name === "extended:pages").properties[0].value, 19); } finally { await shell.dispose(); }
});
for (const [name, action, code] of [["custom:Opaque", "set --value X --type string", "unsupported-edit"], ["custom:Opaque", "remove", "unsupported-edit"], ["extended:pages", "remove", "unsupported-edit"], ["extended:pages", "set --value 20", "usage"]] as const) test(`docx properties refuses unsupported ${name} ${action}`, async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes);
  try { const words = action.split(" "), result = await shell.exec(`docx properties ${words[0]} 'survey notes.docx' --name ${name} ${words.slice(1).join(" ")} --output refused.docx --json`); assert.notEqual(result.exitCode, 0); const report = JSON.parse(result.stdout); assert.equal(report.affected, 0); assert.equal(report.data, null); assert.equal(report.errors[0].code, code); assert.equal(volume.existsSync("/work/refused.docx"), false); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
test("docx properties refuses custom ID collisions without renumbering data", async () => {
  const bytes = await input("docx", true), { shell, volume } = await setup(bytes);
  try { const result = await shell.exec("docx properties set 'survey notes.docx' --name custom:New --type string --value Added --output refused.docx --json"); assert.notEqual(result.exitCode, 0); const report = JSON.parse(result.stdout); assert.equal(report.affected, 0); assert.equal(report.errors[0].code, "unsupported-edit"); assert.equal(volume.existsSync("/work/refused.docx"), false); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
test("docx property named-file publication exposes the changed metadata through VFS", async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes);
  try {
    const result = await shell.exec("docx properties set 'survey notes.docx' --name core:title --value Published --output saved.docx --json"); assert.equal(result.exitCode, 0, result.stderr); assert.equal(JSON.parse(result.stdout).affected, 1); assert.equal(volume.existsSync("/work/saved.docx"), true);
    const read = await shell.exec("docx properties get saved.docx --name core:title --json"); assert.equal(read.exitCode, 0, read.stderr); assert.equal(JSON.parse(read.stdout).data.item.properties[0].value, "Published"); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes));
    assert.equal(volume.readdirSync("/work").some(name => String(name).startsWith(".docx-stage-")), false);
  } finally { await shell.dispose(); }
});
test("docx property publication rejects aliases and supports explicit in-place changes", async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes); volume.linkSync("/work/survey notes.docx", "/work/alias.docx");
  try {
    const alias = await shell.exec("docx properties set 'survey notes.docx' --name core:title --value Changed --output alias.docx --force --json"); assert.equal(alias.exitCode, 1, alias.stderr); assert.equal(JSON.parse(alias.stdout).errors[0].code, "conflict"); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes));
    const changed = await shell.exec("docx properties set 'survey notes.docx' --name core:title --value Changed --in-place --json"); assert.equal(changed.exitCode, 0, changed.stderr);
    const read = await shell.exec("docx properties get 'survey notes.docx' --name core:title --json"); assert.equal(read.exitCode, 0, read.stderr); assert.equal(JSON.parse(read.stdout).data.item.properties[0].value, "Changed");
    assert.equal(volume.readdirSync("/work").some(name => String(name).startsWith(".docx-stage-")), false);
  } finally { await shell.dispose(); }
});
test("docx properties rejects story selectors with zero-effect usage envelopes", async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes);
  try { const result = await shell.exec("docx properties get 'survey notes.docx' --name title --paragraph 1 --json"); assert.equal(result.exitCode, 2); assert.equal(JSON.parse(result.stdout).errors[0].code, "usage"); assert.equal(JSON.parse(result.stdout).affected, 0); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
