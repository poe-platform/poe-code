import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { createDocumentArchive, readDocumentArchive, writeDocumentArchive, createDocxCommandEngine, DocxUsageError } from "../../../docx/src/index.js";
import { createDocxCommand, docxCommands, type DocxCommandEngine } from "../../src/commands/docx/index.js";
import { collectBytes, writeBytes } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands, createAgentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/index.js";
import { FsError } from "../../src/contracts/errors.js";
import type { FileSystem } from "../../src/contracts/filesystem.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024 };

async function packFixture() {
  const { createDocxInspectionCommandEngine } = await import("../../../docx/src/inspection-command.js");
  const archive = await createDocumentArchive({ kind: "dotx", dialect: "strict", content: { version: 1, blocks: [{ kind: "paragraph", text: "  Coast café 日本語  " }] } }, { limits, signal: new AbortController().signal });
  const directory = "/work/coast café 日本語";
  const volume = Volume.fromJSON({ "/work/existing.dotx": "Preserve destination", [directory]: null });
  const entries = archive.members.filter(member => !member.directory).map(member => ({
    part: member.name === "[Content_Types].xml" ? member.name : `/${member.name}`,
    path: member.name,
    contentType: member.name === "[Content_Types].xml" ? "application/xml" : archive.package.getPart(`/${member.name}`).content_type,
    bytes: member.bytes.length,
    sha256: createHash("sha256").update(member.bytes).digest("hex"),
  })).sort((left, right) => left.part < right.part ? -1 : left.part > right.part ? 1 : 0);
  for (const member of archive.members.filter(member => !member.directory)) {
    const path = `${directory}/${member.name}`;
    volume.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    volume.writeFileSync(path, member.bytes);
  }
  const inventory = { version: 1, kind: archive.kind, dialect: archive.dialect, entries };
  volume.writeFileSync(`${directory}/inventory.json`, JSON.stringify(inventory));
  volume.writeFileSync(`${directory}/unknown.bin`, "Do not import this file");
  const fs: FileSystem = new MemoryFileSystem();
  await fs.mkdir("/work");
  const identityScope = {};
  fs.lstat = fs.stat = async (path, options) => {
    options?.signal?.throwIfAborted();
    if (!volume.existsSync(path)) throw new FsError("ENOENT", { path });
    const stat = volume.lstatSync(path);
    return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: stat.size, mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, atimeMs: stat.atimeMs, ino: stat.ino, dev: stat.dev, identityScope, revision: Math.floor(stat.mtimeMs) };
  };
  fs.realpath = async (path, options) => { options?.signal?.throwIfAborted(); return String(volume.realpathSync(path)); };
  fs.readFile = async (path, options) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  fs.readdir = async () => { assert.fail("Pack scanned unlisted files"); };
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileStaging: true });
  fs.createStagedFile = async () => { assert.fail("Rejected output acquired staging"); };
  fs.publishStagedFile = async () => { assert.fail("Rejected output reached publication"); };
  fs.removeStagedFile = async () => { assert.fail("Rejected output acquired cleanup resources"); };
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits }) }));
  return { archive, directory, volume, fs, shell, inventory };
}

test("docx pack reads a quoted Unicode VFS inventory and preserves every admitted payload", async () => {
  const { archive, directory, shell } = await packFixture();
  try {
    const result = await shell.exec(`docx pack '${directory}/inventory.json' --output -`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = await readDocumentArchive(result.stdoutBytes, { limits, signal: new AbortController().signal });
    assert.equal(output.kind, "dotx");
    assert.equal(output.dialect, "strict");
    assert.deepEqual(output.members.map(member => member.name).sort(), archive.members.map(member => member.name).sort());
    for (const member of archive.members) assert.deepEqual(output.members.find(item => item.name === member.name)?.bytes, member.bytes, member.name);
  } finally { await shell.dispose(); }
});

test("docx pack consumes stdin inventory with explicit VFS records through a shell pipe", async () => {
  const { archive, directory, shell, inventory, volume } = await packFixture();
  const explicit = { ...inventory, entries: inventory.entries.map(entry => ({ ...entry, path: `${directory}/${entry.path}` })) };
  volume.writeFileSync("/work/explicit.json", JSON.stringify(explicit));
  try {
    const result = await shell.exec("cat explicit.json | docx pack - --output -");
    assert.equal(result.exitCode, 0, result.stderr);
    const output = await readDocumentArchive(result.stdoutBytes, { limits, signal: new AbortController().signal });
    for (const member of archive.members) assert.deepEqual(output.members.find(item => item.name === member.name)?.bytes, member.bytes, member.name);
    const relative = await shell.exec("docx pack - --output - --dry-run --json", { stdin: encoder.encode(JSON.stringify(inventory)) });
    assert.notEqual(relative.exitCode, 0);
    assert.equal(JSON.parse(relative.stdout).affected, 0);
  } finally { await shell.dispose(); }
});

test("docx pack rejects a missing relationship payload before binary publication", async () => {
  const { directory, inventory, volume, shell } = await packFixture();
  volume.writeFileSync(`${directory}/inventory.json`, JSON.stringify({ ...inventory, entries: inventory.entries.filter(entry => entry.part !== "/word/styles.xml") }));
  try {
    const result = await shell.exec(`docx pack '${directory}/inventory.json' --output -`);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdoutBytes.length, 0);
    const report = await shell.exec(`docx pack '${directory}/inventory.json' --dry-run --json`);
    assert.equal(JSON.parse(report.stdout).errors[0].code, "invalid-package");
  } finally { await shell.dispose(); }
});

test("docx pack output conflicts preserve existing files and reject input-tree destinations", async () => {
  const { directory, volume, shell } = await packFixture();
  try {
    for (const destination of ["/work/existing.dotx", `${directory}/new.dotx`]) {
      const result = await shell.exec(`docx pack '${directory}/inventory.json' --output '${destination}' --json`);
      assert.notEqual(result.exitCode, 0);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.affected, 0);
      assert.equal(envelope.data, null);
      assert.equal(envelope.errors[0].code, "conflict");
    }
    assert.equal(String(volume.readFileSync("/work/existing.dotx")), "Preserve destination");
    assert.equal(volume.existsSync(`${directory}/new.dotx`), false);
  } finally { await shell.dispose(); }
});

test("docx pack refuses VFS payload symlinks even when their target is admitted", async () => {
  const { directory, volume, shell } = await packFixture();
  const payload = `${directory}/word/document.xml`;
  volume.renameSync(payload, `${directory}/word/original.xml`);
  volume.symlinkSync("original.xml", payload);
  try {
    const result = await shell.exec(`docx pack '${directory}/inventory.json' --dry-run --json`);
    assert.equal(result.exitCode, 1, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.affected, 0);
    assert.equal(envelope.errors[0].code, "invalid-container");
  } finally { await shell.dispose(); }
});

test("docx pack cancellation during VFS admission leaves stdout unpublished", async () => {
  const { directory, fs, shell } = await packFixture();
  const controller = new AbortController();
  const read = fs.readFile.bind(fs);
  const reason = new Error("Caller stopped package admission");
  fs.readFile = async (path, options) => { if (path.endsWith("word/document.xml")) controller.abort(reason); return read(path, options); };
  try {
    await assert.rejects(shell.exec(`docx pack '${directory}/inventory.json' --output -`, { signal: controller.signal }), error => error === reason);
  } finally { await shell.dispose(); }
});

test("docx registers only by opt-in and refuses collisions before deliberate replacement", async () => {
  assert.equal(createAgentCommands().some(command => command.name === "docx"), false);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  assert.equal(shell.commands.has("docx"), false);
  assert.equal((await shell.exec("docx")).exitCode, 127);
  const engine: DocxCommandEngine = { async execute(request) {
    await writeBytes(request.stdout, encoder.encode("first engine\n"), request.signal);
    return { exitCode: 4 };
  } };
  shell.use(docxCommands({ engine }));
  const first = await shell.exec("docx");
  assert.equal(first.stdout, "first engine\n");
  assert.equal(first.exitCode, 4);
  assert.equal(shell.commands.has("docx"), true);
  const original = shell.commands.get("docx");
  const collision = new Shell({ fs: new MemoryFileSystem(), commands: shell.commands }).use(docxCommands({ engine }));
  await assert.rejects(collision.exec("docx"), /already registered/);
  assert.equal(shell.commands.get("docx"), original);
  shell.use(docxCommands({ engine: { async execute(request) {
    await writeBytes(request.stdout, encoder.encode("replacement\n"), request.signal);
    return { exitCode: 2 };
  } }, replace: true }));
  const replaced = await shell.exec("docx");
  assert.equal(replaced.stdout, "replacement\n");
  assert.equal(replaced.exitCode, 2);
  await shell.dispose();
});

test("docx dispatch preserves literal byte arguments streams and SDK archive behavior", async () => {
  const volume = Volume.fromJSON({ "/work": null });
  const fs = new MemoryFileSystem();
  fs.readFile = async (path, options) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.writeFile = async (path, bytes, options) => { options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes); };
  const seen: Uint8Array[][] = [];
  let cleaned = false;
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  shell.register(createDocxCommand({ engine: { async execute(request) {
    assert.equal(typeof request.filesystem.readFile, "function");
    assert.equal(request.cwd, "/work");
    assert.equal(request.stdinIsDefault, false);
    request.registerCleanup?.(async () => { cleaned = true; });
    seen.push(request.args.map(bytes => new Uint8Array(bytes)));
    const context = { limits, signal: request.signal };
    const document = await createDocumentArchive({}, context);
    const chunks: Uint8Array[] = [];
    await writeDocumentArchive(document, { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, { order: "name", compression: "store" }, context);
    const size = chunks.reduce((total, bytes) => total + bytes.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    await request.filesystem.writeFile("/work/original.docx", output, { signal: request.signal });
    const admitted = await readDocumentArchive(await request.filesystem.readFile("/work/original.docx", { signal: request.signal }), context);
    assert.equal(admitted.members.some(member => member.name === "word/document.xml"), true);
    const input = await collectBytes(request.stdin, { maxBytes: 100, signal: request.signal });
    await writeBytes(request.stdout, input, request.signal);
    await writeBytes(request.stderr, encoder.encode("checked\n"), request.signal);
    return { exitCode: 0 };
  } } }));
  const result = await shell.exec("printf 'Coastal notes' | docx 'images' 'a b' '; touch x' $'\\xff' --");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "Coastal notes");
  assert.equal(result.stderr, "checked\n");
  assert.deepEqual(seen[0]!.slice(0, 3).map(bytes => decoder.decode(bytes)), ["images", "a b", "; touch x"]);
  assert.deepEqual(seen[0]![3], new Uint8Array([255]));
  assert.equal(decoder.decode(seen[0]![4]), "--");
  assert.equal(cleaned, true);
  await shell.dispose();
});

test("docx validates explicit configuration before registry mutation", () => {
  assert.throws(() => createDocxCommand(undefined as never), /engine/);
  assert.throws(() => docxCommands({ engine: {} } as never), /engine/);
  assert.throws(() => docxCommands({ engine: { execute: async () => ({ exitCode: 0 }) }, replace: "yes" } as never), /boolean/);
});


test("docx cancellation waits for registered cleanup and rejects invalid exit statuses", async () => {
  const controller = new AbortController();
  let cleanupFinished = false;
  let observedSignal: AbortSignal | undefined;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine: {
    async execute(request) {
      observedSignal = request.signal;
      request.registerCleanup?.(async () => { await Promise.resolve(); cleanupFinished = true; });
      controller.abort("stop document operation");
      return { exitCode: 0 };
    }
  } }));
  await assert.rejects(shell.exec("docx", { signal: controller.signal }), error => error === "stop document operation");
  assert.equal(observedSignal?.aborted, true);
  assert.equal(cleanupFinished, true);
  await shell.dispose();
  const failures: unknown[] = [];
  const invalid = new Shell({ fs: new MemoryFileSystem(), onInternalError(error) { failures.push(error); } })
    .use(docxCommands({ engine: { async execute() { return { exitCode: 256 }; } } }));
  assert.equal((await invalid.exec("docx")).exitCode, 1);
  assert.equal(failures.length, 1);
  assert.ok(failures[0] instanceof RangeError);
  await invalid.dispose();
});

test("docx shared grammar rejects invalid byte text and conflicting stdin before handler I/O", async () => {
  let calls = 0;
  let reads = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine: createDocxCommandEngine({
    async execute() { calls++; return { exitCode: 0 }; },
  }) }));
  try {
    for (const command of [
      "docx text $'\\xff'",
      "docx text $'\\xc0\\xaf'",
      "docx batch - --ops-file - --in-place",
      "docx images replace - --image 1 --file - --output result.docx",
      "docx text replace - --find old --with new --all --output - --json",
      "docx text --unknown missing.docx",
    ]) {
      const result = await shell.exec(command, { stdin: { [Symbol.asyncIterator]() {
        return { next: async () => { reads++; return { done: true, value: undefined }; } };
      } } });
      assert.equal(result.exitCode, 2, command);
      if (command.endsWith("--json")) {
        const envelope = JSON.parse(result.stdout) as { ok: boolean; affected: number; errors: { code: string }[] };
        assert.equal(envelope.ok, false);
        assert.equal(envelope.affected, 0);
        assert.equal(envelope.errors[0]?.code, "usage");
      } else {
        assert.equal(result.stdout, "", command);
        assert.notEqual(result.stderr, "", command);
      }
    }
    assert.equal(calls, 0);
    assert.equal(reads, 0);
  } finally { await shell.dispose(); }
});

test("docx grammar dispatch keeps quoted JSON Unicode and shell syntax literal", async () => {
  const calls: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine: createDocxCommandEngine({
    async execute(invocation) { calls.push(invocation); return { exitCode: 0 }; },
  }) }));
  try {
    const input = "-coastal café 日本語.docx";
    const result = await shell.exec(`docx template apply --data-json '{"values":[{"binding":"title","value":"$(touch forbidden); \\"quoted\\" 🌊"}]}' --output result.docx -- '${input}'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(calls.length, 1);
    const invocation = calls[0] as { operation: string; inputs: string[]; options: Record<string, unknown> };
    assert.equal(invocation.operation, "template.apply");
    assert.deepEqual(invocation.inputs, [input]);
    assert.deepEqual(invocation.options.data, { values: [{ binding: "title", value: '$(touch forbidden); "quoted" 🌊' }] });
  } finally { await shell.dispose(); }
});

test("docx parsed invocation preserves binary stdin stdout without text conversion", async () => {
  const payload = new Uint8Array([0, 255, 254, 128, 80, 75, 13, 10]);
  const engine: DocxCommandEngine = createDocxCommandEngine({
    async execute(invocation, request) {
      assert.equal(invocation.operation, "text.replace");
      assert.deepEqual(invocation.inputs, ["-"]);
      assert.equal(invocation.options.with, "");
      assert.equal(invocation.options.output, "-");
      const bytes = await collectBytes(request.stdin, { maxBytes: 100, signal: request.signal });
      await writeBytes(request.stdout, bytes, request.signal);
      return { exitCode: 0 };
    },
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine }));
  try {
    const result = await shell.exec("docx text replace - --find old --with '' --all --output -", { stdin: payload });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, payload);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("docx discovery executes through Shell without document handler or stream acquisition", async () => {
  let calls = 0;
  let reads = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine: createDocxCommandEngine({
    async execute() { calls++; return { exitCode: 0 }; },
  }) }));
  try {
    for (const command of ["docx", "docx -h", "docx help", "docx --help"]) {
      const result = await shell.exec(command, { stdin: { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array([255]); } } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes("docx"));
      assert.ok(result.stdout.includes("schema"));
      assert.equal(result.stderr, "");
    }
    const version = await shell.exec("docx --version --json");
    assert.equal(version.exitCode, 0, version.stderr);
    assert.equal(version.stderr, "");
    const envelope = JSON.parse(version.stdout) as { version: number; operation: string; ok: boolean; data: { name: string; version: string; schemaVersion: number }; warnings: unknown[]; errors: unknown[]; affected: number; locations: unknown[] };
    assert.deepEqual(Object.keys(envelope).sort(), ["affected", "data", "errors", "locations", "ok", "operation", "version", "warnings"]);
    assert.equal(envelope.operation, "version");
    assert.equal(envelope.version, 1);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.name, "docx");
    assert.equal(typeof envelope.data.version, "string");
    assert.ok(envelope.data.version.length > 0);
    assert.equal(envelope.data.schemaVersion, 1);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.warnings, []);
    assert.deepEqual(envelope.errors, []);
    assert.deepEqual(envelope.locations, []);
    assert.equal(calls, 0);
    assert.equal(reads, 0);
  } finally { await shell.dispose(); }
});

test("docx human source diagnostics escape terminal controls while JSON remains one structured value", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine: createDocxCommandEngine({
    async readSource() { throw new DocxUsageError("Coastal detail \u001b[2J\r\u007f" + "🌊".repeat(1500)); },
    async execute() { assert.fail("invalid input reached the document handler"); },
  }) }));
  try {
    const command = "docx batch file.docx --ops-file ops.json --json --limit diagnosticBytes=96";
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 2);
    const envelope = JSON.parse(result.stdout) as { operation: string; ok: boolean; data: unknown; errors: { code: string; message: string }[]; affected: number; locations: unknown[] };
    assert.equal(envelope.operation, "batch");
    assert.equal(envelope.ok, false);
    assert.equal(envelope.data, null);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.locations, []);
    assert.equal(envelope.errors[0]?.code, "usage");
    assert.equal(result.stderr.includes("\u001b"), false);
    assert.equal(result.stderr.includes("\r"), false);
    assert.equal(result.stderr.includes("\u007f"), false);
    assert.ok(result.stderr.includes("truncat"), "truncated diagnostics must identify omitted content");
    assert.ok(result.stderrBytes.byteLength <= 96);
    assert.ok(encoder.encode(JSON.stringify(envelope.errors)).length <= 96);
  } finally { await shell.dispose(); }
});

test("docx read-only engine inspects stdin through Shell without filesystem mutation", async () => {
  const { createDocxInspectionCommandEngine } = await import("../../../docx/src/inspection-command.js");
  const { inspectDocument } = await import("../../../docx/src/inspection.js");
  const signal = new AbortController().signal;
  const context = { limits, signal };
  const archive = await createDocumentArchive({}, context);
  const chunks: Uint8Array[] = [];
  await writeDocumentArchive(archive, { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, { order: "name", compression: "store" }, context);
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const fs = new MemoryFileSystem();
  fs.readFile = async () => { assert.fail("unexpected filesystem read"); };
  fs.writeFile = async () => { assert.fail("unexpected filesystem mutation"); };
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits }) }));
  try {
    const result = await shell.exec("docx inspect - --json", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout) as { data: unknown; affected: number };
    assert.deepEqual(envelope.data, await inspectDocument(bytes, context));
    assert.equal(envelope.affected, 0);
    const invalid = await shell.exec("docx validate - --json", { stdin: encoder.encode("broken container") });
    assert.equal(invalid.exitCode, 1);
    assert.equal(JSON.parse(invalid.stdout).ok, false);
  } finally { await shell.dispose(); }
});
