import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import {
  addTable,
  mutateTables,
  createPresentation,
  createPptxCommandEngine,
  type TableUpdate
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

for (const scenario of [
  {
    label: "creation width below column count",
    action: "add",
    flags: "--rows 2 --columns 2 --left 0emu --top 0emu --width 1emu --height 2emu",
    update: {
      rows: 2,
      columns: 2,
      left: { value: 0, unit: "emu" },
      top: { value: 0, unit: "emu" },
      width: { value: 1, unit: "emu" },
      height: { value: 2, unit: "emu" }
    }
  },
  {
    label: "creation height below row count",
    action: "add",
    flags: "--rows 2 --columns 2 --left 0emu --top 0emu --width 2emu --height 1emu",
    update: {
      rows: 2,
      columns: 2,
      left: { value: 0, unit: "emu" },
      top: { value: 0, unit: "emu" },
      width: { value: 2, unit: "emu" },
      height: { value: 1, unit: "emu" }
    }
  },
  {
    label: "zero row height",
    action: "set",
    flags: "--table 1 --cell 1,1 --row-height 0emu",
    update: { rowHeight: { value: 0, unit: "emu" } }
  },
  {
    label: "zero column width",
    action: "set",
    flags: "--table 1 --cell 1,1 --column-width 0emu",
    update: { columnWidth: { value: 0, unit: "emu" } }
  },
  {
    label: "resized width below column count",
    action: "set",
    flags: "--table 1 --width 1emu",
    update: { width: { value: 1, unit: "emu" } }
  },
  {
    label: "resized height below row count",
    action: "set",
    flags: "--table 1 --height 1emu",
    update: { height: { value: 1, unit: "emu" } }
  }
] satisfies readonly { label: string; action: string; flags: string; update: TableUpdate }[]) {
  test(`table ${scenario.label} rejects without publishing`, async () => {
    const { shell, fs, volume } = fixture();
    const empty = await createPresentation({ slides: [{}] }, context);
    const initial =
      scenario.action === "add"
        ? empty
        : (
            await addTable(
              empty,
              {
                slide: 1,
                update: {
                  rows: 2,
                  columns: 2,
                  left: { value: 0, unit: "emu" },
                  top: { value: 0, unit: "emu" },
                  width: { value: 2, unit: "emu" },
                  height: { value: 2, unit: "emu" },
                  data: [
                    ["Spruce", "Alder"],
                    ["Willow", "Aspen"]
                  ]
                }
              },
              context
            )
          ).bytes;
    const unchanged = new Uint8Array(initial);
    volume.writeFileSync("/work/deck.pptx", initial);
    const sentinel = new Uint8Array([80, 75, 7, 8, 22]);
    volume.writeFileSync("/work/existing.pptx", sentinel);
    const writes = mock.fn(fs.writeFileConditional!);
    fs.writeFileConditional = writes;
    try {
      for (const destination of ["--in-place", "--output existing.pptx --force"]) {
        const result = await shell.exec(
          `pptx tables ${scenario.action} deck.pptx --slide 1 ${scenario.flags} ${destination} --json`
        );
        assert.equal(result.exitCode, 2, result.stdout + result.stderr);
        const body = JSON.parse(result.stdout);
        assert.deepEqual(
          [body.operation, body.ok, body.data, body.affected],
          [`tables.${scenario.action}`, false, null, 0]
        );
        assert.equal(body.errors[0].code, "invalid-value");
        assert.equal(writes.mock.callCount(), 0);
        assert.deepEqual(
          new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer),
          unchanged
        );
        assert.deepEqual(
          new Uint8Array(volume.readFileSync("/work/existing.pptx") as Buffer),
          sentinel
        );
      }
      await assert.rejects(
        scenario.action === "add"
          ? addTable(initial, { slide: 1, update: scenario.update }, context)
          : mutateTables(
              initial,
              {
                slide: 1,
                table: 1,
                ...(scenario.flags.includes("--cell") ? { cell: "1,1" } : {}),
                update: scenario.update
              },
              context
            ),
        { code: "invalid-value" }
      );
      assert.deepEqual(initial, unchanged);
    } finally {
      await shell.dispose();
    }
  });
}
