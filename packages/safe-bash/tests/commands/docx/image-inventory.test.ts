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

const media = Uint8Array.of(0, 255, 1, 128, 42);
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const carrier = (id: number, rel = "shared") => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${id * 1000}" cy="2000"/><wp:docPr id="${id}" name="Stored name" descr="Island"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:blipFill><a:blip r:embed="${rel}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
async function input(empty = false, linked = false) {
  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="dat" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}"><w:body>${empty ? "<w:p/>" : linked ? carrier(1, "remote").replace('r:embed="remote"', 'r:link="remote"') : carrier(1) + carrier(2)}</w:body></w:document>`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="shared" Type="${r}/image" Target="media/raw.dat"/>${linked ? `<Relationship Id="remote" Type="${r}/image" Target="https://images.invalid/private.png" TargetMode="External"/>` : ""}</Relationships>`,
    "word/media/raw.dat": media
  };
  const volume = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: Object.entries(files).map(([name, value]) => ({ name, bytes: typeof value === "string" ? new TextEncoder().encode(value) : value, directory: false, modified: new Date("2024-01-01T00:00:00Z") })) }, { async write(bytes) { volume.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/archive") as Buffer);
}
async function setup(bytes: Uint8Array, script = "") {
  const volume = Volume.fromJSON({ "/work/survey notes.docx": Buffer.from(bytes), "/work/survey.sh": script });
  volume.mkdirSync("/work/out");
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
  return { volume, fs, shell: new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })) };
}

test("docx images inventory executes a quoted VFS script and preserves opaque bytes", async () => {
  const bytes = await input(), { shell, volume } = await setup(bytes, "docx images list 'survey notes.docx' --json > inventory.json\ncat inventory.json\n");
  try {
    const result = await shell.exec("sh survey.sh"); assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout); assert.equal(report.ok, true, JSON.stringify(report.errors)); assert.equal(report.data.items.length, 2); assert.equal(report.affected, 0);
    const first = report.data.items[0]; assert.equal(first.kind, "images"); assert.equal(first.support, "preserve");
    assert.equal(first.details.mime, "application/octet-stream"); assert.equal(first.details.declaredMime, "image/png");
    assert.equal(first.details.bytes, media.length); assert.equal(first.details.widthEmu, 1000); assert.equal(first.details.pixelWidth, null);
    assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes));
  } finally { await shell.dispose(); }
});
test("docx images unique groups selected owners and retains first occurrence geometry", async () => {
  const { shell } = await setup(await input());
  try {
    const result = await shell.exec("docx images list 'survey notes.docx' --unique --json"); assert.equal(result.exitCode, 0, result.stderr);
    const items = JSON.parse(result.stdout).data.items; assert.equal(items.length, 1); assert.equal(items[0].details.owners.length, 2); assert.equal(items[0].details.widthEmu, 1000);
    const selected = await shell.exec("docx images list 'survey notes.docx' --paragraph 2 --unique --json"); assert.equal(selected.exitCode, 0, selected.stderr);
    const item = JSON.parse(selected.stdout).data.items[0]; assert.equal(item.details.owners.length, 1); assert.equal(item.details.widthEmu, 2000);
  } finally { await shell.dispose(); }
});
test("docx images get selects an occurrence without conflating its shared resource", async () => {
  const { shell } = await setup(await input());
  try { const result = await shell.exec("docx images get 'survey notes.docx' --image 2 --json"); assert.equal(result.exitCode, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.item.details.widthEmu, 2000); } finally { await shell.dispose(); }
});
test("docx images extraction emits exact original bytes and a closed relative manifest", async () => {
  const { shell, volume } = await setup(await input());
  try {
    const result = await shell.exec("docx images extract 'survey notes.docx' --output-dir out --allow-partial-output --json"); assert.equal(result.exitCode, 0, result.stderr);
    const data = JSON.parse(result.stdout).data; assert.equal(data.complete, true); assert.equal(data.inventory, null);
    assert.equal(data.entries.length, 2); assert.equal(data.manifest.path, "/work/out/manifest.json"); assert.equal(data.manifest.published, true);
    for (let i = 0; i < 2; i++) { assert.equal(data.entries[i].path, `/work/out/image-${i + 1}.bin`); assert.equal(data.entries[i].published, true); assert.deepEqual(volume.readFileSync(data.entries[i].path), Buffer.from(media)); }
    const manifest = JSON.parse(String(volume.readFileSync("/work/out/manifest.json")));
    assert.deepEqual(Object.keys(manifest), ["version", "kind", "entries"]); assert.equal(manifest.version, 1); assert.equal(manifest.kind, "images");
    assert.deepEqual(Object.keys(manifest.entries[0]), ["path", "part", "bytes", "sha256", "locations"]); assert.equal(manifest.entries[0].path, "image-1.bin");
  } finally { await shell.dispose(); }
});
test("docx images extraction refuses missing partial intent before publication", async () => {
  const { shell, volume } = await setup(await input());
  try { const result = await shell.exec("docx images extract 'survey notes.docx' --output-dir out --json"); assert.notEqual(result.exitCode, 0); assert.equal(JSON.parse(result.stdout).errors[0].code, "unsupported-publication"); assert.deepEqual(volume.readdirSync("/work/out"), []); } finally { await shell.dispose(); }
});
test("docx empty image selection publishes only its manifest atomically", async () => {
  const { shell, volume } = await setup(await input(true));
  try { const result = await shell.exec("docx images extract 'survey notes.docx' --output-dir out --json"); assert.equal(result.exitCode, 0, result.stderr); const data = JSON.parse(result.stdout).data; assert.equal(data.complete, true); assert.deepEqual(data.entries, []); assert.equal(data.manifest.published, true); assert.deepEqual(volume.readdirSync("/work/out"), ["manifest.json"]); } finally { await shell.dispose(); }
});
test("docx linked images remain individual inert records with no acquired byte identity", async () => {
  const { shell } = await setup(await input(false, true));
  try { const result = await shell.exec("docx images list 'survey notes.docx' --unique --json"); assert.equal(result.exitCode, 0, result.stderr); const item = JSON.parse(result.stdout).data.items[0]; assert.equal(item.name, undefined); assert.equal(item.details.linked, true); for (const key of ["part", "mime", "bytes", "sha256", "pixelWidth", "pixelHeight"]) assert.equal(item.details[key], null); assert.equal(item.references[0].external, true); } finally { await shell.dispose(); }
});
test("docx linked extraction reports incomplete metadata without fabricating payloads", async () => {
  const { shell, volume } = await setup(await input(false, true));
  try { const result = await shell.exec("docx images extract 'survey notes.docx' --output-dir out --json"); assert.equal(result.exitCode, 0, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.data.complete, false); assert.deepEqual(report.data.entries, []); assert.ok(report.warnings.length > 0); assert.deepEqual(volume.readdirSync("/work/out"), ["manifest.json"]); } finally { await shell.dispose(); }
});
test("docx image extraction preflights a later conflicting destination before any publication", async () => {
  const { shell, volume } = await setup(await input()); volume.writeFileSync("/work/out/image-2.bin", "Existing");
  try { const result = await shell.exec("docx images extract 'survey notes.docx' --output-dir out --allow-partial-output --json"); assert.notEqual(result.exitCode, 0); assert.equal(JSON.parse(result.stdout).errors[0].code, "conflict"); assert.deepEqual(volume.readdirSync("/work/out"), ["image-2.bin"]); assert.equal(String(volume.readFileSync("/work/out/image-2.bin")), "Existing"); } finally { await shell.dispose(); }
});
test("docx image extraction counts manifest publication for one selected occurrence", async () => {
  const { shell, volume } = await setup(await input());
  try { const result = await shell.exec("docx images extract 'survey notes.docx' --image 1 --output-dir out --json"); assert.notEqual(result.exitCode, 0); assert.equal(JSON.parse(result.stdout).errors[0].code, "unsupported-publication"); assert.deepEqual(volume.readdirSync("/work/out"), []); } finally { await shell.dispose(); }
});
test("docx image extraction failure reports only actual published payloads and no promised manifest", async () => {
  const { shell, volume, fs } = await setup(await input()); const publish = fs.publishStagedFile!;
  fs.publishStagedFile = async (stage, path, options) => { if (path === "/work/out/image-2.bin") throw new FsError("EIO", { path }); await publish(stage, path, options); };
  try {
    const result = await shell.exec("docx images extract 'survey notes.docx' --output-dir out --allow-partial-output --json"); assert.notEqual(result.exitCode, 0);
    const report = JSON.parse(result.stdout); assert.equal(report.errors[0].code, "sink-failure"); assert.equal(report.data.complete, false); assert.equal(report.data.inventory, null);
    assert.deepEqual(report.data.entries.map((entry: { published: boolean }) => entry.published), [true, false]); assert.equal(report.data.manifest.published, false);
    assert.equal(report.data.entries[0].locations.length, 1); assert.ok(report.locations.length > 0); assert.ok(report.warnings.length > 0);
    assert.deepEqual(volume.readdirSync("/work/out"), ["image-1.bin"]); assert.deepEqual(volume.readFileSync("/work/out/image-1.bin"), Buffer.from(media));
  } finally { await shell.dispose(); }
});
