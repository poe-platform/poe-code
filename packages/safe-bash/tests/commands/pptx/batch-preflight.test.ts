import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import {
  createPptxCommandEngine,
  createPresentation,
  readAnimations,
  readShapes
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

const add = {
  operation: "animations.add",
  arguments: { kind: "pulse", trigger: "on-click", target: { slide: 1, shape: "Beacon" } }
};

async function originalDeck() {
  return createPresentation({ slides: [{ shapes: [
    { name: "Beacon", text: "Harbor", x: 20, y: 30, width: 100, height: 80 }
  ] }] }, context);
}

test("batch validates a later malformed target before acquiring document bytes", async () => {
  const { shell, fs, volume } = fixture();
  const reads = mock.fn(fs.readFile);
  const streams = mock.fn(fs.readStream);
  fs.readFile = reads;
  fs.readStream = streams;
  const operations = { version: 1, operations: [add, {
    ...add, arguments: { ...add.arguments, target: "malformed" }
  }] };
  try {
    const result = await shell.exec(`pptx batch absent.pptx --ops-json '${JSON.stringify(operations)}' --dry-run --json`);
    assert.equal(result.exitCode, 2, result.stdout + result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.affected, 0);
    assert.equal(body.data, null);
    assert.equal(reads.mock.callCount(), 0);
    assert.equal(streams.mock.callCount(), 0);
    assert.deepEqual(volume.readdirSync("/work"), []);
  } finally { await shell.dispose(); }
});

test("batch semantic failure after an admitted edit preserves both destinations", async () => {
  const { shell, fs, volume } = fixture();
  const input = await originalDeck();
  const sentinel = new Uint8Array([13, 21, 34]);
  volume.writeFileSync("/work/deck.pptx", input);
  volume.writeFileSync("/work/existing.pptx", sentinel);
  const writes = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = writes;
  const operations = { version: 1, operations: [add, {
    operation: "animations.remove", arguments: {}, options: { slide: 1, shape: "Absent" }
  }] };
  try {
    for (const destination of ["--in-place", "--output existing.pptx --force"]) {
      const result = await shell.exec(`pptx batch deck.pptx --ops-json '${JSON.stringify(operations)}' ${destination} --json`);
      assert.equal(result.exitCode, 1, result.stdout + result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.ok, false);
      assert.equal(body.data, null);
      assert.equal(body.affected, 0);
      assert.equal(body.errors[0].code, "missing-selection");
      assert.equal(writes.mock.callCount(), 0);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/work/existing.pptx") as Buffer), sentinel);
    }
  } finally { await shell.dispose(); }
});

test("batch rejects a foreign snapshot token without publishing earlier edits", async () => {
  const { shell, fs, volume } = fixture();
  const input = await originalDeck();
  const foreign = await createPresentation({ slides: [{ shapes: [
    { name: "Beacon", text: "Inlet", x: 20, y: 30, width: 100, height: 80 }
  ] }] }, context);
  const location = (await readShapes(foreign, {}, context))[0]!.location;
  volume.writeFileSync("/work/deck.pptx", input);
  const writes = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = writes;
  const operations = { version: 1, operations: [add, {
    operation: "animations.set", arguments: { delay: 17 }, options: { select: location }
  }] };
  try {
    const result = await shell.exec(`pptx batch deck.pptx --ops-json '${JSON.stringify(operations)}' --in-place --json`);
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.errors[0].code, "stale-selection");
    assert.equal(body.affected, 0);
    assert.equal(body.data, null);
    assert.equal(writes.mock.callCount(), 0);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
  } finally { await shell.dispose(); }
});

test("batch cancellation during input acquisition preserves the original reason and files", async () => {
  const { shell, fs, volume } = fixture();
  const input = await originalDeck();
  const sentinel = new Uint8Array([55, 89]);
  volume.writeFileSync("/work/deck.pptx", input);
  volume.writeFileSync("/work/existing.pptx", sentinel);
  const controller = new AbortController();
  const reason = new Error("Stopped by caller");
  const writes = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = writes;
  fs.readStream = async function* () {
    yield input.slice(0, 64);
    controller.abort(reason);
    controller.signal.throwIfAborted();
  };
  const operations = { version: 1, operations: [add] };
  try {
    await assert.rejects(shell.exec(
      `pptx batch deck.pptx --ops-json '${JSON.stringify(operations)}' --output existing.pptx --force --json`,
      { signal: controller.signal }
    ), error => error === reason);
    assert.equal(writes.mock.callCount(), 0);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/existing.pptx") as Buffer), sentinel);
  } finally { await shell.dispose(); }
});

test("batch previews ordered effects deterministically and publishes one consistent package", async () => {
  const { shell, fs, volume } = fixture();
  const input = await originalDeck();
  volume.writeFileSync("/work/deck.pptx", input);
  const writes = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = writes;
  const operations = { version: 1, operations: [add, {
    operation: "animations.set", arguments: { delay: 17 }, options: { slide: 1, shape: "Beacon" }
  }] };
  const command = `pptx batch deck.pptx --ops-json '${JSON.stringify(operations)}'`;
  try {
    const first = await shell.exec(`${command} --dry-run --json`);
    const second = await shell.exec(`${command} --dry-run --json`);
    assert.equal(first.exitCode, 0, first.stdout + first.stderr);
    assert.equal(second.exitCode, 0, second.stdout + second.stderr);
    assert.equal(second.stdout, first.stdout);
    const preview = JSON.parse(first.stdout);
    assert.equal(preview.affected, 2);
    assert.deepEqual(preview.data.outputs, []);
    assert.deepEqual(preview.data.results.map((entry: { operation: string }) => entry.operation), ["animations.add", "animations.set"]);
    assert.deepEqual(preview.data.results.flatMap((entry: { data: { effects: { action: string }[] } }) => entry.data.effects.map(effect => effect.action)), ["add", "set"]);
    assert.equal(writes.mock.callCount(), 0);
    for (const path of ["first.pptx", "second.pptx"]) {
      const applied = await shell.exec(`${command} --output ${path} --json`);
      assert.equal(applied.exitCode, 0, applied.stdout + applied.stderr);
    }
    assert.equal(writes.mock.callCount(), 2);
    const bytes = new Uint8Array(volume.readFileSync("/work/first.pptx") as Buffer);
    assert.deepEqual(bytes, new Uint8Array(volume.readFileSync("/work/second.pptx") as Buffer));
    const graph = await readAnimations(bytes, {}, context);
    assert.deepEqual(graph[0]!.targetShapeIds, ["2"]);
    assert.deepEqual(graph[0]!.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
  } finally { await shell.dispose(); }
});
