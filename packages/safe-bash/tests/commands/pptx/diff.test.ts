import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, createPresentation, comparePresentations } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, toByteSource, type FileSystem } from "../../../src/contracts/index.js";
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


test("comparison data and status survive quoted shell scripts and stdin", async () => {
  const { shell, volume } = fixture();
  const deck = (text: string) => createPresentation({ slides: [{ shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text }] }] }, context);
  const left = await deck("Harbor 雲");
  const right = await deck("Meadow 雲");
  volume.writeFileSync("/work/left deck.pptx", left);
  volume.writeFileSync("/work/right deck.pptx", right);
  volume.writeFileSync("/work/compare.sh", "pptx diff 'left deck.pptx' 'right deck.pptx' --mode text --json\n");
  try {
    const different = await shell.exec("sh compare.sh");
    assert.equal(different.exitCode, 1, different.stderr);
    const report = JSON.parse(different.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.data.equal, false);
    assert.equal(report.affected, 0);
    assert.deepEqual(report.data, await comparePresentations(left, right, { mode: "text" }, context));
    const equal = await shell.exec("pptx diff - 'left deck.pptx' --json", { stdin: toByteSource(left) });
    assert.equal(equal.exitCode, 0, equal.stderr);
    assert.equal(JSON.parse(equal.stdout).data.equal, true);
    const missing = await shell.exec("pptx diff missing.pptx 'left deck.pptx' --json");
    assert.equal(missing.exitCode, 2);
    assert.equal(JSON.parse(missing.stdout).errors[0].code, "io-failure");
    const stdin = await shell.exec("pptx diff - - --json");
    assert.equal(stdin.exitCode, 2);
    assert.equal(JSON.parse(stdin.stdout).ok, false);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/left deck.pptx") as Buffer), left);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/right deck.pptx") as Buffer), right);
  } finally { await shell.dispose(); }
});
