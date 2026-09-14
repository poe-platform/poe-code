import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocumentArchive, parseDocumentXml, writeArchive, type XmlElement } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/filesystem.js";
import { FsError } from "../../../src/contracts/errors.js";
import { dirname } from "../../../src/contracts/path.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const limits = { maxArchiveBytes: 131072, maxEntryBytes: 65536, maxTotalBytes: 131072, maxMembers: 32,
  maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024,
  maxRetainedBytes: 32 * 1024 * 1024, chunkSize: 1024 };
const context = { limits, signal: new AbortController().signal };
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const child = (node: XmlElement, name: string) => node.children.find(value => value.namespace === wordNamespace && value.localName === name)!;
const attribute = (node: XmlElement, name: string) => node.attributes.find(value => value.namespace === wordNamespace && value.localName === name)?.value;

async function fixture() {
  const archive = await createDocumentArchive({}, context);
  const xml = new TextEncoder().encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:pPr><w:r><w:t>North coast</w:t></w:r></w:p><w:p><w:r><w:t>South coast</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>');
  const volume = Volume.fromJSON({ "/work/source.docx": "" });
  await writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: xml } : member) },
    { async write(bytes) { volume.appendFileSync("/work/source.docx", bytes); } }, { order: "input", compression: "store" }, context);
  const fs: FileSystem = new MemoryFileSystem();
  await fs.mkdir("/work");
  const identityScope = {};
  const snapshot = (path: string): FileStat => {
    const value = volume.lstatSync(path);
    return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode,
      mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino,
      dev: value.dev, nlink: value.nlink, revision: value.mtimeMs, identityScope };
  };
  fs.stat = fs.lstat = async (path, options) => {
    options?.signal?.throwIfAborted();
    if (!volume.existsSync(path)) throw new FsError("ENOENT", { path });
    return snapshot(path);
  };
  fs.realpath = async (path, options) => { options?.signal?.throwIfAborted(); return String(volume.realpathSync(path)); };
  fs.readFile = async (path, options) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Uint8Array); };
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileStaging: true, open: false, randomAccessWrite: false });
  fs.createStagedFile = async (directory, name, content, options) => {
    options.signal?.throwIfAborted();
    const parent = dirname(directory);
    assert.equal(snapshot(parent).ino, options.parent.ino);
    volume.mkdirSync(directory);
    if (content.type !== "file") throw new Error("Expected file staging");
    volume.writeFileSync(`${directory}/${name}`, content.data);
    return { parent: { path: parent, stat: snapshot(parent) }, directory: { path: directory, stat: snapshot(directory) }, file: { path: `${directory}/${name}`, stat: snapshot(`${directory}/${name}`) } };
  };
  fs.publishStagedFile = async (stage, path, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? snapshot(path) : null;
    const expected = options.destination;
    if ((current === null) !== (expected === null) || (["ino", "dev", "revision", "size", "mode", "mtimeMs", "ctimeMs"] as const).some(key => current?.[key] !== expected?.[key])) {
      throw Object.assign(new Error("Destination changed"), { code: "EAGAIN" });
    }
    volume.renameSync(stage.file.path, path);
  };
  fs.removeStagedFile = async stage => { volume.rmSync(stage.directory.path, { recursive: true }); };
  const shell = new Shell({ fs, cwd: "/work" }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits }) }));
  return { shell, volume };
}

test("docx tables add builds an explicit empty grid and preserves section owners", async () => {
  const { shell, volume } = await fixture();
  try {
    const before = volume.toJSON();
    const command = "docx tables add source.docx --rows 2 --cols 3";
    const dry = await shell.exec(`${command} --dry-run --json`);
    assert.equal(dry.exitCode, 0, dry.stderr);
    assert.deepEqual(volume.toJSON(), before);
    const result = await shell.exec(`${command} --in-place --json`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation, "tables.add");
    const xml = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    assert.equal(xml.exitCode, 0, xml.stderr);
    const body = child(parseDocumentXml(xml.stdoutBytes).root, "body");
    const table = child(body, "tbl");
    assert.deepEqual(child(table, "tblGrid").children.map(column => attribute(column, "w")), ["3120", "3120", "3120"]);
    const rows = table.children.filter(node => node.localName === "tr");
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const cells = row.children.filter(node => node.localName === "tc");
      assert.equal(cells.length, 3);
      for (const cell of cells) {
        assert.equal(cell.children.at(-1)?.localName, "p");
        assert.equal(child(cell, "p").children.length, 0);
        assert.equal(attribute(child(child(cell, "tcPr"), "tcW"), "w"), "3120");
      }
    }
    assert.equal(body.children.at(-1)?.localName, "sectPr");
    assert.equal(attribute(child(child(body, "sectPr"), "pgSz"), "w"), "12240");
    assert.ok(child(child(child(body, "p"), "pPr"), "sectPr"));
    assert.ok(xml.stdout.includes("North coast"));
    assert.ok(xml.stdout.includes("South coast"));
    assert.deepEqual(volume.readdirSync("/work"), ["source.docx"]);
  } finally { await shell.dispose(); }
});

test("docx tables add applies fixed widths and explicit row policies", async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec("docx tables add source.docx --rows 2 --cols 2 --width 4in --autofit false --repeat-header true --allow-row-split false --cell-margin 2pt --row-height 12pt --height-rule EXACTLY --in-place --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const xml = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    const table = child(child(parseDocumentXml(xml.stdoutBytes).root, "body"), "tbl");
    assert.deepEqual(child(table, "tblGrid").children.map(column => attribute(column, "w")), ["2880", "2880"]);
    assert.equal(attribute(child(child(table, "tblPr"), "tblLayout"), "type"), "fixed");
    for (const [index, row] of table.children.filter(node => node.localName === "tr").entries()) {
      const properties = child(row, "trPr");
      assert.equal(Boolean(child(properties, "tblHeader")), index === 0);
      assert.ok(child(properties, "cantSplit"));
      assert.equal(attribute(child(properties, "trHeight"), "val"), "240");
      assert.equal(attribute(child(properties, "trHeight"), "hRule"), "exact");
    }
  } finally { await shell.dispose(); }
});

test("docx tables add admits Unicode nested content with terminal cell paragraphs", async () => {
  const { shell } = await fixture();
  try {
    const content = { version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [
      { kind: "paragraph", text: "港湾 🌊" },
      { kind: "table", rows: [[{ blocks: [{ kind: "paragraph", text: "Łódź" }] }, { blocks: [] }]] }
    ] }]] }] };
    const result = await shell.exec(`docx tables add source.docx --rows 1 --cols 1 --width 4in --content-json '${JSON.stringify(content)}' --in-place --json`);
    assert.equal(result.exitCode, 0, result.stderr);
    const xml = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    const table = child(child(parseDocumentXml(xml.stdoutBytes).root, "body"), "tbl");
    const cell = child(child(table, "tr"), "tc");
    const nested = child(cell, "tbl");
    assert.deepEqual(child(nested, "tblGrid").children.map(column => attribute(column, "w")), ["2880", "2880"]);
    assert.equal(cell.children.at(-1)?.localName, "p");
    const cells = child(nested, "tr").children.filter(node => node.localName === "tc");
    assert.equal(cells.length, 2);
    assert.equal(cells[1]!.children.at(-1)?.localName, "p");
    assert.ok(xml.stdout.includes("港湾 🌊"));
    assert.ok(xml.stdout.includes("Łódź"));
  } finally { await shell.dispose(); }
});

test("docx invalid table requests preserve source and existing output", async () => {
  const { shell, volume } = await fixture();
  try {
    volume.writeFileSync("/work/output.docx", "Previously approved document");
    const before = volume.toJSON();
    const mismatched = JSON.stringify({ version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [] }]] }] });
    for (const options of ["--rows 0 --cols 2", "--rows 2 --cols 0", "--rows 2 --cols 2 --width 0pt", `--rows 2 --cols 2 --content-json '${mismatched}'`]) {
      const result = await shell.exec(`docx tables add source.docx ${options} --output output.docx --force --json`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(JSON.parse(result.stdout).ok, false);
      assert.deepEqual(volume.toJSON(), before);
    }
  } finally { await shell.dispose(); }
});

test("docx nested table insertion respects inherited table cell margins", async () => {
  const { shell } = await fixture();
  try {
    const outer = await shell.exec("docx tables add source.docx --rows 1 --cols 1 --width 4in --cell-margin 12pt --in-place --json");
    assert.equal(outer.exitCode, 0, outer.stderr);
    const inner = await shell.exec("docx tables add source.docx --table 1 --cell A1 --rows 1 --cols 2 --in-place --json");
    assert.equal(inner.exitCode, 0, inner.stderr);
    const xml = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    const table = child(child(parseDocumentXml(xml.stdoutBytes).root, "body"), "tbl");
    const cell = child(child(table, "tr"), "tc");
    assert.deepEqual(child(child(cell, "tbl"), "tblGrid").children.map(column => attribute(column, "w")), ["2640", "2640"]);
    assert.equal(cell.children.at(-1)?.localName, "p");
  } finally { await shell.dispose(); }
});

test("docx nested table insertion gives per-cell zero margins precedence over table defaults", async () => {
  const { shell } = await fixture();
  try {
    const content = { version: 1, blocks: [{ kind: "table", rows: [[{
      blocks: [], margins: { left: { value: 0, unit: "pt" } }
    }]] }] };
    const outer = await shell.exec(`docx tables add source.docx --rows 1 --cols 1 --width 4in --cell-margin 12pt --content-json '${JSON.stringify(content)}' --in-place --json`);
    assert.equal(outer.exitCode, 0, outer.stderr);
    const inner = await shell.exec("docx tables add source.docx --table 1 --cell A1 --rows 1 --cols 2 --in-place --json");
    assert.equal(inner.exitCode, 0, inner.stderr);
    const xml = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    const table = child(child(parseDocumentXml(xml.stdoutBytes).root, "body"), "tbl");
    const cell = child(child(table, "tr"), "tc");
    assert.equal(attribute(child(child(child(cell, "tcPr"), "tcMar"), "left"), "w"), "0");
    assert.deepEqual(child(child(cell, "tbl"), "tblGrid").children.map(column => attribute(column, "w")), ["2760", "2760"]);
  } finally { await shell.dispose(); }
});
