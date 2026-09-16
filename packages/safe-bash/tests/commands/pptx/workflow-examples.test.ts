import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import {
  addTable,
  createPresentation,
  createPptxCommandEngine,
  mutateTables,
  mutateTextFrames,
  readTables
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

function slideTags(bytes: Uint8Array) {
  const entry = inspectZip(bytes).find((part) => part.name === "ppt/slides/slide1.xml")!;
  const tags: { name: string; uri: string; attributes: Record<string, string> }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.uri !== "http://schemas.openxmlformats.org/drawingml/2006/main") return;
    tags.push({
      name: tag.local,
      uri: tag.uri,
      attributes: Object.fromEntries(
        Object.values(tag.attributes)
          .filter((attribute) => attribute.uri === "")
          .map((attribute) => [attribute.local, attribute.value])
      )
    });
  });
  parser.write(new TextDecoder().decode(entry.payload)).close();
  return tags;
}

for (const [flag, property, xmlAttribute] of [
  ["first-col", "firstCol", "firstCol"],
  ["first-row", "firstRow", "firstRow"],
  ["last-col", "lastCol", "lastCol"],
  ["last-row", "lastRow", "lastRow"],
  ["horz-band", "horzBand", "bandRow"],
  ["vert-band", "vertBand", "bandCol"]
] as const) {
  test(`table ${flag} workflow independently persists enabled and disabled values`, async () => {
    const { shell, volume } = fixture();
    const initial = await addTable(
      await createPresentation({ slides: [{}] }, context),
      {
        slide: 1,
        update: {
          rows: 2,
          columns: 2,
          left: { value: 0, unit: "emu" },
          top: { value: 0, unit: "emu" },
          width: { value: 900, unit: "emu" },
          height: { value: 600, unit: "emu" },
          data: [
            ["Fern", "Moss"],
            ["Reed", "Rush"]
          ]
        }
      },
      context
    );
    volume.writeFileSync("/work/garden deck.pptx", initial.bytes);
    try {
      let previous = initial.bytes;
      for (const enabled of [true, false]) {
        const result = await shell.exec(
          `pptx tables set 'garden deck.pptx' --slide 1 --table 1 --${flag} ${enabled} --in-place --json`
        );
        assert.equal(result.exitCode, 0, result.stdout + result.stderr);
        assert.deepEqual(
          [JSON.parse(result.stdout).operation, JSON.parse(result.stdout).affected],
          ["tables.set", 1]
        );
        const bytes = new Uint8Array(volume.readFileSync("/work/garden deck.pptx") as Buffer);
        const expected = await mutateTables(
          previous,
          { slide: 1, table: 1, update: { [property]: enabled } },
          context
        );
        assert.deepEqual(bytes, expected.bytes);
        assert.equal(
          slideTags(bytes).find((tag) => tag.name === "tblPr")!.attributes[xmlAttribute],
          enabled ? "1" : "0"
        );
        const table = (await readTables(bytes, { slide: 1, table: 1 }, context))[0]!;
        assert.equal(table[property], enabled);
        assert.deepEqual(table.data, [
          ["Fern", "Moss"],
          ["Reed", "Rush"]
        ]);
        assert.equal(table.cells.length, 4);
        previous = bytes;
      }
    } finally {
      await shell.dispose();
    }
  });
}

test("table column width workflow keeps neighboring cells and updates frame extent", async () => {
  const { shell, volume } = fixture();
  const initial = await addTable(
    await createPresentation({ slides: [{}] }, context),
    {
      slide: 1,
      update: {
        rows: 3,
        columns: 3,
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 900, unit: "emu" },
        height: { value: 600, unit: "emu" },
        data: [
          ["Ash", "Birch", "Cedar"],
          ["Elm", "Fir", "Hazel"],
          ["Larch", "Oak", "Pine"]
        ]
      }
    },
    context
  );
  volume.writeFileSync("/work/woodland.pptx", initial.bytes);
  volume.writeFileSync(
    "/work/resize.sh",
    "pptx tables set woodland.pptx --slide 1 --table 1 --cell 2,2 --column-width 1.5in --in-place --json\npptx tables list woodland.pptx --slide 1 --table 1 --json"
  );
  try {
    const result = await shell.exec("sh resize.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const output = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      output.map((item) => [item.operation, item.affected]),
      [
        ["tables.set", 1],
        ["tables.list", 0]
      ]
    );
    const bytes = new Uint8Array(volume.readFileSync("/work/woodland.pptx") as Buffer);
    const expected = await mutateTables(
      initial.bytes,
      { slide: 1, table: 1, cell: "2,2", update: { columnWidth: { value: 1.5, unit: "in" } } },
      context
    );
    assert.deepEqual(bytes, expected.bytes);
    const tags = slideTags(bytes);
    assert.deepEqual(
      tags.filter((tag) => tag.name === "gridCol").map((tag) => tag.attributes.w),
      ["300", "1371600", "300"]
    );
    assert.deepEqual(
      tags.filter((tag) => tag.name === "tr").map((tag) => tag.attributes.h),
      ["200", "200", "200"]
    );
    assert.ok(
      tags.some(
        (tag) =>
          tag.name === "ext" && tag.attributes.cx === "1372200" && tag.attributes.cy === "600"
      )
    );
    const record = output[1].data.records[0];
    assert.equal(record.cells.length, 9);
    assert.deepEqual(record.columnWidths, [300, 1371600, 300]);
    assert.deepEqual(record.data, [
      ["Ash", "Birch", "Cedar"],
      ["Elm", "Fir", "Hazel"],
      ["Larch", "Oak", "Pine"]
    ]);
  } finally {
    await shell.dispose();
  }
});

test("unsupported table batch reports a usage error without publication", async () => {
  const { shell, fs, volume } = fixture();
  const initial = await createPresentation({ slides: [{}] }, context);
  volume.writeFileSync("/work/styles.pptx", initial);
  const writes = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = writes;
  const operations = {
    version: 1,
    operations: [
      { operation: "tables.set", arguments: { firstRow: true }, options: { slide: 1, table: 1 } }
    ]
  };
  try {
    const result = await shell.exec(
      `pptx batch styles.pptx --ops-json '${JSON.stringify(operations)}' --in-place --json`
    );
    assert.equal(result.exitCode, 2);
    const body = JSON.parse(result.stdout);
    assert.deepEqual(
      [body.operation, body.ok, body.data, body.affected],
      ["batch", false, null, 0]
    );
    assert.equal(body.errors[0].code, "invalid-value");
    assert.equal(body.errors[0].message, "Batch supports animation add, set and remove only.");
    assert.equal(writes.mock.callCount(), 0);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/styles.pptx") as Buffer), initial);
  } finally {
    await shell.dispose();
  }
});

for (const [autofit, expectedTag] of [
  [null, null],
  ["none", "noAutofit"],
  ["shape", "spAutoFit"],
  ["text", "normAutofit"]
] as const) {
  test(`text frame autofit ${autofit} workflow stores one explicit fitting mode`, async () => {
    const { shell, volume } = fixture();
    const initial = await createPresentation(
      {
        slides: [
          {
            shapes: [{ name: "Botany", text: "Pressed leaves", x: 0, y: 0, width: 200, height: 80 }]
          }
        ]
      },
      context
    );
    volume.writeFileSync("/work/frame.pptx", initial);
    try {
      const result = await shell.exec(
        `pptx text frames set frame.pptx --slide 1 --shape Botany --autofit ${autofit} --in-place --json`
      );
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      const bytes = new Uint8Array(volume.readFileSync("/work/frame.pptx") as Buffer);
      const expected = await mutateTextFrames(
        initial,
        {
          shape: "Botany",
          select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
          autofit
        },
        context
      );
      assert.deepEqual(bytes, expected.bytes);
      assert.deepEqual(
        slideTags(bytes)
          .filter((tag) => ["noAutofit", "spAutoFit", "normAutofit"].includes(tag.name))
          .map((tag) => tag.name),
        expectedTag ? [expectedTag] : []
      );
      const text = await shell.exec("pptx text frame.pptx");
      assert.equal(text.exitCode, 0, text.stderr);
      assert.equal(text.stdout.trim(), "Pressed leaves");
    } finally {
      await shell.dispose();
    }
  });
}

for (const [wrap, expectedValue] of [
  [true, "square"],
  [false, "none"],
  [null, undefined]
] as const) {
  test(`text frame wrap ${wrap} workflow preserves margin boundary conversions`, async () => {
    const { shell, volume } = fixture();
    const initial = await createPresentation(
      {
        slides: [
          {
            shapes: [{ name: "Seed list", text: "Meadow seed", x: 0, y: 0, width: 200, height: 80 }]
          }
        ]
      },
      context
    );
    volume.writeFileSync("/work/frame.pptx", initial);
    try {
      const result = await shell.exec(
        `pptx text frames set frame.pptx --slide 1 --shape 'Seed list' --wrap ${wrap} --margin-left 0.1in --margin-top 0.2in --margin-right 0.3in --margin-bottom 0.4in --in-place --json`
      );
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      const bytes = new Uint8Array(volume.readFileSync("/work/frame.pptx") as Buffer);
      const expected = await mutateTextFrames(
        initial,
        {
          shape: "Seed list",
          select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
          wrap,
          marginLeft: 7.2,
          marginTop: 14.4,
          marginRight: 21.6,
          marginBottom: 28.8
        },
        context
      );
      assert.deepEqual(bytes, expected.bytes);
      const body = slideTags(bytes).find((tag) => tag.name === "bodyPr")!;
      assert.deepEqual(
        [body.attributes.lIns, body.attributes.tIns, body.attributes.rIns, body.attributes.bIns],
        ["91440", "182880", "274320", "365760"]
      );
      assert.equal(body.attributes.wrap, expectedValue);
    } finally {
      await shell.dispose();
    }
  });
}

for (const text of ["bud", "x\ny\nz"]) {
  test(`text frame assignment replaces its paragraphs with ${text.length} text characters`, async () => {
    const { shell, volume } = fixture();
    const initial = await createPresentation(
      {
        slides: [
          {
            shapes: [
              { name: "Seed note", text: "Old seed\nOld leaf", x: 0, y: 0, width: 200, height: 80 }
            ]
          }
        ]
      },
      context
    );
    volume.writeFileSync("/work/frame.pptx", initial);
    try {
      const result = await shell.exec(
        `pptx text frames set frame.pptx --slide 1 --shape 'Seed note' --text '${text}' --in-place --json`
      );
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      const bytes = new Uint8Array(volume.readFileSync("/work/frame.pptx") as Buffer);
      const expected = await mutateTextFrames(
        initial,
        {
          shape: "Seed note",
          select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
          text
        },
        context
      );
      assert.deepEqual(bytes, expected.bytes);
      const output = await shell.exec("pptx text frame.pptx");
      assert.equal(output.exitCode, 0, output.stderr);
      assert.equal(output.stdout.trim(), text);
      assert.equal(
        slideTags(bytes).filter((tag) => tag.name === "p").length,
        text.split("\n").length
      );
      const entry = inspectZip(bytes).find((part) => part.name === "ppt/slides/slide1.xml")!;
      const texts: string[] = [];
      const parser = new SaxesParser({ xmlns: true });
      let inText = false;
      parser.on("opentag", (tag) => {
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
      parser.write(new TextDecoder().decode(entry.payload)).close();
      assert.deepEqual(texts, text.split("\n"));
    } finally {
      await shell.dispose();
    }
  });
}
