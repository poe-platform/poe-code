import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textFixture, run, table, textContext } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

test("docx bookmark policies run through a VFS shell script with stdin and binary pipes", async () => {
  const bytes = await textFixture(table([`<w:p><w:bookmarkStart w:id="4" w:name="Survey"/>${run("North ")}${run("coast")}<w:bookmarkEnd w:id="4"/></w:p>`]));
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes), "/work/rename.sh": 'docx bookmarks set input.docx --bookmark 1 --name "FinalSurvey" --references update --output - | docx bookmarks list - --json\n' });
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
    const result = await shell.exec("sh ./rename.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.items[0].name, "FinalSurvey");
    assert.deepEqual(volume.readFileSync("/work/input.docx"), Buffer.from(bytes));
    const missingPolicy = await shell.exec("docx bookmarks remove input.docx --bookmark 1 --dry-run --json");
    assert.equal(missingPolicy.exitCode, 2);
    assert.equal(JSON.parse(missingPolicy.stdout).affected, 0);
  } finally { await shell.dispose(); }
});
