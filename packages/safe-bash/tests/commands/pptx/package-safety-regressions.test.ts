import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { createPptxCommandEngine, createPresentation, extractPackage } from "pptx";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 200000, maxReads: 1000, chunkBytes: 65536 },
  archiveLimits: { maxArchiveBytes: 200000, maxEntryBytes: 100000, maxTotalBytes: 200000, maxMembers: 100, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 100000, chunkSize: 65536 },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());
async function setup() {
  const input = await createPresentation({}, context);
  const volume = Volume.fromJSON({ "/work/deck.pptx": Buffer.from(input), "/work/out": null, "/work/out/keep.txt": "untouched" });
  const fs: FileSystem = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async path => {
    try {
      const entry = volume.statSync(path);
      return { type: entry.isDirectory() ? "directory" : "file", size: Number(entry.size), mode: Number(entry.mode), atimeMs: Number(entry.atimeMs), mtimeMs: Number(entry.mtimeMs), ctimeMs: Number(entry.ctimeMs), identityScope, dev: Number(entry.dev), ino: Number(entry.ino), revision: Number(entry.mtimeMs), nlink: Number(entry.nlink) };
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.lstat = async path => {
    const result = await fs.stat(path);
    return volume.lstatSync(path).isSymbolicLink() ? { ...result, type: "symlink" } : result;
  };
  fs.access = async (path, mode) => {
    try { volume.accessSync(path, mode); } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.readStream = async function* (path) { yield new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.readFile = async path => new Uint8Array(volume.readFileSync(path) as Buffer);
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const observed = volume.existsSync(path) ? await fs.lstat(path) : null;
    if (observed?.ino !== options.expected?.ino || observed?.revision !== options.expected?.revision) throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 200000, maxArgumentBytes: 20000 }) }));
  return { input, fs, shell, volume };
}

test("package extraction preflights directory collisions and preserves unrelated files", async () => {
  const { shell, volume } = await setup();
  volume.mkdirSync("/work/out/part-000002.xml");
  const result = await shell.exec("pptx extract deck.pptx --output-dir out --allow-partial-output --force --json");
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).data, null);
  assert.equal(volume.existsSync("/work/out/part-000001.xml"), false);
  assert.equal(volume.readFileSync("/work/out/keep.txt", "utf8"), "untouched");
  assert.equal(volume.statSync("/work/out/part-000002.xml").isDirectory(), true);
});

test("package extraction reports exact completed members on conditional provider failure", async () => {
  const { shell, volume, fs } = await setup();
  const write = fs.writeFileConditional!;
  fs.writeFileConditional = async (path, bytes, options) => {
    if (path.endsWith("part-000002.xml")) throw new FsError("EIO");
    return write(path, bytes, options);
  };
  const result = await shell.exec("pptx extract deck.pptx --output-dir out --allow-partial-output --json");
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  assert.notEqual(JSON.parse(result.stdout).data, null, result.stdout);
  const outputs = JSON.parse(result.stdout).data.outputs;
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].path, "out/part-000001.xml");
  const bytes = volume.readFileSync("/work/out/part-000001.xml") as Buffer;
  assert.equal(outputs[0].bytes, bytes.length);
  assert.equal(outputs[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(volume.existsSync("/work/out/part-000002.xml"), false);
  assert.equal(volume.readFileSync("/work/out/keep.txt", "utf8"), "untouched");
});

test("package packing rejects incomplete graphs and traversal before overwriting an existing output", async () => {
  const { input, shell, volume } = await setup();
  const files = await extractPackage(input, context);
  for (const file of files) volume.writeFileSync(`/work/out/${file.name}`, file.bytes);
  const parts = files.filter(file => file.part !== "/ppt/slideLayouts/slideLayout1.xml").map(file => ({ part: file.part, sha256: file.sha256, file: { vfsPath: file.name } }));
  volume.writeFileSync("/work/out/manifest.json", JSON.stringify({ parts }));
  const incomplete = await shell.exec("pptx pack --manifest out/manifest.json --output deck.pptx --force --json");
  assert.equal(incomplete.exitCode, 1, incomplete.stdout + incomplete.stderr);
  assert.equal(JSON.parse(incomplete.stdout).data, null);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
  parts[0]!.part = "/../outside.xml";
  volume.writeFileSync("/work/out/manifest.json", JSON.stringify({ parts }));
  const unsafe = await shell.exec("pptx pack --manifest out/manifest.json --output deck.pptx --force --json");
  assert.notEqual(unsafe.exitCode, 0, unsafe.stdout + unsafe.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
  assert.equal(volume.readFileSync("/work/out/keep.txt", "utf8"), "untouched");
});


test("package tools roundtrip all explicit relative manifest files through the shell", async () => {
  const { input, shell, volume } = await setup();
  const extracted = await shell.exec("pptx extract deck.pptx --output-dir out --allow-partial-output --json");
  assert.equal(extracted.exitCode, 0, extracted.stdout + extracted.stderr);
  const outputs = JSON.parse(extracted.stdout).data.outputs;
  volume.writeFileSync("/work/out/manifest.json", JSON.stringify({ parts: outputs.map((file: {part: string; sha256: string; name: string}) => ({ part: file.part, sha256: file.sha256, file: { vfsPath: file.name } })) }));
  const packed = await shell.exec("pptx pack --manifest out/manifest.json --output rebuilt.pptx --json");
  assert.equal(packed.exitCode, 0, packed.stdout + packed.stderr);
  const bytes = new Uint8Array(volume.readFileSync("/work/rebuilt.pptx") as Buffer);
  assert.deepEqual(inspectZip(bytes).map(file => [file.name, file.payload]), inspectZip(input).map(file => [file.name, file.payload]));
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
  assert.equal(volume.readFileSync("/work/out/keep.txt", "utf8"), "untouched");
});
