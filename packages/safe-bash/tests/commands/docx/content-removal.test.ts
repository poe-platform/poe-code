import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { encodeLocation, inspectDocument, parseDocumentXml, readDocumentArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { paragraph, run, table, textContext, textFixture } from "../../../../docx/tests/fixtures/text.js";
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

test("docx selected content removal preserves exact surviving text through binary VFS pipelines", async () => {
  const body = `<w:p>${run("First harbor")}${run(" discard")}${run(" remains")}</w:p>` + paragraph("Middle meadow") + table([paragraph("Cell orchard")]) + paragraph("Last ridge");
  const { shell, volume } = await fixture(body);
  try {
    volume.writeFileSync("/work/remove.sh", "docx tables remove input.docx --table 1 --output - | docx runs remove - --paragraph 1 --run 2 --output - | docx text -\n");
    const before = volume.toJSON();
    for (const [operation, selection, expected] of [
      ["paragraphs", "--paragraph 2", "First harbor discard remains\nCell orchard\nLast ridge"],
      ["runs", "--paragraph 1 --run 2", "First harbor remains\nMiddle meadow\nCell orchard\nLast ridge"],
      ["tables", "--table 1", "First harbor discard remains\nMiddle meadow\nLast ridge"]
    ]) {
      const command = `docx ${operation} remove input.docx ${selection}`;
      const dry = await shell.exec(`${command} --dry-run --json`);
      assert.equal(dry.exitCode, 0, dry.stderr);
      const report = JSON.parse(dry.stdout);
      assert.equal(report.operation, `${operation}.remove`);
      assert.equal(report.affected, 1);
      assert.equal(report.data.dryRun, true);
      assert.deepEqual(volume.toJSON(), before);
      const binary = await shell.exec(`${command} --output -`);
      assert.equal(binary.exitCode, 0, binary.stderr);
      assert.equal(binary.stderr, "");
      const archive = await readDocumentArchive(binary.stdoutBytes, textContext);
      parseDocumentXml(archive.members.find(member => member.name === "word/document.xml")!.bytes);
      const retained = await shell.exec(`${command} --output - | docx text -`);
      assert.equal(retained.exitCode, 0, retained.stderr);
      assert.equal(retained.stdout, expected);
      assert.deepEqual(volume.toJSON(), before);
    }
    const scripted = await shell.exec("sh ./remove.sh");
    assert.equal(scripted.exitCode, 0, scripted.stderr);
    assert.equal(scripted.stdout, "First harbor remains\nMiddle meadow\nLast ridge");
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("docx destructive removal requires explicit selection and retains destinations on annotation rejection", async () => {
  const { shell, volume } = await fixture(`<w:p><w:bookmarkStart w:id="2" w:name="harbor"/>${run("Keep anchored text")}<w:bookmarkEnd w:id="2"/></w:p>` + paragraph("Keep other text"));
  try {
    const before = volume.toJSON();
    for (const resource of ["paragraphs", "runs", "tables"]) {
      const missing = await shell.exec(`docx ${resource} remove input.docx --dry-run --json`);
      assert.equal(missing.exitCode, 2, missing.stderr);
      assert.equal(JSON.parse(missing.stdout).affected, 0);
    }
    const rejected = await shell.exec("docx paragraphs remove input.docx --paragraph 1 --output existing.docx --force --json");
    assert.equal(rejected.exitCode, 1, rejected.stderr);
    const report = JSON.parse(rejected.stdout);
    assert.equal(report.affected, 0);
    assert.equal(report.errors[0].code, "unsupported-edit");
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("docx scalar range removal requires marker intent and retains exact formatted Unicode survivors", async () => {
  const { shell, volume } = await fixture(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>North🌊</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>meadow</w:t></w:r>${run("South")}</w:p>`);
  try {
    const before = volume.toJSON();
    const inspection = await inspectDocument(new Uint8Array(volume.readFileSync("/work/input.docx") as Uint8Array), textContext);
    const story = inspection.stories.find(item => item.kind === "body")!.location.value;
    const token = encodeLocation({ ...story, path: [0, 0], range: { start: 5, end: 12 } });
    for (const resource of ["paragraphs", "runs"]) {
      const command = `docx ${resource} remove input.docx --select '${token}'`;
      const missing = await shell.exec(`${command} --dry-run --json`);
      assert.equal(missing.exitCode, 2, missing.stderr);
      for (const markers of ["exclude", "include"]) {
        const retained = await shell.exec(`${command} --markers ${markers} --output - | docx text -`);
        assert.equal(retained.exitCode, 0, retained.stderr);
        assert.equal(retained.stdout, "NorthSouth");
        const xml = await shell.exec(`${command} --markers ${markers} --output - | docx xml get - --part /word/document.xml --raw`);
        assert.equal(xml.exitCode, 0, xml.stderr);
        const document = parseDocumentXml(xml.stdoutBytes).root;
        const paragraph = document.children[0]!.children[0]!;
        const firstRun = paragraph.children.find(node => node.localName === "r")!;
        assert.equal(firstRun.children.find(node => node.localName === "t")!.text, "North");
        assert.equal(firstRun.children.find(node => node.localName === "rPr")!.children[0]!.localName, "b");
      }
    }
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});
