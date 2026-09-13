import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Volume } from "memfs";
import {
  addSlide,
  createPptxCommandEngine,
  createPresentation,
  mutateSlides,
  readSelectionIndex
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
      engine: createPptxCommandEngine({ context, maxOutputBytes: 262144, maxArgumentBytes: 65536 })
    })
  );
  return { shell, fs, volume };
}

test("pptx creation publishes into explicit memfs and matches the SDK package", async () => {
  const { shell, volume } = fixture();
  const slides = [
    {
      name: "Rain",
      shapes: [
        { name: "Caption", x: 1000, y: 2000, width: 3000000, height: 400000, text: "Rain & river" }
      ]
    }
  ];
  const result = await shell.exec(
    `pptx create --kind ppsx --width 10in --slides-json '${JSON.stringify(slides)}' --output 'field show.ppsx' --json`
  );
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  const bytes = new Uint8Array(volume.readFileSync("/work/field show.ppsx") as Buffer);
  assert.deepEqual(
    bytes,
    await createPresentation({ kind: "ppsx", width: 9144000, slides }, context)
  );
  assert.deepEqual(JSON.parse(result.stdout).data.outputs, [
    {
      path: "field show.ppsx",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }
  ]);
  const inspect = await shell.exec(
    "pptx inspect 'field show.ppsx' --slide 1 --shape Caption --json"
  );
  assert.equal(inspect.exitCode, 0, inspect.stdout + inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).data.records[0].name, "Caption");
});

for (const mode of ["existing", "dry-run", "unsupported", "race", "symlink"] as const) {
  test(`pptx creation protects the destination during ${mode}`, async () => {
    const { shell, fs, volume } = fixture();
    volume.writeFileSync("/work/deck.pptx", "existing bytes");
    if (mode === "unsupported")
      fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileMutation: false });
    if (mode === "race")
      fs.writeFileConditional = async () => {
        throw new FsError("EAGAIN");
      };
    if (mode === "symlink") volume.symlinkSync("/work/deck.pptx", "/work/link.pptx");
    const destination = mode === "symlink" ? "link.pptx" : "deck.pptx";
    const result = await shell.exec(
      `pptx create --output ${destination} ${mode === "existing" ? "" : "--force"} ${mode === "dry-run" ? "--dry-run" : ""} --json`
    );
    assert.equal(
      result.exitCode,
      mode === "dry-run" ? 0 : mode === "unsupported" || mode === "race" ? 1 : 3,
      result.stdout + result.stderr
    );
    assert.equal(volume.readFileSync("/work/deck.pptx", "utf8"), "existing bytes");
    if (mode === "dry-run") assert.deepEqual(JSON.parse(result.stdout).data.outputs, []);
  });
}

test("pptx creation force replaces only the explicit destination and streams clean package bytes", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", "old");
  volume.writeFileSync("/work/keep.txt", "keep");
  const published = await shell.exec("pptx create --output deck.pptx --force --json");
  assert.equal(published.exitCode, 0, published.stdout + published.stderr);
  const piped = await shell.exec("pptx create --output - | pptx inspect - --json");
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.equal(piped.stderr, "");
  assert.deepEqual(JSON.parse(piped.stdout).data.inventory.counts, {
    slides: 0,
    masters: 1,
    layouts: 1,
    themes: 1,
    slideShapes: 0,
    parts: 6,
    media: 0
  });
  assert.equal(volume.readFileSync("/work/keep.txt", "utf8"), "keep");
});

for (const position of [1, 2, 3]) {
  test(`pptx slides add publishes at boundary ${position} through the same SDK behavior`, async () => {
    const { shell, volume } = fixture();
    const original = await createPresentation(
      { slides: [{ name: "Start" }, { name: "End" }] },
      context
    );
    volume.writeFileSync("/work/source deck.pptx", original);
    const result = await shell.exec(
      `pptx slides add 'source deck.pptx' --layout Blank --position ${position} --name 'River survey' --output 'new deck.pptx' --json`
    );
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).operation, "slides.add");
    const output = new Uint8Array(volume.readFileSync("/work/new deck.pptx") as Buffer);
    assert.deepEqual(
      output,
      await addSlide(original, { layout: "Blank", position, name: "River survey" }, context)
    );
    const names = (await readSelectionIndex(output, context)).slides.map((slide) => slide.name);
    const expected = ["Start", "End"];
    expected.splice(position - 1, 0, "River survey");
    assert.deepEqual(names, expected);
    assert.deepEqual(
      new Uint8Array(volume.readFileSync("/work/source deck.pptx") as Buffer),
      original
    );
  });
}

test("pptx slides add supports in-place editing, dry runs and binary pipelines", async () => {
  const { shell, volume } = fixture();
  const original = await createPresentation({}, context);
  volume.writeFileSync("/work/deck.pptx", original);
  const dry = await shell.exec(
    "pptx slides add deck.pptx --layout Blank --in-place --dry-run --json"
  );
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).data.outputs, []);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
  const changed = await shell.exec(
    "pptx slides add deck.pptx --layout Blank --name 'First slide' --in-place --json"
  );
  assert.equal(changed.exitCode, 0, changed.stdout + changed.stderr);
  const piped = await shell.exec(
    "pptx slides add deck.pptx --layout Blank --name Second --output - | pptx inspect - --json"
  );
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.equal(piped.stderr, "");
  assert.deepEqual(
    JSON.parse(piped.stdout).data.records.map((record: { name: string }) => record.name),
    ["First slide", "Second"]
  );
});

test("pptx slides add rejects missing placeholders and out-of-range positions without publication", async () => {
  for (const options of ["--position 2", "--title 'No matching heading'", "--layout Missing"]) {
    const { shell, volume } = fixture();
    const original = await createPresentation({}, context);
    volume.writeFileSync("/work/deck.pptx", original);
    const result = await shell.exec(
      `pptx slides add deck.pptx ${options.startsWith("--layout") ? "" : "--layout Blank"} ${options} --output out.pptx --json`
    );
    assert.equal(
      result.exitCode,
      options.startsWith("--position") ? 2 : 1,
      result.stdout + result.stderr
    );
    assert.equal(volume.existsSync("/work/out.pptx"), false);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
  }
});

test("pptx slide mutations preserve identity through ordered JSON selection and shell publication", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/slides.pptx",
    await createPresentation(
      { slides: [{ name: "Same" }, { name: "Second" }, { name: "Same" }, { name: "Fourth" }] },
      context
    )
  );
  const source = new Uint8Array(volume.readFileSync("/work/slides.pptx") as Buffer);
  const selection = [
    { kind: "slide", position: { coordinateSystem: "one-based", value: 4 } },
    { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } }
  ] as const;
  const move = await shell.exec(
    `pptx slides move slides.pptx --selection-json '${JSON.stringify(selection)}' --position 1 --in-place --json`
  );
  assert.equal(move.exitCode, 0, move.stdout + move.stderr);
  assert.equal(JSON.parse(move.stdout).affected, 2);
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/slides.pptx") as Buffer),
    await mutateSlides(source, { selection, position: 1 }, context)
  );
  const listed = await shell.exec("pptx inspect slides.pptx --json");
  assert.equal(listed.exitCode, 0, listed.stdout + listed.stderr);
  assert.deepEqual(
    JSON.parse(listed.stdout).data.records.map((record: { id: string; name: string }) => [
      record.id,
      record.name
    ]),
    [
      ["259", "Fourth"],
      ["257", "Second"],
      ["256", "Same"],
      ["258", "Same"]
    ]
  );
  const set = await shell.exec(
    "pptx slides set slides.pptx --slide 1 --name Same --hidden true --in-place --json"
  );
  assert.equal(set.exitCode, 0, set.stdout + set.stderr);
  const shown = await shell.exec("pptx inspect slides.pptx --json");
  assert.equal(shown.exitCode, 0, shown.stdout + shown.stderr);
  assert.deepEqual(
    JSON.parse(shown.stdout).data.records.map((record: { id: string }) => record.id),
    ["259", "257", "256", "258"]
  );
  assert.equal(JSON.parse(shown.stdout).data.inventory.slides[0].show.effective, false);
  const show = await shell.exec(
    "pptx slides set slides.pptx --slide 1 --hidden false --output - | pptx inspect - --json"
  );
  assert.equal(show.exitCode, 0, show.stdout + show.stderr);
  assert.equal(JSON.parse(show.stdout).data.inventory.slides[0].show.effective, true);
});
