import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { compileJsonSchema } from "toolcraft-schema";
import { Volume } from "memfs";
import * as pptx from "pptx";
import { createPptxCommandEngine, createPresentation } from "pptx";
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
    delay === 0 ? queueMicrotask(callback) : timer(callback, delay)) as typeof setTimeout);
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

function repeat(
  records: readonly string[],
  mediaPolicy: "shared-media" | "isolated-instance" = "shared-media"
) {
  return {
    kind: "repeat" as const,
    slides: [4, 2],
    records: records.map((text) =>
      [4, 2].map((slide) => ({
        kind: "text" as const,
        name: "item",
        scope: "slides" as const,
        slide,
        cardinality: "one" as const,
        text
      }))
    ),
    mediaPolicy
  };
}

async function originalDeck() {
  return createPresentation(
    {
      slides: ["Opening", "Left {{item}}", "Middle", "Right {{item}}"].map((text) => ({
        shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text }]
      }))
    },
    context
  );
}

for (const mediaPolicy of ["shared-media", "isolated-instance"] as const) {
  for (const [label, values, expected] of [
    ["zero", [], ["Opening", "Middle"]],
    ["one", ["海 {literal}"], ["Opening", "Right 海 {literal}", "Left 海 {literal}", "Middle"]],
    [
      "many",
      ["Alpha", "Beta"],
      ["Opening", "Right Alpha", "Left Alpha", "Right Beta", "Left Beta", "Middle"]
    ]
  ] as const) {
    test(`repeat CLI replaces prototypes for ${label} records with ${mediaPolicy}`, async () => {
      const { shell, volume } = fixture();
      const input = await originalDeck();
      volume.writeFileSync("/work/deck.pptx", input);
      const data = repeat(values, mediaPolicy);
      try {
        const result = await shell.exec(
          `pptx template apply deck.pptx --data-json '${JSON.stringify(data)}' --output result.pptx --json`
        );
        assert.equal(result.exitCode, 0, result.stdout + result.stderr);
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, true);
        assert.equal(envelope.operation, "template.apply");
        assert.deepEqual(envelope.errors, []);
        assert.deepEqual(
          envelope.data.effects.map((effect: { action: string }) => effect.action),
          values.length === 0
            ? ["remove", "remove"]
            : [
                ...Array.from({ length: 2 * values.length }, () => "add"),
                ...Array.from({ length: 2 * values.length }, () => "replace")
              ]
        );
        const bytes = new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer);
        assert.deepEqual(bytes, (await pptx.applyTemplateRepeat(input, data, context)).bytes);
        const text = await pptx.readPresentationText(bytes, {}, context);
        assert.equal(text.text, expected.join("\n"));
        assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
        const repeated = await shell.exec(
          `pptx template apply deck.pptx --data-json '${JSON.stringify(data)}' --output again.pptx --json`
        );
        assert.equal(repeated.exitCode, 0, repeated.stdout + repeated.stderr);
        assert.deepEqual(new Uint8Array(volume.readFileSync("/work/again.pptx") as Buffer), bytes);
      } finally {
        await shell.dispose();
      }
    });
  }
}

test("repeat file input validates dry-run without publishing", async () => {
  const { shell, fs, volume } = fixture();
  const publication = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = publication;
  const input = await originalDeck();
  const data = JSON.stringify(repeat(["First", "Second"]));
  volume.writeFileSync("/work/deck.pptx", input);
  volume.writeFileSync("/work/records.json", data);
  try {
    const result = await shell.exec(
      "pptx template apply deck.pptx --data-file records.json --output result.pptx --dry-run --json"
    );
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.equal(publication.mock.callCount(), 0);
    assert.equal(volume.existsSync("/work/result.pptx"), false);
    assert.equal(volume.readFileSync("/work/records.json", "utf8"), data);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
    const applied = await shell.exec(
      "pptx template apply deck.pptx --data-file records.json --output result.pptx --json"
    );
    assert.equal(applied.exitCode, 0, applied.stdout + applied.stderr);
    assert.equal(publication.mock.callCount(), 1);
    assert.deepEqual(
      new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer),
      (await pptx.applyTemplateRepeat(input, repeat(["First", "Second"]), context)).bytes
    );
  } finally {
    await shell.dispose();
  }
});

test("repeat later invalid records preserve the source and existing destination atomically", async () => {
  const { shell, fs, volume } = fixture();
  const publication = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = publication;
  const input = await originalDeck();
  const sentinel = new Uint8Array([31, 41, 59]);
  volume.writeFileSync("/work/deck.pptx", input);
  volume.writeFileSync("/work/existing.pptx", sentinel);
  const valid = repeat(["Ready", "Later"]);
  try {
    for (const [record, exitCode, code] of [
      [{ ...valid.records[1]![0]!, name: "missing" }, 1, "missing-binding"],
      [{ ...valid.records[1]![0]!, text: { expression: "globalThis" } }, 2, "invalid-value"]
    ] as const) {
      const data = { ...valid, records: [valid.records[0], [record, valid.records[1]![1]]] };
      for (const destination of ["--output existing.pptx --force", "--in-place"]) {
        const result = await shell.exec(
          `pptx template apply deck.pptx --data-json '${JSON.stringify(data)}' ${destination} --json`
        );
        assert.equal(result.exitCode, exitCode, result.stdout + result.stderr);
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, false);
        assert.equal(envelope.affected, 0);
        assert.equal(envelope.data, null);
        assert.equal(envelope.errors[0].code, code);
        assert.equal(publication.mock.callCount(), 0);
        assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
        assert.deepEqual(
          new Uint8Array(volume.readFileSync("/work/existing.pptx") as Buffer),
          sentinel
        );
      }
    }
  } finally {
    await shell.dispose();
  }
});

test("repeat schema admits explicit policies and rejects ambiguous or executable records", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("pptx schema template apply --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const schema = JSON.parse(result.stdout).data.operations["template.apply"];
    const validator = compileJsonSchema(schema.bindings);
    for (const mediaPolicy of ["shared-media", "isolated-instance"] as const) {
      assert.equal(validator.validate(repeat([], mediaPolicy)).ok, true);
      assert.equal(validator.validate(repeat(["Ready"], mediaPolicy)).ok, true);
    }
    const valid = repeat(["Ready"]);
    for (const invalid of [
      { ...valid, mediaPolicy: "automatic" },
      { ...valid, slides: [] },
      { ...valid, slides: [0] },
      { ...valid, slides: [2, 2] },
      { ...valid, expression: "1 + 1" },
      { ...valid, records: [[{ ...valid.records[0]![0], text: { expression: "1 + 1" } }]] },
      Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "mediaPolicy"))
    ])
      assert.equal(validator.validate(invalid).ok, false);
    assert.equal(validator.validate(valid.records[0]).ok, true);
  } finally {
    await shell.dispose();
  }
});
