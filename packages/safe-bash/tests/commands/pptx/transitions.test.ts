import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import {
  createPptxCommandEngine,
  createPresentation,
  readTransitions,
  mutateTransitions
} from "pptx";
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

test("slide transition scripts preserve integer timing through the public SDK", async () => {
  const { shell, volume } = fixture();
  const input = await createPresentation({ slides: [{}] }, context);
  volume.writeFileSync("/work/input deck.pptx", input);
  volume.writeFileSync(
    "/work/transitions.sh",
    "pptx transitions add 'input deck.pptx' --slide 1 --kind push --direction down --duration 1251 --advance-after 0 --advance-on-click false --output 'timed deck.pptx' --json\npptx transitions get 'timed deck.pptx' --slide 1 --json"
  );
  try {
    const output = await shell.exec("sh transitions.sh");
    assert.equal(output.exitCode, 0, output.stderr);
    const item = JSON.parse(output.stdout.trim().split("\n").at(-1)!).data.items[0];
    assert.equal(item.kind, "push");
    assert.deepEqual(
      item.fields.map((field: { value: { value: unknown } }) => field.value.value),
      ["down", 1251, 0, false]
    );
    const bytes = new Uint8Array(volume.readFileSync("/work/timed deck.pptx") as Buffer);
    const sdk = await mutateTransitions(
      input,
      "add",
      {
        selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
        kind: "push",
        direction: "down",
        duration: 1251,
        advanceAfter: 0,
        advanceOnClick: false
      },
      context
    );
    assert.deepEqual(bytes, sdk.bytes);
    const updated = await shell.exec(
      "pptx transitions set 'timed deck.pptx' --slide 1 --advance-after null --advance-on-click true --in-place --json"
    );
    assert.equal(updated.exitCode, 0, updated.stderr);
    const records = await readTransitions(
      new Uint8Array(volume.readFileSync("/work/timed deck.pptx") as Buffer),
      {},
      context
    );
    assert.deepEqual(
      [records[0]!.duration, records[0]!.advanceAfter, records[0]!.advanceOnClick],
      [1251, null, true]
    );
    const rejected = await shell.exec(
      "pptx transitions set 'timed deck.pptx' --slide 1 --duration 1s --in-place --json"
    );
    assert.equal(rejected.exitCode, 2);
    const removed = await shell.exec(
      "pptx transitions remove 'timed deck.pptx' --slide 1 --in-place --json"
    );
    assert.equal(removed.exitCode, 0, removed.stderr);
    const empty = await shell.exec("pptx transitions get 'timed deck.pptx' --slide 1 --json");
    assert.deepEqual(JSON.parse(empty.stdout).data.items, []);
  } finally {
    await shell.dispose();
  }
});
