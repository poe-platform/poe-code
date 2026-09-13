import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, createPresentation, readComments } from "pptx";
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

test("legacy comment shell script and SDK share author identity, positions and text", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/review deck.pptx",
    await createPresentation({ slides: [{ name: "Coast" }] }, context)
  );
  volume.writeFileSync(
    "/work/review.sh",
    "pptx comments add 'review deck.pptx' --slide 1 --author 'River Stone' --initials RS --timestamp 2026-09-13T12:00:00Z --text '明日 🐚' --left 2pt --top 3pt --in-place --json\npptx comments list 'review deck.pptx' --json"
  );
  try {
    const result = await shell.exec("sh review.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const envelopes = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(envelopes[0].affected, 1);
    const record = envelopes[1].data.comments[0];
    assert.equal(record.author, "River Stone");
    assert.equal(record.initials, "RS");
    assert.equal(record.left, 25400);
    assert.equal(record.top, 38100);
    const sdk = await readComments(
      new Uint8Array(volume.readFileSync("/work/review deck.pptx") as Buffer),
      {},
      context
    );
    assert.deepEqual(sdk, envelopes[1].data.comments);
    const updated = await shell.exec(
      `pptx comments set 'review deck.pptx' --slide 1 --id '${record.id}' --text Ready --in-place --json`
    );
    assert.equal(updated.exitCode, 0, updated.stdout + updated.stderr);
    const read = await shell.exec(
      `pptx comments get 'review deck.pptx' --slide 1 --id '${record.id}' --json`
    );
    assert.equal(JSON.parse(read.stdout).data.comments[0].text, "Ready");
    const schema = await shell.exec("pptx schema comments get --json");
    assert.equal(
      compileJsonSchema(JSON.parse(schema.stdout).data.operations["comments.get"].result).validate(
        JSON.parse(read.stdout)
      ).ok,
      true
    );
    const removed = await shell.exec(
      `pptx comments remove 'review deck.pptx' --slide 1 --id '${record.id}' --in-place --json`
    );
    assert.equal(removed.exitCode, 0, removed.stdout + removed.stderr);
    const empty = await shell.exec("pptx comments list 'review deck.pptx' --json");
    assert.deepEqual(JSON.parse(empty.stdout).data.comments, []);
  } finally {
    await shell.dispose();
  }
});

test("comment publication failures and previews preserve virtual input", async () => {
  const { shell, volume } = fixture();
  const original = await createPresentation({ slides: [{}] }, context);
  volume.writeFileSync("/work/deck.pptx", original);
  try {
    for (const [flags, exit] of [
      ["--slide 1 --author River --timestamp 2026-09-13T12:00:00Z --text Preview --dry-run", 0],
      ["--slide 1 --author River --text Missing --in-place", 2],
      ["--slide 1 --author River --timestamp yesterday --text Invalid --in-place", 2],
      [
        "--slide 1 --author River --timestamp 2026-09-13T12:00:00Z --text Conflict --in-place --output other.pptx",
        2
      ]
    ] as const) {
      const result = await shell.exec(`pptx comments add deck.pptx ${flags} --json`);
      assert.equal(result.exitCode, exit, result.stdout + result.stderr);
      assert.deepEqual(volume.readFileSync("/work/deck.pptx"), Buffer.from(original));
    }
  } finally {
    await shell.dispose();
  }
});
