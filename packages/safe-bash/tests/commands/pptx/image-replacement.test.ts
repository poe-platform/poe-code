import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { addImage, createPresentation, createPptxCommandEngine, readImages } from "pptx";
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

test("pptx replacement publishes through a quoted virtual script and protects the image source", async () => {
  let original = await createPresentation({slides: [{}]}, context);
  for (let i = 0; i < 2; i++) original = await addImage(original, {slide: 1, bytes: pixel, contentType: "image/gif", altText: "Harbor"}, context);
  const volume = Volume.fromJSON({"/work": null});
  volume.writeFileSync("/work/deck.pptx", original);
  const changed = pixel.slice();
  changed[13] = 128;
  volume.writeFileSync("/work/new art.gif", changed);
  volume.writeFileSync("/work/replace.sh", "pptx images replace deck.pptx --slide 1 --image 1 --file 'new art.gif' --alt-text 'Harbor & tide' --output changed.pptx --json");
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
  const result = await shell.exec("sh replace.sh");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).affected, 1);
  const images = await readImages(new Uint8Array(volume.readFileSync("/work/changed.pptx") as Buffer), {}, context);
  assert.equal(images.occurrences[0]!.altText, "Harbor & tide");
  assert.equal(images.occurrences[1]!.altText, "Harbor");
  assert.notEqual(images.occurrences[0]!.sha256, images.occurrences[1]!.sha256);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
  const overwrite = await shell.exec("pptx images replace deck.pptx --slide 1 --image 1 --file 'new art.gif' --output 'new art.gif' --force --json");
  assert.notEqual(overwrite.exitCode, 0);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/new art.gif") as Buffer), changed);
  const sentinel = new Uint8Array([9, 2, 6]);
  volume.writeFileSync("/work/cancelled.pptx", sentinel);
  const controller = new AbortController();
  const reason = new Error("Cancel before destination publication");
  const originalLstat = fs.lstat;
  let destinationObserved = false;
  fs.lstat = async (path, options) => {
    if (path === "/work/cancelled.pptx") {
      destinationObserved = true;
      controller.abort(reason);
      options?.signal?.throwIfAborted();
    }
    return originalLstat(path, options);
  };
  await assert.rejects(shell.exec("pptx images replace deck.pptx --slide 1 --image 1 --file 'new art.gif' --output cancelled.pptx --force --json", {signal: controller.signal}), error => error === reason);
  assert.equal(destinationObserved, true);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/cancelled.pptx") as Buffer), sentinel);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
});
