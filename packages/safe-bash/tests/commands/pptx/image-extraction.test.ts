import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { addImage, createPresentation, createPptxCommandEngine } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: {maxBytes: 262144, maxReads: 1000, chunkBytes: 4096},
  archiveLimits: {maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096},
  xmlLimits: {maxBytes: 65536, maxNodes: 4000, maxDepth: 32},
  relationshipLimits: {maxBytes: 65536, maxParts: 64, maxRelationships: 64}
};
const pixel = new Uint8Array([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

async function setup() {
  let original = await createPresentation({slides: [{}]}, context);
  for (let i = 0; i < 2; i++) original = await addImage(original, {slide: 1, bytes: pixel, contentType: "image/gif"}, context);
  const volume = Volume.fromJSON({"/work": null, "/work/extracted art": null});
  volume.writeFileSync("/work/deck.pptx", original);
  const fs = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async path => {
    try {
      const s = volume.statSync(path);
      return {type: s.isDirectory() ? "directory" : "file", size: Number(s.size), mode: Number(s.mode), atimeMs: Number(s.atimeMs), mtimeMs: Number(s.mtimeMs), ctimeMs: Number(s.ctimeMs), identityScope, dev: Number(s.dev), ino: Number(s.ino), revision: Number(s.mtimeMs), nlink: Number(s.nlink)};
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.lstat = fs.stat;
  fs.access = async (path, mode) => { try { volume.accessSync(path, mode); } catch (error) { throw new FsError((error as FsError).code); } };
  fs.readFile = async path => new Uint8Array(volume.readFileSync(path) as Buffer);
  fs.readStream = async function* (path, options) { options?.signal?.throwIfAborted(); yield new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? await fs.stat(path) : null;
    if (current?.ino !== options.expected?.ino || current?.revision !== options.expected?.revision) throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  const shell = new Shell({fs, cwd: "/work"}).use(pptxCommands({engine: createPptxCommandEngine({context, maxArgumentBytes: 8192, maxOutputBytes: 262144})}));
  return { shell, volume, fs, original };
}
const command = "pptx images extract deck.pptx --output-dir 'extracted art' --allow-partial-output --json";

test("pptx extraction publishes duplicate image occurrences through a quoted virtual script", async () => {
  const {shell, volume, original} = await setup();
  volume.writeFileSync("/work/extract.sh", command);
  const result = await shell.exec("sh extract.sh");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).affected, 2);
  assert.deepEqual(volume.readdirSync("/work/extracted art"), ["part-000001.gif", "part-000002.gif"]);
  for (const name of volume.readdirSync("/work/extracted art")) assert.deepEqual(new Uint8Array(volume.readFileSync(`/work/extracted art/${name}`) as Buffer), pixel);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
});

test("pptx extraction preflights every collision without publishing earlier files or deleting existing files", async () => {
  const {shell, volume} = await setup();
  const sentinel = new Uint8Array([1, 4, 9]);
  volume.writeFileSync("/work/extracted art/part-000002.gif", sentinel);
  volume.writeFileSync("/work/extracted art/keep.txt", "keep");
  const result = await shell.exec(command);
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).data, null);
  assert.equal(volume.existsSync("/work/extracted art/part-000001.gif"), false);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/extracted art/part-000002.gif") as Buffer), sentinel);
  const force = await shell.exec(command + " --force");
  assert.equal(force.exitCode, 0, force.stdout + force.stderr);
  assert.equal(volume.readFileSync("/work/extracted art/keep.txt", "utf8"), "keep");
});

test("pptx extraction refuses input aliases even with force and requires publication opt-in", async () => {
  const {shell, volume, original} = await setup();
  const unsupported = await shell.exec("pptx images extract deck.pptx --output-dir 'extracted art' --json");
  assert.equal(unsupported.exitCode, 3, unsupported.stdout + unsupported.stderr);
  assert.equal(JSON.parse(unsupported.stdout).errors[0].code, "publication-unsupported");
  volume.linkSync("/work/deck.pptx", "/work/extracted art/part-000002.gif");
  const result = await shell.exec(command + " --force");
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  assert.equal(volume.existsSync("/work/extracted art/part-000001.gif"), false);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
});

test("pptx extraction preserves exact partial publication reporting on adapter write failures", async () => {
  const {shell, volume, fs} = await setup();
  const publish = fs.writeFileConditional!;
  fs.writeFileConditional = async (path, bytes, options) => {
    if (path.endsWith("000002.gif")) throw new FsError("EACCES");
    return publish(path, bytes, options);
  };
  const result = await shell.exec(command);
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.affected, 1);
  assert.deepEqual(envelope.data.outputs.map((item: {path: string}) => item.path), ["extracted art/part-000001.gif"]);
  assert.deepEqual(volume.readdirSync("/work/extracted art"), ["part-000001.gif"]);
});
