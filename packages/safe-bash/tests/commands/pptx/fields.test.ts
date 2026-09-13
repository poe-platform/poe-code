import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, createPresentation, readFields } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
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
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());
function fixture(engineContext = context) {
  const volume = Volume.fromJSON({ "/work": null });
  const fs: FileSystem = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async (path) => {
    try {
      const entry = volume.statSync(path);
      return {
        type: entry.isDirectory() ? "directory" : "file",
        size: Number(entry.size),
        mode: Number(entry.mode),
        atimeMs: Number(entry.atimeMs),
        mtimeMs: Number(entry.mtimeMs),
        ctimeMs: Number(entry.ctimeMs),
        identityScope,
        dev: Number(entry.dev),
        ino: Number(entry.ino),
        revision: Number(entry.mtimeMs),
        nlink: Number(entry.nlink)
      };
    } catch (error) {
      throw new FsError((error as FsError).code);
    }
  };
  fs.lstat = async (path) => {
    const observed = await fs.stat(path);
    return volume.lstatSync(path).isSymbolicLink() ? { ...observed, type: "symlink" } : observed;
  };
  fs.access = async (path, mode) => {
    try {
      volume.accessSync(path, mode);
    } catch (error) {
      throw new FsError((error as FsError).code);
    }
  };
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? await fs.lstat(path) : null;
    if (
      current?.ino !== options.expected?.ino ||
      current?.size !== options.expected?.size ||
      current?.revision !== options.expected?.revision
    )
      throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
    if (options?.maxBytes !== undefined && bytes.length > options.maxBytes)
      throw new FsError("EFBIG");
    return bytes;
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({
        context: engineContext,
        maxOutputBytes: 262144,
        maxArgumentBytes: 65536
      })
    })
  );
  return { shell, fs, volume };
}

test("field caches round trip through a registered shell script and SDK", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/deck.pptx",
    await createPresentation(
      {
        slides: [{ shapes: [{ name: "Date", x: 0, y: 0, width: 20, height: 20, text: "Label " }] }]
      },
      context
    )
  );
  volume.writeFileSync(
    "/work/fields.sh",
    `pptx fields add deck.pptx --slide 1 --shape Date --kind date --update explicit --text '明日 é 🐚' --timestamp 2026-09-13T12:00:00Z --output dated.pptx --json
pptx fields set dated.pptx --all --update preserve --in-place --json
pptx fields get dated.pptx --json`
  );
  const result = await shell.exec("sh fields.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout.trim().split("\n").at(-1)!).data.items[0].fields.find(
      (field: { name: string }) => field.name === "cachedText"
    ).value.value,
    "明日 é 🐚"
  );
  assert.equal(
    (
      await readFields(
        new Uint8Array(volume.readFileSync("/work/dated.pptx") as Buffer),
        {},
        context
      )
    )[0]!.cachedText,
    "明日 é 🐚"
  );
  const invalid = await shell.exec(
    "pptx fields set dated.pptx --all --update explicit --text 'Later' --dry-run --json"
  );
  assert.equal(invalid.exitCode, 2);
  const removed = await shell.exec("pptx fields remove dated.pptx --all --in-place --json");
  assert.equal(removed.exitCode, 0, removed.stderr);
  assert.deepEqual(
    await readFields(
      new Uint8Array(volume.readFileSync("/work/dated.pptx") as Buffer),
      {},
      context
    ),
    []
  );
});
