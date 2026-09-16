import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { paragraph, table, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { rasterPng, rasterJpeg, rasterGif } from "../../../../docx/tests/fixtures/raster.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError } from "../../../src/contracts/errors.js";
import { agentCommands } from "../../../src/plugins/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/filesystem.js";
import { dirname } from "../../../src/contracts/path.js";
import { Shell } from "../../../src/shell/index.js";

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
test("docx inserts original alpha PNG through quoted VFS script and binary pipeline", async () => {
  const bytes = await textFixture(paragraph("Garden")), image = rasterPng(), { shell, volume } = await setup(bytes, "docx images add 'survey notes.docx' --paragraph 1 --file 'leaf image.png' --alt Leaf --output - | docx images get - --image 1 --json > inventory.json\ncat inventory.json\n");
  volume.writeFileSync("/work/leaf image.png", image);
  try {
    const result = await shell.exec("sh survey.sh"); assert.equal(result.exitCode, 0, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.ok, true, JSON.stringify(report.errors));
    const item = report.data.item; assert.equal(item.details.mime, "image/png"); assert.equal(item.details.widthEmu, 12700); assert.equal(item.details.heightEmu, 12700); assert.equal(item.details.alt, "Leaf");
    assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes)); assert.deepEqual(volume.readFileSync("/work/leaf image.png"), Buffer.from(image));
  } finally { await shell.dispose(); }
});
for (const [name, width, height] of [["portrait", 2, 3], ["landscape", 3, 2]] as const) test(`docx inserts ${name} JPEG with native per-axis density`, async () => {
  const image = rasterJpeg(width, height, [1, 144, 72]), { shell, volume } = await setup(await textFixture(paragraph("Photo"))); volume.writeFileSync("/work/photo.jpg", image);
  try {
    const result = await shell.exec("docx images add 'survey notes.docx' --file photo.jpg --paragraph 1 --output - | docx images get - --image 1 --json");
    assert.equal(result.exitCode, 0, result.stderr); const item = JSON.parse(result.stdout).data.item; assert.equal(item.details.mime, "image/jpeg"); assert.equal(item.details.widthEmu, width * 6350); assert.equal(item.details.heightEmu, height * 12700);
  } finally { await shell.dispose(); }
});
test("docx named image insertion extracts byte-identical source and reports publication", async () => {
  const image = rasterPng(), { shell, volume } = await setup(await textFixture(paragraph("Source"))); volume.writeFileSync("/work/leaf.png", image);
  try {
    const insertion = await shell.exec("docx images add 'survey notes.docx' --file leaf.png --output inserted.docx --json"); assert.equal(insertion.exitCode, 0, insertion.stderr); const report = JSON.parse(insertion.stdout); assert.equal(report.affected, 1); assert.equal(report.data.output.path, "/work/inserted.docx");
    const extraction = await shell.exec("docx images extract inserted.docx --output-dir out --allow-partial-output --json"); assert.equal(extraction.exitCode, 0, extraction.stderr);
    assert.deepEqual(volume.readFileSync("/work/out/image-1.png"), Buffer.from(image));
  } finally { await shell.dispose(); }
});
test("docx cell insertion keeps existing text and admits decorative intent", async () => {
  const { shell, volume } = await setup(await textFixture(table([paragraph("Cell")]))); volume.writeFileSync("/work/leaf.png", rasterPng());
  try {
    const result = await shell.exec("docx images add 'survey notes.docx' --table 1 --cell A1 --file leaf.png --decorative true --width 1in --height 2in --fit stretch --output - | docx images get - --table 1 --cell A1 --image 1 --json");
    assert.equal(result.exitCode, 0, result.stderr); const item = JSON.parse(result.stdout).data.item; assert.equal(item.details.decorative, true); assert.equal(item.details.widthEmu, 914400); assert.equal(item.details.heightEmu, 1828800);
  } finally { await shell.dispose(); }
});
for (const [name, image] of [["wrong.jpg", rasterPng()], ["unsupported.gif", rasterGif()]] as const) test(`docx refuses ${name} image insertion before publication`, async () => {
  const bytes = await textFixture(paragraph("Keep")), { shell, volume } = await setup(bytes); volume.writeFileSync(`/work/${name}`, image);
  try { const result = await shell.exec(`docx images add 'survey notes.docx' --file ${name} --output refused.docx --json`); assert.notEqual(result.exitCode, 0); const report = JSON.parse(result.stdout); assert.equal(report.ok, false); assert.equal(report.affected, 0); assert.equal(volume.existsSync("/work/refused.docx"), false); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
test("docx decorative text conflicts and all insertion fail before any output", async () => {
  const { shell, volume } = await setup(await textFixture(paragraph("Keep"))); volume.writeFileSync("/work/leaf.png", rasterPng());
  try { for (const flags of ["--decorative true --alt Leaf", "--all"]) { const result = await shell.exec(`docx images add 'survey notes.docx' --file leaf.png ${flags} --output refused.docx --json`); assert.notEqual(result.exitCode, 0); assert.equal(volume.existsSync("/work/refused.docx"), false); } } finally { await shell.dispose(); }
});
test("docx dry-run insertion reports the sole add change without publication", async () => {
  const bytes = await textFixture(paragraph("Keep")), { shell, volume } = await setup(bytes); volume.writeFileSync("/work/leaf.png", rasterPng());
  try { const result = await shell.exec("docx images add 'survey notes.docx' --file leaf.png --paragraph 1 --dry-run --json"); assert.equal(result.exitCode, 0, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.affected, 1); assert.equal(report.data.dryRun, true); assert.equal(report.data.changes[0].kind, "add"); assert.equal(report.data.output, null); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
test("docx explicitly empty header insertion succeeds with zero affected owners and no publication", async () => {
  const bytes = await textFixture(paragraph("Keep") + "<w:sectPr/>"), { shell, volume } = await setup(bytes);
  volume.writeFileSync("/work/leaf.png", rasterPng());
  try { const result = await shell.exec("docx images add 'survey notes.docx' --scope headers --section 1 --file leaf.png --allow-empty --dry-run --json"); assert.equal(result.exitCode, 0, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.ok, true); assert.equal(report.affected, 0); assert.equal(report.data.changed, false); assert.deepEqual(report.data.changes, []); assert.deepEqual(report.locations, []); assert.equal(report.data.output, null); assert.deepEqual(volume.readFileSync("/work/survey notes.docx"), Buffer.from(bytes)); } finally { await shell.dispose(); }
});
