import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import {
  Presentation,
  Length,
  GraphicFrame,
  createPresentation,
  createPptxCommandEngine
} from "pptx";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
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
    label: "odd EMU remainder",
    box: [3, 4, 9, 7],
    flags: "--left 3emu --top 4emu --width 9emu --height 7emu",
    columns: [5, 4],
    rows: [4, 3]
  },
  {
    label: "inch geometry",
    box: [914400, 1828800, 2743200, 914400],
    flags: "--left 1in --top 2in --width 3in --height 1in",
    columns: [1371600, 1371600],
    rows: [457200, 457200]
  }
] as const) {
  test(`live table creation and CLI insertion preserve ${scenario.label}`, async () => {
    const { shell, volume } = fixture();
    const initial = await createPresentation(
      {
        slides: [
          {
            shapes: [
              { name: "Field heading", text: "Estuary survey", x: 0, y: 0, width: 20, height: 10 }
            ]
          }
        ]
      },
      context
    );
    volume.writeFileSync("/work/field deck.pptx", initial);
    const deck = await Presentation(initial, context);
    const slide = deck.slides[0]!;
    const frame = slide.shapes.add_table(
      2,
      2,
      new Length(scenario.box[0]),
      new Length(scenario.box[1]),
      new Length(scenario.box[2]),
      new Length(scenario.box[3])
    );
    assert.ok(frame instanceof GraphicFrame);
    assert.equal(frame.shape_id, 3);
    assert.equal(slide.shapes.length, 2);
    assert.equal(frame.has_table, true);
    assert.deepEqual(
      [frame.left?.emu, frame.top?.emu, frame.width?.emu, frame.height?.emu],
      scenario.box
    );
    assert.deepEqual(
      [...frame.table.rows].map((row) => row.height.emu),
      scenario.rows
    );
    assert.deepEqual(
      [...frame.table.columns].map((column) => column.width.emu),
      scenario.columns
    );
    assert.deepEqual(
      [...frame.table.iter_cells()].map((cell) => cell.text),
      ["", "", "", ""]
    );
    frame.table.cell(1, 1).text = "Salt marsh count";
    volume.writeFileSync("/work/model.pptx", await deck.save());
    volume.writeFileSync(
      "/work/table.sh",
      `pptx tables add 'field deck.pptx' --slide 1 --rows 2 --columns 2 ${scenario.flags} --data '[["",""],["","Salt marsh count"]]' --in-place --json\npptx tables list 'field deck.pptx' --slide 1 --table 1 --json`
    );
    try {
      const result = await shell.exec("sh table.sh");
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      const output = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        output.map((item) => [item.operation, item.affected]),
        [
          ["tables.add", 1],
          ["tables.list", 0]
        ]
      );
      assert.deepEqual(output[1].data.records[0].data, [
        ["", ""],
        ["", "Salt marsh count"]
      ]);
      for (const path of ["/work/model.pptx", "/work/field deck.pptx"]) {
        const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
        const slideXml = inspectZip(bytes).find((part) => part.name === "ppt/slides/slide1.xml")!;
        const tags: { uri: string; name: string; attrs: Record<string, string> }[] = [];
        const texts: string[] = [];
        let inText = false;
        const parser = new SaxesParser({ xmlns: true });
        parser.on("opentag", (tag) => {
          tags.push({
            uri: tag.uri,
            name: tag.local,
            attrs: Object.fromEntries(
              Object.values(tag.attributes)
                .filter((attribute) => attribute.uri === "")
                .map((attribute) => [attribute.local, attribute.value])
            )
          });
          if (
            tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main" &&
            tag.local === "t"
          )
            inText = true;
        });
        parser.on("text", (value) => {
          if (inText) texts.push(value);
        });
        parser.on("closetag", (tag) => {
          if (
            tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main" &&
            tag.local === "t"
          )
            inText = false;
        });
        parser.write(new TextDecoder().decode(slideXml.payload)).close();
        const drawing = tags.filter(
          (tag) => tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main"
        );
        assert.deepEqual(
          drawing.filter((tag) => tag.name === "gridCol").map((tag) => tag.attrs.w),
          scenario.columns.map(String)
        );
        assert.deepEqual(
          drawing.filter((tag) => tag.name === "tr").map((tag) => tag.attrs.h),
          scenario.rows.map(String)
        );
        assert.equal(drawing.filter((tag) => tag.name === "tc").length, 4);
        assert.ok(
          drawing.some(
            (tag) =>
              tag.name === "off" &&
              tag.attrs.x === String(scenario.box[0]) &&
              tag.attrs.y === String(scenario.box[1])
          )
        );
        assert.ok(
          drawing.some(
            (tag) =>
              tag.name === "ext" &&
              tag.attrs.cx === String(scenario.box[2]) &&
              tag.attrs.cy === String(scenario.box[3])
          )
        );
        assert.deepEqual(
          tags
            .filter(
              (tag) =>
                tag.uri === "http://schemas.openxmlformats.org/presentationml/2006/main" &&
                tag.name === "cNvPr"
            )
            .map((tag) => tag.attrs.id),
          ["1", "2", "3"]
        );
        assert.deepEqual(texts, ["Estuary survey", "Salt marsh count"]);
        const reopened = await Presentation(bytes, context);
        const savedFrame = reopened.slides[0]!.shapes[1] as GraphicFrame;
        assert.equal(savedFrame.shape_id, 3);
        assert.equal(savedFrame.has_table, true);
        assert.deepEqual(
          [...savedFrame.table.iter_cells()].map((cell) => cell.text),
          ["", "", "", "Salt marsh count"]
        );
      }
    } finally {
      await shell.dispose();
    }
  });
}
