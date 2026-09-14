import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { encodeLocation, openDocumentLocations, parseDocumentXml, readDocumentArchive, type XmlElement } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textFixture, run, textContext, w } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const metadata = '--author "Mira & Co" --timestamp 2026-04-03T02:01:00.123Z';

async function fixture(body = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A😀</w:t></w:r>${run(" coast")}</w:p>`) {
  const bytes = await textFixture(body);
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes), "/work/existing.docx": "untouched destination" });
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
  return { shell, volume, bytes };
}

test("docx tracked replacement preserves exact views through a VFS script and binary stdin pipes", async () => {
  const { shell, volume, bytes } = await fixture();
  const command = `docx text replace input.docx --find '😀 co' --with '🌊 bay' --first --track-changes ${metadata} --output -`;
  volume.writeFileSync("/work/review.sh", `${command} | docx text - --view original\n`);
  const before = volume.toJSON();
  try {
    const original = await shell.exec("sh ./review.sh");
    assert.equal(original.exitCode, 0, original.stderr);
    assert.equal(original.stdout, "A😀 coast");
    for (const [view, expected] of [["final", "A🌊 bayast"], ["all", "A😀 co🌊 bayast"]]) {
      const result = await shell.exec(`${command} | docx text - --view ${view}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    const binary = await shell.exec(command);
    assert.equal(binary.exitCode, 0, binary.stderr);
    assert.equal(binary.stderr, "");
    assert.deepEqual([...binary.stdoutBytes.slice(0, 4)], [80, 75, 3, 4]);
    const archive = await readDocumentArchive(binary.stdoutBytes, textContext);
    const elements: XmlElement[] = [];
    const visit = (node: XmlElement): void => { elements.push(node); node.children.forEach(visit); };
    visit(parseDocumentXml(archive.members.find(member => member.name === archive.mainPart)!.bytes).root);
    const revisions = elements.filter(node => node.namespace === w && ["ins", "del"].includes(node.localName));
    assert.ok(revisions.some(node => node.localName === "ins"));
    assert.ok(revisions.some(node => node.localName === "del"));
    for (const node of revisions) {
      assert.equal(node.attributes.find(attribute => attribute.namespace === w && attribute.localName === "author")?.value, "Mira & Co");
      assert.equal(node.attributes.find(attribute => attribute.namespace === w && attribute.localName === "date")?.value, "2026-04-03T02:01:00.123Z");
    }
    assert.ok(elements.some(node => node.namespace === w && node.localName === "delText"));
    assert.deepEqual(volume.toJSON(), before);
    assert.deepEqual(volume.readFileSync("/work/input.docx"), Buffer.from(bytes));
  } finally { await shell.dispose(); }
});

test("docx revisions add exposes caret insertion and whole paragraph deletion through Shell", async () => {
  const { shell, volume, bytes } = await fixture();
  const before = volume.toJSON();
  try {
    const document = await openDocumentLocations(bytes, textContext);
    const paragraph = document.list("paragraph")[0];
    assert.ok(paragraph);
    const token = encodeLocation({ ...paragraph.value, range: { start: 2, end: 2 } });
    const insert = `docx revisions add input.docx --kind insert --select '${token}' --text '!' ${metadata} --output -`;
    for (const [view, expected] of [["original", "A😀 coast"], ["final", "A😀! coast"]]) {
      const result = await shell.exec(`${insert} | docx text - --view ${view}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    const append = await shell.exec(`docx revisions add input.docx --kind insert --paragraph 1 --text '!' ${metadata} --output - | docx text - --view final`);
    assert.equal(append.exitCode, 0, append.stderr);
    assert.equal(append.stdout, "A😀 coast!");
    const remove = `docx revisions add input.docx --kind delete --paragraph 1 ${metadata} --output -`;
    for (const [view, expected] of [["original", "A😀 coast"], ["final", ""]]) {
      const result = await shell.exec(`${remove} | docx text - --view ${view}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("docx tracked dry-run and invalid metadata have no publication effects", async () => {
  const { shell, volume } = await fixture();
  const before = volume.toJSON();
  const replace = "docx text replace input.docx --find coast --with bay --first";
  try {
    const dry = await shell.exec(`${replace} --track-changes ${metadata} --dry-run --output - --json`);
    assert.equal(dry.exitCode, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).affected, 1);
    assert.equal(JSON.parse(dry.stdout).data.dryRun, true);
    for (const options of ["--track-changes", '--track-changes --author Mira', `${metadata}`, '--track-changes --author Mira --timestamp 2026-04-03T02:01:00+00:00']) {
      const result = await shell.exec(`${replace} ${options} --output existing.docx --force --json`);
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(JSON.parse(result.stdout).affected, 0);
      assert.deepEqual(volume.toJSON(), before);
    }
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("docx tracked commands reject editing inside existing review content before publication", async () => {
  const { shell, volume } = await fixture(`<w:p><w:ins w:id="7" w:author="Reader" w:date="2026-01-01T00:00:00Z">${run("coast")}</w:ins></w:p>`);
  const before = volume.toJSON();
  try {
    for (const operation of ["text replace input.docx --find coast --with bay --first --track-changes", "revisions add input.docx --kind delete --paragraph 1"]) {
      const result = await shell.exec(`docx ${operation} ${metadata} --dry-run --json`);
      assert.equal(result.exitCode, 1, result.stderr);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.affected, 0);
      assert.equal(envelope.data, null);
      assert.equal(envelope.errors[0].code, "unsupported-edit");
      assert.deepEqual(volume.toJSON(), before);
    }
  } finally { await shell.dispose(); }
});
