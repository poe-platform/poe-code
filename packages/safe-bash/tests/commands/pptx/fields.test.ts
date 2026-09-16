import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import {
  addConnector,
  addShape,
  readDrawing,
  createPptxCommandEngine,
  createPresentation,
  readFields,
  readConnectors,
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

test("connector commands round trip quoted paths through a shell script and SDK", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/input deck.pptx",
    await createPresentation({ slides: [{}] }, context)
  );
  volume.writeFileSync(
    "/work/connectors.sh",
    `pptx connectors add 'input deck.pptx' --slide 1 --kind ELBOW --begin-x 1in --begin-y 2in --end-x 3in --end-y 4in --output 'joined deck.pptx' --json
pptx connectors list 'joined deck.pptx' --json`
  );
  const result = await shell.exec("sh connectors.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim().split("\n").at(-1)!).data.records.length, 1);
  const records = await readConnectors(
    new Uint8Array(volume.readFileSync("/work/joined deck.pptx") as Buffer),
    {},
    context
  );
  assert.equal(records.length, 1);
  assert.deepEqual(
    [records[0]!.kind, records[0]!.beginX, records[0]!.beginY, records[0]!.endX, records[0]!.endY],
    [2, 914400, 1828800, 2743200, 3657600]
  );
  const sdk = await addConnector(
    new Uint8Array(volume.readFileSync("/work/input deck.pptx") as Buffer),
    {
      slide: 1,
      update: {
        kind: "ELBOW",
        beginX: { value: 1, unit: "in" },
        beginY: { value: 2, unit: "in" },
        endX: { value: 3, unit: "in" },
        endY: { value: 4, unit: "in" }
      }
    },
    context
  );
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/joined deck.pptx") as Buffer),
    sdk.bytes
  );
  const original = volume.readFileSync("/work/joined deck.pptx");
  const invalid = await shell.exec(
    "pptx connectors set 'joined deck.pptx' --all --site -1 --in-place --json"
  );
  assert.equal(invalid.exitCode, 2);
  assert.deepEqual(volume.readFileSync("/work/joined deck.pptx"), original);
});

test("connector target rebinding and deletion policy survive shell publication", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/deck.pptx",
    await createPresentation(
      {
        slides: [
          {
            shapes: [
              { name: "Left", x: 0, y: 0, width: 100, height: 100, text: "" },
              { name: "Right", x: 200, y: 0, width: 100, height: 100, text: "" }
            ]
          }
        ]
      },
      context
    )
  );
  const bytes = () => new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer);
  let targets = await readShapes(bytes(), {}, context);
  const add = await shell.exec(
    `pptx connectors add deck.pptx --slide 1 --kind STRAIGHT --begin-x 0emu --begin-y 0emu --end-x 400emu --end-y 400emu --begin-target '${JSON.stringify(targets[0]!.location)}' --site 0 --in-place --json`
  );
  assert.equal(add.exitCode, 0, add.stderr);
  targets = await readShapes(bytes(), {}, context);
  const connectors = await readConnectors(bytes(), {}, context);
  const rebound = await shell.exec(
    `pptx connectors set deck.pptx --select '${connectors[0]!.token}' --begin-target '${JSON.stringify(targets[1]!.location)}' --site 3 --in-place --json`
  );
  assert.equal(rebound.exitCode, 0, rebound.stderr);
  assert.deepEqual((await readConnectors(bytes(), {}, context))[0]!.beginTarget, {
    objectId: 3,
    site: 3
  });
  const original = bytes();
  const rejected = await shell.exec(
    "pptx shapes remove deck.pptx --slide 1 --shape Right --in-place --json"
  );
  assert.equal(rejected.exitCode, 1);
  assert.deepEqual(bytes(), original);
  const removed = await shell.exec(
    "pptx shapes remove deck.pptx --slide 1 --shape Right --detach-policy detach --in-place --json"
  );
  assert.equal(removed.exitCode, 0, removed.stderr);
  const detached = (await readConnectors(bytes(), {}, context))[0]!;
  assert.equal(detached.beginTarget, null);
  assert.deepEqual([detached.beginX, detached.beginY], [300, 50]);
  const deleted = await shell.exec(
    `pptx connectors remove deck.pptx --select '${detached.token}' --in-place --json`
  );
  assert.equal(deleted.exitCode, 0, deleted.stderr);
  assert.deepEqual(await readConnectors(bytes(), {}, context), []);
});

test("field caches round trip through a registered shell script and SDK", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/deck.pptx",
    await createPresentation(
      {
        slides: [{ shapes: [{ name: "Date", x: 0, y: 0, width: 20, height: 20, text: "Label " }] }]
      },
      context
    )
  );
  volume.writeFileSync(
    "/work/fields.sh",
    `pptx fields add deck.pptx --slide 1 --shape Date --kind date --update explicit --text '明日 é 🐚' --timestamp 2026-09-13T12:00:00Z --output dated.pptx --json
pptx fields set dated.pptx --all --update preserve --in-place --json
pptx fields get dated.pptx --json`
  );
  const result = await shell.exec("sh fields.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout.trim().split("\n").at(-1)!).data.items[0].fields.find(
      (field: { name: string }) => field.name === "cachedText"
    ).value.value,
    "明日 é 🐚"
  );
  assert.equal(
    (
      await readFields(
        new Uint8Array(volume.readFileSync("/work/dated.pptx") as Buffer),
        {},
        context
      )
    )[0]!.cachedText,
    "明日 é 🐚"
  );
  const invalid = await shell.exec(
    "pptx fields set dated.pptx --all --update explicit --text 'Later' --dry-run --json"
  );
  assert.equal(invalid.exitCode, 2);
  const removed = await shell.exec("pptx fields remove dated.pptx --all --in-place --json");
  assert.equal(removed.exitCode, 0, removed.stderr);
  assert.deepEqual(
    await readFields(
      new Uint8Array(volume.readFileSync("/work/dated.pptx") as Buffer),
      {},
      context
    ),
    []
  );
});

test("drawing commands preserve theme paint through a quoted virtual script and SDK", async () => {
  const { shell, volume } = fixture();
  const shape = await addShape(
    await createPresentation({ slides: [{}] }, context),
    {
      slide: 1,
      update: {
        kind: "RECTANGLE",
        name: "Panel",
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 100, unit: "emu" },
        height: { value: 100, unit: "emu" }
      }
    },
    context
  );
  volume.writeFileSync("/work/input deck.pptx", shape.bytes);
  volume.writeFileSync(
    "/work/paint.sh",
    `pptx shapes drawing set 'input deck.pptx' --slide 1 --shape Panel --fill-kind solid --color '{"theme":"accent3","opacity":0.5}' --output 'painted deck.pptx' --json
pptx shapes drawing get 'painted deck.pptx' --slide 1 --shape Panel --json`
  );
  const result = await shell.exec("sh paint.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  const record = JSON.parse(result.stdout.trim().split("\n").at(-1)!).data.records[0];
  assert.equal(record.drawing.fill.color.theme, "accent3");
  const sdk = await readDrawing(
    new Uint8Array(volume.readFileSync("/work/painted deck.pptx") as Buffer),
    { slide: 1, shape: "Panel" },
    context
  );
  assert.equal(sdk[0]!.drawing.fill.color?.opacity, 0.5);
  await shell.dispose();
});

test("drawing commands preserve mixed gradient colors, patterned lines and explicit inheritance", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/deck.pptx",
    await createPresentation(
      { slides: [{ shapes: [{ name: "Panel", x: 0, y: 0, width: 100, height: 100, text: "" }] }] },
      context
    )
  );
  const bytes = () => new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer);
  const gradient = {
    kind: "gradient",
    angle: -90,
    stops: [
      { position: 0, color: { theme: "accent4", opacity: 0 } },
      { position: 1, color: { rgb: "123456", opacity: 1 } }
    ]
  };
  const line = {
    width: { value: 2, unit: "pt" },
    dash: "dash",
    fill: {
      kind: "pattern",
      preset: "cross",
      foreground: { theme: "accent2", opacity: 0.5 },
      background: "ABCDEF"
    }
  };
  try {
    const painted = await shell.exec(
      `pptx shapes drawing set deck.pptx --slide 1 --shape Panel --fill '${JSON.stringify(gradient)}' --line '${JSON.stringify(line)}' --in-place --json`
    );
    assert.equal(painted.exitCode, 0, painted.stderr);
    const drawing = (await readDrawing(bytes(), { slide: 1, shape: "Panel" }, context))[0]!.drawing;
    assert.equal(drawing.fill.kind, "gradient");
    assert.equal(drawing.fill.angle, 270);
    assert.deepEqual(
      drawing.fill.stops?.map((stop) => [
        stop.position,
        stop.color?.theme,
        stop.color?.rgb,
        stop.color?.opacity
      ]),
      [
        [0, "accent4", null, 0],
        [1, null, "123456", 1]
      ]
    );
    assert.equal(drawing.line.width, 25400);
    assert.equal(drawing.line.dash, "dash");
    assert.equal(drawing.line.fill.kind, "pattern");
    assert.equal(drawing.line.fill.foreground?.theme, "accent2");
    assert.equal(drawing.line.fill.foreground?.opacity, 0.5);
    assert.equal(drawing.line.fill.background?.rgb, "ABCDEF");
    for (const kind of ["none", "inherit"]) {
      const changed = await shell.exec(
        `pptx shapes drawing set deck.pptx --slide 1 --shape Panel --fill-kind ${kind} --in-place --json`
      );
      assert.equal(changed.exitCode, 0, changed.stderr);
      assert.equal(
        (await readDrawing(bytes(), { slide: 1, shape: "Panel" }, context))[0]!.drawing.fill.kind,
        kind
      );
    }
    const shadow = await shell.exec(
      `pptx shapes effects set deck.pptx --slide 1 --shape Panel --shadow true --opacity 0.25 --shadow-blur 3pt --shadow-color '{"theme":"accent5"}' --in-place --json`
    );
    assert.equal(shadow.exitCode, 0, shadow.stderr);
    const inspected = await shell.exec(
      "pptx shapes drawing get deck.pptx --slide 1 --shape Panel --json"
    );
    assert.equal(inspected.exitCode, 0, inspected.stderr);
    const effect = JSON.parse(inspected.stdout).data.records[0].drawing.shadow;
    assert.deepEqual(
      [effect.blur, effect.distance, effect.color.theme, effect.opacity],
      [38100, 0, "accent5", 0.25]
    );
    for (const args of [
      `--fill '{"kind":"solid","color":{"rgb":"123456","theme":"accent1"}}'`,
      `--fill '{"kind":"solid","color":{"rgb":"123456","opacity":1.01}}'`,
      `--line '{"width":{"value":-1,"unit":"pt"}}'`
    ]) {
      const original = bytes();
      const rejected = await shell.exec(
        `pptx shapes drawing set deck.pptx --slide 1 --shape Panel ${args} --in-place --json`
      );
      assert.equal(rejected.exitCode, 2, rejected.stderr);
      assert.equal(JSON.parse(rejected.stdout).affected, 0);
      assert.deepEqual(bytes(), original);
    }
  } finally {
    await shell.dispose();
  }
});
