import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textFixture, run, textContext } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

test("docx notes use VFS scripts, binary pipes and unchanged dry-run inputs", async () => {
  const bytes = await textFixture(`<w:p>${run("Coastal survey")}</w:p>`);
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes), "/work/notes.sh": 'docx notes add input.docx --kind footnote --paragraph 1 --text "Tidal observations" --output - | docx notes get - --note 1 --json\n' });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = fs.lstat = async path => {
    const value = volume.lstatSync(path);
    return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode,
      mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino,
      dev: value.dev, nlink: value.nlink };
  };
  fs.realpath = async path => String(volume.realpathSync(path));
  fs.readFile = async path => new Uint8Array(volume.readFileSync(path) as Uint8Array);
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  const shell = new Shell({ fs, cwd: "/work" }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("sh ./notes.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    const inspected = JSON.parse(result.stdout);
    assert.equal(inspected.operation, "notes.get");
    assert.equal(inspected.data.items[0].text, "Tidal observations");
    assert.equal(inspected.data.items[0].references.length, 1);
    assert.equal(inspected.locations.length, 1);
    const edited = await shell.exec('docx notes add input.docx --kind endnote --paragraph 1 --text "Initial sample" --output - | docx notes set - --kind endnote --note 1 --text "Verified sample" --output - | docx notes list - --json');
    assert.equal(edited.exitCode, 0, edited.stderr);
    assert.equal(JSON.parse(edited.stdout).data.items[0].text, "Verified sample");
    const removed = await shell.exec('docx notes add input.docx --kind footnote --paragraph 1 --text "Temporary note" --output - | docx notes remove - --note 1 --output - | docx notes list - --json');
    assert.equal(removed.exitCode, 0, removed.stderr);
    assert.deepEqual(JSON.parse(removed.stdout).data.items, []);
    assert.equal(JSON.parse(removed.stdout).data.separators.length, 2);
    const dryRun = await shell.exec('docx notes add input.docx --kind endnote --paragraph 1 --text "Offshore sample" --dry-run --json');
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).data.dryRun, true);
    assert.equal(JSON.parse(dryRun.stdout).affected, 1);
    assert.deepEqual(volume.readFileSync("/work/input.docx"), Buffer.from(bytes));
    const missing = await shell.exec("docx notes get input.docx --note 1 --json");
    assert.equal(missing.exitCode, 1);
    assert.equal(JSON.parse(missing.stdout).affected, 0);
  } finally { await shell.dispose(); }
});
