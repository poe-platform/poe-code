import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { readDocumentArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textFixture, run, textContext } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

async function fixture(body = `<w:p>${run("Morning tide")}</w:p>`) {
  const bytes = await textFixture(body);
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes), "/work/existing.docx": "destination retained" });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = fs.lstat = async (path, options) => {
    options?.signal?.throwIfAborted();
    const value = volume.lstatSync(path);
    return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode,
      mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino,
      dev: value.dev, nlink: value.nlink };
  };
  fs.realpath = async path => String(volume.realpathSync(path));
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    return new Uint8Array(volume.readFileSync(path) as Uint8Array);
  };
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  const shell = new Shell({ fs, cwd: "/work" }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  return { shell, volume };
}

const tracked = "docx text replace input.docx --find Morning --with Evening --first --track-changes --author '' --timestamp 2026-04-03T02:01:00.123Z --output -";

test("docx revision decisions run through VFS scripts and binary stdin with exact final and original text", async () => {
  const { shell, volume } = await fixture();
  volume.writeFileSync("/work/decide.sh", `${tracked} | docx revisions accept - --all --output - | docx text -\n`);
  const before = volume.toJSON();
  try {
    const script = await shell.exec("sh ./decide.sh");
    assert.equal(script.exitCode, 0, script.stderr);
    assert.equal(script.stdout, "Evening tide");
    for (const [decision, expected] of [["accept", "Evening tide"], ["reject", "Morning tide"]]) {
      const binary = await shell.exec(`${tracked} | docx revisions ${decision} - --all --output -`);
      assert.equal(binary.exitCode, 0, binary.stderr);
      assert.equal(binary.stderr, "");
      assert.deepEqual([...binary.stdoutBytes.slice(0, 4)], [80, 75, 3, 4]);
      await readDocumentArchive(binary.stdoutBytes, textContext);
      volume.writeFileSync("/work/decided.docx", binary.stdoutBytes);
      for (const view of ["original", "final", "all"]) {
        const text = await shell.exec(`docx text decided.docx --view ${view}`);
        assert.equal(text.exitCode, 0, text.stderr);
        assert.equal(text.stdout, expected);
      }
      const list = await shell.exec("docx revisions list decided.docx --json");
      assert.equal(list.exitCode, 0, list.stderr);
      assert.deepEqual(JSON.parse(list.stdout).data.items, []);
      const repeated = await shell.exec(`docx revisions ${decision} decided.docx --all --dry-run --json`);
      assert.equal(repeated.exitCode, 1, repeated.stderr);
      assert.equal(JSON.parse(repeated.stdout).affected, 0);
      const empty = await shell.exec(`docx revisions ${decision} decided.docx --all --allow-empty --dry-run --json`);
      assert.equal(empty.exitCode, 0, empty.stderr);
      assert.equal(JSON.parse(empty.stdout).affected, 0);
    }
    volume.unlinkSync("/work/decided.docx");
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("docx revision dry-run reports effects without requiring new author or timestamp", async () => {
  const { shell, volume } = await fixture(`<w:p><w:ins w:id="4">${run("New tide")}</w:ins></w:p>`);
  const before = volume.toJSON();
  try {
    for (const decision of ["accept", "reject"]) {
      const dry = await shell.exec(`docx revisions ${decision} input.docx --revision 1 --dry-run --json`);
      assert.equal(dry.exitCode, 0, dry.stderr);
      const report = JSON.parse(dry.stdout);
      assert.equal(report.operation, `revisions.${decision}`);
      assert.equal(report.ok, true);
      assert.equal(report.affected, 1);
      assert.equal(report.data.dryRun, true);
      assert.deepEqual(volume.toJSON(), before);
      const metadata = await shell.exec(`docx revisions ${decision} input.docx --revision 1 --author Mira --dry-run --json`);
      assert.equal(metadata.exitCode, 2, metadata.stderr);
      assert.equal(JSON.parse(metadata.stdout).affected, 0);
    }
  } finally { await shell.dispose(); }
});

test("docx mixed supported and opaque revision decisions fail atomically while one selected revision succeeds", async () => {
  const { shell, volume } = await fixture(`<w:p><w:ins w:id="4">${run("New tide")}</w:ins><w:moveFrom w:id="8">${run("Old harbor")}</w:moveFrom></w:p>`);
  const before = volume.toJSON();
  try {
    for (const decision of ["accept", "reject"]) {
      const failed = await shell.exec(`docx revisions ${decision} input.docx --all --dry-run --json`);
      assert.equal(failed.exitCode, 1, failed.stderr);
      const report = JSON.parse(failed.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.affected, 0);
      assert.equal(report.data, null);
      assert.equal(report.errors[0].code, "unsupported-edit");
      assert.deepEqual(volume.toJSON(), before);
      const selected = await shell.exec(`docx revisions ${decision} input.docx --revision 1 --output - | docx revisions list - --json`);
      assert.equal(selected.exitCode, 0, selected.stderr);
      const remaining = JSON.parse(selected.stdout).data.items;
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].id, "8");
      assert.deepEqual(volume.toJSON(), before);
    }
  } finally { await shell.dispose(); }
});
