import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocumentArchive, readDocumentArchive, writeArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/filesystem.js";
import { FsError } from "../../../src/contracts/errors.js";
import { dirname } from "../../../src/contracts/path.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

const encoder = new TextEncoder();
const limits = { maxArchiveBytes: 131072, maxEntryBytes: 65536, maxTotalBytes: 131072, maxMembers: 32,
  maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024,
  maxRetainedBytes: 32 * 1024 * 1024, chunkSize: 1024 };
const context = { limits, signal: new AbortController().signal };
const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const replacement = encoder.encode(`<w:document xmlns:w="${namespace}"><w:body><w:p><w:r><w:t xml:space="preserve">  Bay café 日本語  </w:t></w:r></w:p></w:body></w:document>`);

async function fixture(utf16 = false, binary = false) {
  const archive = await createDocumentArchive({}, context);
  const xml = utf16 ? new Uint8Array(Buffer.concat([Buffer.from([255, 254]), Buffer.from(`<?xml version="1.0" encoding="UTF-16"?>${new TextDecoder().decode(replacement)}`, "utf16le")]))
    : encoder.encode(`<w:document xmlns:w="${namespace}"><w:body><w:p><w:r><w:t>Harbor draft</w:t></w:r></w:p></w:body></w:document>`);
  const volume = Volume.fromJSON({ "/work/source.docx": "", "/work/change.xml": Buffer.from(replacement), "/work/existing.docx": "Keep this destination" });
  const members = archive.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: xml } : member);
  if (binary) {
    const types = members.findIndex(member => member.name === "[Content_Types].xml");
    members[types] = { ...members[types]!, bytes: encoder.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>') };
    members.push({ ...members[0]!, name: "word/payload.bin", bytes: new Uint8Array([0, 255, 128, 13, 10]) });
  }
  await writeArchive({ ...archive, members },
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
  fs.writeFile = async (path, bytes, options) => { options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes); };
  fs.writeStream = async (path, source, options) => {
    options?.signal?.throwIfAborted();
    volume.writeFileSync(path, "");
    for await (const bytes of source) { options?.signal?.throwIfAborted(); volume.appendFileSync(path, bytes); }
  };
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileStaging: true, open: false, randomAccessWrite: false });
  fs.compareEntry = async (path, peer, other, options) => {
    options?.signal?.throwIfAborted();
    return peer === fs ? snapshot(path).ino === snapshot(other).ino ? "same" : "distinct" : "unknown";
  };
  fs.createStagedFile = async (directory, name, content, options) => {
    options.signal?.throwIfAborted();
    const parent = dirname(directory);
    assert.equal(snapshot(parent).ino, options.parent.ino);
    volume.mkdirSync(directory);
    assert.equal(content.type, "file");
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
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits }) }));
  return { shell, volume, xml, fs };
}

test("docx XML raw bytes survive UTF-16 Shell pipes and redirection", async () => {
  const { shell, volume, xml } = await fixture(true);
  try {
    const direct = await shell.exec("docx xml get source.docx --part /word/document.xml --raw");
    assert.equal(direct.exitCode, 0, direct.stderr);
    assert.deepEqual(direct.stdoutBytes, xml);
    assert.equal(direct.stderr, "");
    const piped = await shell.exec("docx xml get source.docx --part /word/document.xml --raw | cat > raw.xml");
    assert.equal(piped.exitCode, 0, piped.stderr);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/raw.xml") as Uint8Array), xml);
    const pretty = await shell.exec("docx xml get source.docx --part /word/document.xml --pretty");
    assert.equal(pretty.exitCode, 0, pretty.stderr);
    assert.ok(pretty.stdout.includes("  Bay café 日本語  "));
  } finally { await shell.dispose(); }
});

test("docx XML replacement stdin publishes pure package stdout and retains unrelated parts", async () => {
  const { shell, volume } = await fixture();
  const before = new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array);
  try {
    const result = await shell.exec("cat change.xml | docx xml set source.docx --part /word/document.xml --file - --output -");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = await readDocumentArchive(result.stdoutBytes, context);
    const original = await readDocumentArchive(before, context);
    for (const member of original.members) {
      assert.deepEqual(output.members.find(candidate => candidate.name === member.name)?.bytes,
        member.name === "word/document.xml" ? replacement : member.bytes, member.name);
    }
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array), before);
  } finally { await shell.dispose(); }
});

test("docx XML dry run validates without mutation and rejects dual stdin before reading", async () => {
  const { shell, volume } = await fixture();
  const before = volume.toJSON();
  try {
    const result = await shell.exec("docx xml set source.docx --part /word/document.xml --file change.xml --dry-run --output - --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout) as { ok: boolean; operation: string; data: { dryRun: boolean; output: unknown } };
    assert.equal(envelope.ok, true);
    assert.equal(envelope.operation, "xml.set");
    assert.equal(envelope.data.dryRun, true);
    assert.equal(envelope.data.output, null);
    assert.deepEqual(volume.toJSON(), before);
    const conflict = await shell.exec("docx xml set - --part /word/document.xml --file - --output -", {
      stdin: { async *[Symbol.asyncIterator]() { yield assert.fail("conflicting stdin was acquired"); } },
    });
    assert.equal(conflict.exitCode, 2);
    assert.equal(conflict.stdout, "");
  } finally { await shell.dispose(); }
});

test("docx XML rejects malformed replacement and dangling relationships before publication", async () => {
  const { shell, volume } = await fixture();
  const before = volume.toJSON();
  try {
    for (const [part, bytes] of [
      ["/word/document.xml", encoder.encode("<w:document>")],
      ["/word/document.xml", new Uint8Array([255, 0, 60, 0])],
      ["/word/document.xml", encoder.encode(`<w:document xmlns:w="${namespace}" xmlns:v="urn:coastal:extension"><w:body><v:unknown>opaque</v:unknown></w:body></w:document>`)],
      ["/_rels/.rels", encoder.encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="missing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/absent.xml"/></Relationships>')],
    ] as const) {
      const result = await shell.exec(`docx xml set source.docx --part '${part}' --file - --output existing.docx --force --json`, { stdin: bytes });
      assert.equal(result.exitCode, 1, result.stderr);
      const envelope = JSON.parse(result.stdout) as { ok: boolean; affected: number; data: unknown };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.affected, 0);
      assert.equal(envelope.data, null);
      assert.deepEqual(volume.toJSON(), before);
    }
  } finally { await shell.dispose(); }
});

test("docx XML rejects binary part reads and replacements without publication", async () => {
  const { shell, volume } = await fixture(false, true);
  const before = volume.toJSON();
  try {
    for (const command of [
      "docx xml get source.docx --part /word/payload.bin --raw",
      "docx xml set source.docx --part /word/payload.bin --file change.xml --output result.docx",
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("unsupported-edit"));
      assert.deepEqual(volume.toJSON(), before);
    }
  } finally { await shell.dispose(); }
});

test("docx XML file publication honors explicit output force alias and in-place intent", async () => {
  const { shell, volume } = await fixture();
  const before = new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array);
  const base = "docx xml set source.docx --part /word/document.xml --file change.xml";
  try {
    const dryRun = await shell.exec(`${base} --output reviewed.docx --dry-run --json`);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.equal(volume.existsSync("/work/reviewed.docx"), false);
    const created = await shell.exec(`${base} --output reviewed.docx --json`);
    assert.equal(created.exitCode, 0, created.stderr);
    const envelope = JSON.parse(created.stdout) as { ok: boolean; affected: number; data: { output: { path: string } } };
    assert.equal(envelope.ok, true);
    assert.equal(envelope.affected, 1);
    assert.equal(envelope.data.output.path, "/work/reviewed.docx");
    const output = await readDocumentArchive(new Uint8Array(volume.readFileSync("/work/reviewed.docx") as Uint8Array), context);
    assert.deepEqual(output.members.find(member => member.name === "word/document.xml")?.bytes, replacement);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array), before);
    const conflict = await shell.exec(`${base} --output existing.docx --json`);
    assert.equal(conflict.exitCode, 1, conflict.stderr);
    assert.equal(JSON.parse(conflict.stdout).errors[0].code, "conflict");
    assert.equal(volume.readFileSync("/work/existing.docx", "utf8"), "Keep this destination");
    const forced = await shell.exec(`${base} --output existing.docx --force --json`);
    assert.equal(forced.exitCode, 0, forced.stderr);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/existing.docx") as Uint8Array), new Uint8Array(volume.readFileSync("/work/reviewed.docx") as Uint8Array));
    volume.linkSync("/work/source.docx", "/work/alias.docx");
    const alias = await shell.exec(`${base} --output alias.docx --force --json`);
    assert.equal(alias.exitCode, 1, alias.stderr);
    assert.equal(JSON.parse(alias.stdout).errors[0].code, "conflict");
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array), before);
    const inPlace = await shell.exec(`${base} --in-place --json`);
    assert.equal(inPlace.exitCode, 0, inPlace.stderr);
    const changed = await readDocumentArchive(new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array), context);
    assert.deepEqual(changed.members.find(member => member.name === "word/document.xml")?.bytes, replacement);
    assert.equal(volume.readdirSync("/work").some(name => String(name).startsWith(".docx-stage-")), false);
  } finally { await shell.dispose(); }
});

test("docx XML engine bounds publication metadata before creating a long output destination", async () => {
  const { shell, volume, fs } = await fixture();
  const directory = "/work/" + Array.from({ length: 35 }, () => "coastal".repeat(28)).join("/");
  volume.mkdirSync(directory, { recursive: true });
  try {
    const result = await createDocxInspectionCommandEngine({ limits }).execute({
      args: ["xml", "set", "source.docx", "--part", "/word/document.xml", "--file", "change.xml", "--output", `${directory}/review.docx`, "--json", "--limit", "serializedOutput=6000"].map(value => encoder.encode(value)),
      cwd: "/work", filesystem: fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
    });
    assert.equal(result.exitCode, 4);
    assert.equal(volume.existsSync(`${directory}/review.docx`), false);
  } finally { await shell.dispose(); }
});
