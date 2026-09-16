import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import {
  createPptxCommandEngine,
  createPresentation,
  readAnimations,
  mutateAnimations
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


test("shape animation scripts publish SDK-equivalent edits and reject unsafe dependencies", async () => {
  const { shell, volume } = fixture();
  const input = await createPresentation({ slides: [{ shapes: [
    { name: "Badge", text: "Badge", x: 0, y: 0, width: 100, height: 100 }
  ] }] }, context);
  volume.writeFileSync("/work/input deck.pptx", input);
  const target = { slide: { coordinateSystem: "one-based" as const, value: 1 }, shape: "Badge" };
  volume.writeFileSync("/work/animate.sh",
    "pptx animations add 'input deck.pptx' --kind fade-in --trigger on-click --target '" + JSON.stringify({ slide: 1, shape: "Badge" }) + "' --duration 751 --delay 17 --output 'animated deck.pptx' --json\n" +
    "pptx animations get 'animated deck.pptx' --slide 1 --json");
  try {
    const output = await shell.exec("sh animate.sh");
    assert.equal(output.exitCode, 0, output.stderr);
    const bytes = new Uint8Array(volume.readFileSync("/work/animated deck.pptx") as Buffer);
    const sdk = await mutateAnimations(input, "add", { target, kind: "fade-in", trigger: "on-click", duration: 751, delay: 17 }, context);
    assert.deepEqual(bytes, sdk.bytes);
    const graph = await readAnimations(bytes, {}, context);
    assert.deepEqual(graph[0]!.targetShapeIds, ["2"]);
    assert.deepEqual(graph[0]!.diagnostics, []);
    const invalid = await shell.exec("pptx animations set 'animated deck.pptx' --slide 1 --duration 1s --in-place --json");
    assert.equal(invalid.exitCode, 2);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/animated deck.pptx") as Buffer), bytes);
    const removal = await shell.exec("pptx animations remove 'animated deck.pptx' --slide 1 --shape Badge --in-place --json");
    assert.equal(removal.exitCode, 0, removal.stderr);
    const empty = await readAnimations(new Uint8Array(volume.readFileSync("/work/animated deck.pptx") as Buffer), {}, context);
    assert.deepEqual(empty[0]!.targetShapeIds, []);
    assert.equal(empty[0]!.nodes.some(node => node.effectType !== null), false);
    volume.writeFileSync("/work/operations.json", JSON.stringify({ version: 1, operations: [
      { operation: "animations.add", arguments: { kind: "pulse", trigger: "on-click", target: { slide: 1, shape: "Badge" } } },
      { operation: "animations.set", arguments: { delay: 21 }, options: { slide: 1, shape: "Badge" } }
    ] }));
    const batched = await shell.exec("pptx batch 'animated deck.pptx' --ops-file operations.json --in-place --json");
    assert.equal(batched.exitCode, 0, batched.stderr);
    assert.equal(JSON.parse(batched.stdout).affected, 2);
    assert.deepEqual(JSON.parse(batched.stdout).data.results.map((entry: { operation: string }) => entry.operation), ["animations.add", "animations.set"]);
    assert.equal(JSON.parse(batched.stdout).data.outputs.length, 1);
  } finally { await shell.dispose(); }
});
