import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { paragraph, textContext, textFixture } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

async function fixture(body: string) {
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(await textFixture(body)), "/work/existing.docx": "retained destination" });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = fs.lstat = async (path, options) => {
    options?.signal?.throwIfAborted();
    const value = volume.lstatSync(path);
    return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode,
      mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs,
      ino: value.ino, dev: value.dev, nlink: value.nlink };
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

test("docx seeded visible text replacement repeats binary output through pipes and script files", async () => {
  const { shell, volume } = await fixture(paragraph("海岸 עברית é") + paragraph("Northern meadow") + "<w:p/>");
  try {
    volume.writeFileSync("/work/replace.sh", "docx lorem set input.docx --seed 1 --paragraph 1 --output - | docx text -\n");
    const before = volume.toJSON();
    for (const [selection, affected, expected] of [
      ["--paragraph 1", 1, "birch cedar delta\nNorthern meadow\n"],
      ["--all", 2, "birch cedar delta\nbirch cedar\n"]
    ] as const) {
      const command = `docx lorem set input.docx --seed 1 ${selection}`;
      const dry = await shell.exec(`${command} --dry-run --json`);
      assert.equal(dry.exitCode, 0, dry.stderr);
      const report = JSON.parse(dry.stdout);
      assert.equal(report.operation, "lorem.set");
      assert.equal(report.ok, true);
      assert.equal(report.affected, affected);
      assert.equal(report.data.dryRun, true);
      const first = await shell.exec(`${command} --output -`);
      const second = await shell.exec(`${command} --output -`);
      assert.equal(first.exitCode, 0, first.stderr);
      assert.equal(second.exitCode, 0, second.stderr);
      assert.equal(first.stderr, "");
      assert.deepEqual(first.stdoutBytes, second.stdoutBytes);
      const piped = await shell.exec(`${command} --output - | docx text -`);
      assert.equal(piped.exitCode, 0, piped.stderr);
      assert.equal(piped.stdout, expected);
      assert.deepEqual(volume.toJSON(), before);
    }
    const scripted = await shell.exec("sh ./replace.sh");
    assert.equal(scripted.exitCode, 0, scripted.stderr);
    assert.equal(scripted.stdout, "birch cedar delta\nNorthern meadow\n");
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("docx dummy text rejects missing intent and generation limits without changing virtual files", async () => {
  const { shell, volume } = await fixture(paragraph("Retained orchard"));
  try {
    const before = volume.toJSON();
    for (const [flags, status] of [
      ["--paragraph 1", 2],
      ["--seed 1", 2],
      ["--seed 1 --all --limit matches=0", 4]
    ] as const) {
      const result = await shell.exec(`docx lorem set input.docx ${flags} --output existing.docx --force --json`);
      assert.equal(result.exitCode, status, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.operation, "lorem.set");
      assert.equal(report.ok, false);
      assert.equal(report.affected, 0);
      assert.deepEqual(volume.toJSON(), before);
    }
  } finally { await shell.dispose(); }
});
