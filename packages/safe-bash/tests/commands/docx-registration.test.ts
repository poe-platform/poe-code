import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocumentArchive, readDocumentArchive, writeDocumentArchive } from "../../../docx/src/index.js";
import { createDocxCommand, docxCommands, type DocxCommandEngine } from "../../src/commands/docx/index.js";
import { collectBytes, writeBytes } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands, createAgentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024 };

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
