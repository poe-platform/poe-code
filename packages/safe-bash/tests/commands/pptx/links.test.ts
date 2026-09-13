import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { createPresentation, createPptxCommandEngine, setLink, listLinks } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());
function fixture() {
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
    const value = await fs.stat(path);
    return volume.lstatSync(path).isSymbolicLink() ? { ...value, type: "symlink" } : value;
  };
  fs.access = async (path, mode) => {
    try {
      volume.accessSync(path, mode);
    } catch (error) {
      throw new FsError((error as FsError).code);
    }
  };
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
    if (options?.maxBytes !== undefined && bytes.length > options.maxBytes)
      throw new FsError("EFBIG");
    return bytes;
  };
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
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
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 65536 })
    })
  );
  return { volume, shell };
}

test("links preserve quoted relative URL bytes through a virtual script and SDK", async () => {
  const { volume, shell } = fixture();
  const input = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Read more", x: 0, y: 0, width: 100, height: 100, text: "Details" }] },
        {}
      ]
    },
    context
  );
  volume.writeFileSync("/work/input deck.pptx", input);
  volume.writeFileSync(
    "/work/links.sh",
    "pptx links set 'input deck.pptx' --slide 1 --shape 'Read more' --url '../guide.html?q=two&lang=pl#entry' --output 'linked deck.pptx' --json\npptx links get 'linked deck.pptx' --json"
  );
  try {
    const result = await shell.exec("sh links.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(lines[0].operation, "links.set");
    assert.equal(lines[0].affected, 1);
    assert.equal(lines[1].data.links[0].url, "../guide.html?q=two&lang=pl#entry");
    const bytes = new Uint8Array(volume.readFileSync("/work/linked deck.pptx") as Buffer);
    const sdk = await setLink(
      input,
      {
        selection: {
          kind: "object",
          scope: "slides",
          owner: "/ppt/slides/slide1.xml",
          name: "Read more"
        },
        url: "../guide.html?q=two&lang=pl#entry"
      },
      context
    );
    assert.deepEqual(bytes, sdk);
    assert.equal((await listLinks(bytes, {}, context))[0]!.requiresSanitization, false);
  } finally {
    await shell.dispose();
  }
});
test("navigation flags, dry run and mutation failures preserve virtual bytes", async () => {
  const { volume, shell } = fixture();
  const input = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Next", x: 0, y: 0, width: 100, height: 100, text: "Continue" }] },
        {}
      ]
    },
    context
  );
  volume.writeFileSync("/work/deck.pptx", input);
  try {
    const dry = await shell.exec(
      "pptx links set deck.pptx --slide 1 --shape Next --target-slide 2 --dry-run --json"
    );
    assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
    assert.equal(JSON.parse(dry.stdout).affected, 1);
    for (const [flags, status] of [
      ["--target-slide 3", 1],
      ["--url https://example.test --action next", 2],
      ["--action macro", 2]
    ] as const) {
      const failed = await shell.exec(
        `pptx links set deck.pptx --slide 1 --shape Next ${flags} --output rejected.pptx --json`
      );
      assert.equal(failed.exitCode, status, failed.stdout + failed.stderr);
      assert.equal(JSON.parse(failed.stdout).affected, 0);
      assert.equal(volume.existsSync("/work/rejected.pptx"), false);
    }
    const added = await shell.exec(
      "pptx links add deck.pptx --slide 1 --shape Next --action next --in-place --json"
    );
    assert.equal(added.exitCode, 0, added.stdout + added.stderr);
    const removed = await shell.exec(
      "pptx links remove deck.pptx --slide 1 --shape Next --in-place --json"
    );
    assert.equal(removed.exitCode, 0, removed.stdout + removed.stderr);
    assert.deepEqual(
      await listLinks(
        new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer),
        {},
        context
      ),
      []
    );
  } finally {
    await shell.dispose();
  }
});
