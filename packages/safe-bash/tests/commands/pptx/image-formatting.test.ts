import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { addImage, createPresentation, createPptxCommandEngine, readImages } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
const pixel = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
]);
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

test("pptx picture formatting publishes through a virtual script and preserves media bytes", async () => {
  let original = await createPresentation({ slides: [{}] }, context);
  for (let i = 0; i < 2; i++)
    original = await addImage(
      original,
      { slide: 1, bytes: pixel, contentType: "image/gif", altText: "Harbor" },
      context
    );
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/deck.pptx", original);
  volume.writeFileSync(
    "/work/format.sh",
    "pptx images set deck.pptx --slide 1 --image 1 --crop-left -0.4 --crop-right 1.2 --rotation 45 --flip-horizontal true --opacity 0.625 --border-color 336699 --border-width 2pt --alt-text 'Harbor & tide' --output changed.pptx --json"
  );
  const fs = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async (path) => {
    try {
      const s = volume.statSync(path);
      return {
        type: s.isDirectory() ? "directory" : "file",
        size: Number(s.size),
        mode: Number(s.mode),
        atimeMs: Number(s.atimeMs),
        mtimeMs: Number(s.mtimeMs),
        ctimeMs: Number(s.ctimeMs),
        identityScope,
        dev: Number(s.dev),
        ino: Number(s.ino),
        revision: Number(s.mtimeMs),
        nlink: Number(s.nlink)
      };
    } catch (error) {
      throw new FsError((error as FsError).code);
    }
  };
  fs.lstat = fs.stat;
  fs.access = async (path, mode) => {
    try {
      volume.accessSync(path, mode);
    } catch (error) {
      throw new FsError((error as FsError).code);
    }
  };
  fs.readFile = async (path) => new Uint8Array(volume.readFileSync(path) as Buffer);
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? await fs.stat(path) : null;
    if (current?.ino !== options.expected?.ino || current?.revision !== options.expected?.revision)
      throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({ context, maxArgumentBytes: 8192, maxOutputBytes: 262144 })
    })
  );
  const result = await shell.exec("sh format.sh");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).affected, 1);
  const images = await readImages(
    new Uint8Array(volume.readFileSync("/work/changed.pptx") as Buffer),
    {},
    context
  );
  assert.equal(images.occurrences[0]!.altText, "Harbor & tide");
  assert.equal(images.occurrences[1]!.altText, "Harbor");
  assert.equal(images.occurrences[0]!.sha256, images.occurrences[1]!.sha256);
  assert.deepEqual(images.occurrences[0]!.crop, { left: -0.4, right: 1.2, top: 0, bottom: 0 });
  assert.deepEqual(images.occurrences[1]!.crop, { left: 0, right: 0, top: 0, bottom: 0 });
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
  const rejected = await shell.exec(
    "pptx images set deck.pptx --slide 1 --image 1 --crop-left 0.75 --crop-right 0.25 --output rejected.pptx --json"
  );
  assert.equal(rejected.exitCode, 2);
  assert.equal(volume.existsSync("/work/rejected.pptx"), false);
  const dry = await shell.exec(
    "pptx images set deck.pptx --slide 1 --image 1 --opacity 0 --dry-run --json"
  );
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.equal(JSON.parse(dry.stdout).data.dryRun, true);
});
