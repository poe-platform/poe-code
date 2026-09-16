import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { createPresentation, createPptxCommandEngine, readAccessibility } from "pptx";
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
    const stat = await fs.stat(path);
    return volume.lstatSync(path).isSymbolicLink() ? { ...stat, type: "symlink" } : stat;
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
      engine: createPptxCommandEngine({ context, maxOutputBytes: 262144, maxArgumentBytes: 65536 })
    })
  );
  return { volume, shell };
}
test("accessibility metadata survives quoted virtual script edits and SDK inspection", async () => {
  const { volume, shell } = fixture();
  volume.writeFileSync(
    "/work/input deck.pptx",
    await createPresentation(
      {
        slides: [
          {
            shapes: [
              { name: "Garden view", x: 0, y: 0, width: 100, height: 100, text: "Courtyard" }
            ]
          }
        ]
      },
      context
    )
  );
  volume.writeFileSync(
    "/work/accessibility.sh",
    "pptx accessibility set 'input deck.pptx' --slide 1 --shape 'Garden view' --alt-text 'Two benches & a fountain' --title 'Garden at noon' --decorative false --output 'accessible deck.pptx' --json\npptx accessibility get 'accessible deck.pptx' --json"
  );
  try {
    const result = await shell.exec("sh accessibility.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const [updated, listed] = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(updated.operation, "accessibility.set");
    assert.equal(updated.affected, 1);
    assert.equal(listed.data.objects[0].description, "Two benches & a fountain");
    assert.equal(listed.data.objects[0].decorative, false);
    const report = await readAccessibility(
      new Uint8Array(volume.readFileSync("/work/accessible deck.pptx") as Buffer),
      {},
      context
    );
    assert.equal(report.objects[0]!.title, "Garden at noon");
    assert.equal(report.objects[0]!.altText, "Two benches & a fountain");
    assert.equal(report.order, "structural");
    assert.deepEqual(
      report.objects.map((object) => object.structuralOrder),
      [1]
    );
  } finally {
    await shell.dispose();
  }
});
test("accessibility rejects invalid intent and preserves input during dry run", async () => {
  const { volume, shell } = fixture();
  const original = await createPresentation(
    {
      slides: [{ shapes: [{ name: "Frame", x: 0, y: 0, width: 100, height: 100, text: "Border" }] }]
    },
    context
  );
  volume.writeFileSync("/work/deck.pptx", original);
  try {
    const dry = await shell.exec(
      "pptx accessibility set deck.pptx --all --decorative true --dry-run --json"
    );
    assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
    assert.equal(JSON.parse(dry.stdout).affected, 1);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
    for (const flags of [
      "--decorative yes --slide 1",
      "--title title",
      "--slide 1",
      "--description text --slide 1"
    ]) {
      const rejected = await shell.exec(
        `pptx accessibility set deck.pptx ${flags} --output rejected.pptx --json`
      );
      assert.equal(rejected.exitCode, 2, rejected.stdout + rejected.stderr);
      assert.equal(volume.existsSync("/work/rejected.pptx"), false);
    }
    const missing = await shell.exec(
      "pptx accessibility get deck.pptx --slide 1 --shape Missing --json"
    );
    assert.equal(missing.exitCode, 1, missing.stdout + missing.stderr);
    const help = await shell.exec("pptx accessibility --help");
    assert.equal(help.exitCode, 0);
    assert.ok(help.stdout.includes("structural"));
    const schema = await shell.exec("pptx schema accessibility set --json");
    assert.equal(schema.exitCode, 0, schema.stdout + schema.stderr);
    assert.equal(
      JSON.parse(schema.stdout).data.operations["accessibility.set"].options.properties.decorative
        .type,
      "boolean"
    );
  } finally {
    await shell.dispose();
  }
});
