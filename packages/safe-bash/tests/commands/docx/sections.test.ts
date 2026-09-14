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

test("docx sections list reads paragraph and final section owners without mutation", async () => {
  const { shell, volume } = await fixture();
  const before = volume.toJSON();
  try {
    const result = await shell.exec("docx sections list source.docx --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.operation, "sections.list");
    assert.equal(envelope.data.items.length, 2);
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("docx sections set applies explicit page geometry and policy to one section", async () => {
  const { shell, volume } = await fixture();
  try {
    const command = "docx sections set source.docx --section 1 --orientation LANDSCAPE --page-width 11in --page-height 8.5in --start-type CONTINUOUS --columns 2 --gutter 0.2in --different-first-page true";
    const before = volume.toJSON();
    const dryRun = await shell.exec(`${command} --dry-run --json`);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.deepEqual(volume.toJSON(), before);
    const result = await shell.exec(`${command} --in-place --json`);
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.operation, "sections.set");
    assert.equal(envelope.affected, 1);
    const xml = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    assert.equal(xml.exitCode, 0, xml.stderr);
    const body = child(parseDocumentXml(xml.stdoutBytes).root, "body");
    const section = child(child(child(body, "p"), "pPr"), "sectPr");
    assert.equal(attribute(child(section, "pgSz"), "orient"), "landscape");
    assert.equal(attribute(child(section, "type"), "val"), "continuous");
    assert.equal(attribute(child(section, "cols"), "num"), "2");
    assert.equal(attribute(child(section, "pgMar"), "gutter"), "288");
    assert.equal(attribute(child(section, "pgSz"), "w"), "15840");
    assert.equal(attribute(child(section, "pgSz"), "h"), "12240");
    assert.ok(child(section, "titlePg"));
    const final = child(body, "sectPr");
    assert.equal(attribute(child(final, "pgSz"), "w"), "12240");
    assert.equal(attribute(child(final, "pgSz"), "h"), "15840");
    assert.ok(xml.stdout.includes("North coast"));
    assert.ok(xml.stdout.includes("South coast"));
    assert.equal(volume.readdirSync("/work").length, 1);
  } finally { await shell.dispose(); }
});

test("docx sections add appends a next-page section and preserves the final body owner", async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec("docx sections add source.docx --in-place --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.operation, "sections.add");
    assert.equal(envelope.affected, 1);
    const listed = await shell.exec("docx sections list source.docx --json");
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).data.items.length, 3);
    const xml = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    assert.equal(xml.exitCode, 0, xml.stderr);
    const body = child(parseDocumentXml(xml.stdoutBytes).root, "body");
    const breaks = body.children.filter(node => node.localName === "p" && node.namespace === wordNamespace)
      .filter(node => child(node, "pPr") && child(child(node, "pPr"), "sectPr"));
    assert.equal(breaks.length, 2);
    assert.equal(body.children.at(-1), child(body, "sectPr"));
    assert.equal(attribute(child(child(body, "sectPr"), "type"), "val"), "nextPage");
    assert.ok(xml.stdout.includes("South coast"));
  } finally { await shell.dispose(); }
});

for (const kind of ["headers", "footers"]) {
  test(`docx ${kind} preserves inherited owners through local, shared and removed bindings`, async () => {
    const { shell, volume } = await fixture();
    try {
      const before = volume.toJSON();
      const absent = await shell.exec(`docx ${kind} get source.docx --section 2 --variant first --json`);
      assert.equal(absent.exitCode, 0, absent.stderr);
      assert.equal(JSON.parse(absent.stdout).data.items[0].part, null);
      assert.deepEqual(volume.toJSON(), before);
      for (const variant of ["default", "first", "even"]) {
        const created = await shell.exec(`docx ${kind} set source.docx --section 1 --variant ${variant} --link-to-previous false --text 'Coastal ledger' --in-place --json`);
        assert.equal(created.exitCode, 0, created.stderr);
        const link = await shell.exec(`docx ${kind} set source.docx --section 2 --variant ${variant} --link-to-previous true --in-place --json`);
        assert.equal(link.exitCode, 0, link.stderr);
      }
      const inherited = await shell.exec(`docx ${kind} get source.docx --section 2 --json`);
      assert.equal(inherited.exitCode, 0, inherited.stderr);
      assert.equal(JSON.parse(inherited.stdout).data.items[0].linked, true);
      assert.equal(JSON.parse(inherited.stdout).data.items[0].text, "Coastal ledger");
      const local = await shell.exec(`docx ${kind} set source.docx --section 2 --link-to-previous false --text 'Southern ledger' --in-place --json`);
      assert.equal(local.exitCode, 0, local.stderr);
      const original = await shell.exec(`docx ${kind} get source.docx --section 1 --json`);
      assert.equal(JSON.parse(original.stdout).data.items[0].text, "Coastal ledger");
      const linked = await shell.exec(`docx ${kind} set source.docx --section 2 --link-to-previous true --in-place --json`);
      assert.equal(linked.exitCode, 0, linked.stderr);
      const shared = await shell.exec(`docx ${kind} set source.docx --section 2 --shared --text 'Tidal ledger' --in-place --json`);
      assert.equal(shared.exitCode, 0, shared.stderr);
      assert.deepEqual(JSON.parse(shared.stdout).data.affectedSections, [1, 2]);
      const detached = await shell.exec(`docx ${kind} set source.docx --section 2 --link-to-previous false --in-place --json`);
      assert.equal(detached.exitCode, 0, detached.stderr);
      const removed = await shell.exec(`docx ${kind} remove source.docx --section 2 --in-place --json`);
      assert.equal(removed.exitCode, 0, removed.stderr);
      const listed = await shell.exec(`docx ${kind} list source.docx --json`);
      assert.equal(listed.exitCode, 0, listed.stderr);
      const records = JSON.parse(listed.stdout).data.items;
      assert.equal(records.length, 6);
      assert.equal(records[0].text, "Tidal ledger");
      assert.equal(records[3].text, "Tidal ledger");
      assert.equal(records[3].linked, true);
      assert.equal(records[3].part, records[0].part);
      assert.equal(records[1].text, "Coastal ledger");
      assert.equal(records[2].text, "Coastal ledger");
      assert.equal(volume.readdirSync("/work").length, 1);
    } finally { await shell.dispose(); }
  });
}

test("docx story paragraphs and text replacement preserve body text", async () => {
  const { shell } = await fixture();
  try {
    for (const command of [
      "docx headers set source.docx --section 2 --link-to-previous false --text 'Morning tide' --in-place",
      "docx paragraphs add source.docx --scope headers --section 2 --text 'Harbor notes' --in-place",
      "docx text replace source.docx --scope headers --section 2 --find Morning --with Evening --all --in-place"
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, `${command}\n${result.stderr}`);
    }
    const header = await shell.exec("docx headers get source.docx --section 2 --json");
    assert.equal(header.exitCode, 0, header.stderr);
    assert.equal(JSON.parse(header.stdout).data.items[0].text, "Evening tide\nHarbor notes");
    const readable = await shell.exec("docx headers get source.docx --section 2");
    assert.equal(readable.exitCode, 0, readable.stderr);
    assert.ok(readable.stdout.includes("\nEvening tide\nHarbor notes\n"), readable.stdout);
    const body = await shell.exec("docx text source.docx");
    assert.equal(body.exitCode, 0, body.stderr);
    assert.equal(body.stdout, "North coast\nSouth coast");
  } finally { await shell.dispose(); }
});

test("docx failed story edits preserve source and preexisting destination bytes", async () => {
  const { shell, volume } = await fixture();
  try {
    volume.writeFileSync("/work/destination.docx", "Existing destination bytes");
    const before = volume.toJSON();
    for (const options of [
      "--section 1 --link-to-previous true",
      "--section 2 --text 'Missing explicit intent'",
      "--section 3 --link-to-previous false --text 'Absent section'"
    ]) {
      for (const destination of ["--in-place", "--output destination.docx --force"]) {
        const result = await shell.exec(`docx headers set source.docx ${options} ${destination} --json`);
        assert.notEqual(result.exitCode, 0);
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, false);
        assert.equal(envelope.affected, 0);
        assert.deepEqual(volume.toJSON(), before);
      }
    }
  } finally { await shell.dispose(); }
});
