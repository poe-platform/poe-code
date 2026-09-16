import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, readCharts, type ChartRecord } from "pptx";
import { compileJsonSchema } from "toolcraft-schema";
import { createDeckFixture } from "../../../../pptx/tests/fixtures/decks.js";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 131072, maxReads: 1000, chunkBytes: 8192 },
  archiveLimits: {
    maxArchiveBytes: 131072,
    maxEntryBytes: 32768,
    maxTotalBytes: 131072,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 32768,
    chunkSize: 8192
  },
  xmlLimits: { maxBytes: 32768, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 32768, maxParts: 64, maxRelationships: 64 }
};
function setup(twoCharts = false) {
  const fixture = createDeckFixture("seed-library");
  if (twoCharts) {
    const path = `${fixture.root}/ppt/slides/slide1.xml`;
    const document = parseXmlPart(
      new Uint8Array(fixture.volume.readFileSync(path) as Buffer),
      context.xmlLimits
    );
    const tree = document.root.children
      .find((node) => node.name.localName === "cSld")!
      .children.find((node) => node.name.localName === "spTree")!;
    const frame = tree.children.filter((node) => node.name.localName === "graphicFrame").at(-1)!;
    const copy = parseXmlPart(
      new TextEncoder().encode(document.markup(frame, true)),
      context.xmlLimits
    );
    const identity = copy.root.children
      .find((node) => node.name.localName === "nvGraphicFramePr")!
      .children.find((node) => node.name.localName === "cNvPr")!;
    const changed = copy.merge(identity, {
      attributes: [{ namespace: "", localName: "id", value: "19" }]
    });
    fixture.volume.writeFileSync(
      path,
      document
        .spliceChildren(tree, tree.children.length, 0, [changed.markup(changed.root, true)])
        .bytes()
    );
  }
  const bytes = storedArchive(
    Object.entries(fixture.volume.toJSON())
      .filter(([, value]) => value !== null)
      .map(([path]) => ({
        name: path.slice(fixture.root.length + 1),
        bytes: new Uint8Array(fixture.volume.readFileSync(path) as Buffer)
      }))
  );
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/seed deck.pptx", bytes);
  const reads: string[] = [];
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    reads.push(path);
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({ context, maxArgumentBytes: 8192, maxOutputBytes: 131072 })
    })
  );
  return { bytes, volume, reads, shell };
}

test("pptx charts list and get expose original literal series through SDK and shell", async () => {
  const { bytes, volume, reads, shell } = setup();
  const sdk = await readCharts(bytes, { slide: 1, shape: "Activity chart" }, context);
  assert.equal(sdk.length, 1);
  assert.equal(sdk[0]!.shapeId, "7");
  assert.equal(sdk[0]!.plots[0]!.type, "barChart");
  assert.equal(sdk[0]!.plots[0]!.series[0]!.name, "Packets shared");
  assert.deepEqual(sdk[0]!.plots[0]!.series[0]!.categories!.points, [
    { index: "0", value: "Beans" },
    { index: "1", value: "Peas" }
  ]);
  assert.deepEqual(sdk[0]!.plots[0]!.series[0]!.values!.points, [
    { index: "0", value: "12" },
    { index: "1", value: "8" }
  ]);
  assert.equal(sdk[0]!.plots[0]!.series[0]!.values!.authority, "literal");
  assert.equal(sdk[0]!.plots[0]!.series[0]!.values!.cached, false);
  assert.deepEqual(
    sdk[0]!.axes.map((axis) => [axis.type, axis.id, axis.crossAxisId]),
    [
      ["catAx", "10", "20"],
      ["valAx", "20", "10"]
    ]
  );
  for (const action of ["list", "get"]) {
    const schema = await shell.exec(`pptx schema charts ${action} --json`);
    assert.equal(schema.exitCode, 0, schema.stdout + schema.stderr);
    const validator = compileJsonSchema(
      JSON.parse(schema.stdout).data.operations[`charts.${action}`].result
    );
    const result = await shell.exec(
      `pptx charts ${action} 'seed deck.pptx' --slide 1 --shape 'Activity chart' --json`
    );
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout);
    assert.equal(
      validator.validate(envelope).ok,
      true,
      JSON.stringify(validator.validate(envelope))
    );
    const malformed = structuredClone(envelope);
    malformed.data.charts[0].plots[0].series[0].values.cached = "true";
    assert.equal(validator.validate(malformed).ok, false);
    const extra = structuredClone(envelope);
    extra.data.charts[0].axes[0].invented = 1;
    assert.equal(validator.validate(extra).ok, false);
    assert.equal(envelope.operation, `charts.${action}`);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.errors, []);
    assert.deepEqual(envelope.data.charts, sdk);
    assert.deepEqual(envelope.locations, [sdk[0]!.location]);
  }
  assert.deepEqual(reads, ["/work/seed deck.pptx", "/work/seed deck.pptx"]);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/seed deck.pptx") as Buffer), bytes);
});

test("pptx charts retain opaque selection, successful empty lists and missing get status", async () => {
  const { shell } = setup();
  const listed = await shell.exec("pptx charts list 'seed deck.pptx' --json");
  assert.equal(listed.exitCode, 0, listed.stdout + listed.stderr);
  const chart = JSON.parse(listed.stdout).data.charts[0] as ChartRecord;
  const selected = await shell.exec(
    `pptx charts get 'seed deck.pptx' --select '${chart.token}' --json`
  );
  assert.equal(selected.exitCode, 0, selected.stdout + selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout).data.charts, [chart]);
  const empty = await shell.exec("pptx charts list 'seed deck.pptx' --shape absent --json");
  assert.equal(empty.exitCode, 0, empty.stdout + empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).data.charts, []);
  const missing = await shell.exec("pptx charts get 'seed deck.pptx' --shape absent --json");
  assert.equal(missing.exitCode, 1, missing.stdout + missing.stderr);
  assert.equal(JSON.parse(missing.stdout).errors[0].code, "missing-selection");
  const human = await shell.exec("pptx charts list 'seed deck.pptx'");
  assert.equal(human.exitCode, 0, human.stdout + human.stderr);
  assert.ok(human.stdout.includes("Packets shared"));
  assert.ok(human.stdout.includes("literal"));
  assert.ok(human.stdout.includes("Activity chart"));
  assert.ok(human.stdout.includes("/ppt/slides/slide1.xml"));
  assert.ok(human.stdout.includes("barChart"));
  assert.ok(human.stdout.includes("catAx"));
  assert.ok(human.stdout.includes("Style: not explicit"));
  assert.ok(human.stdout.includes("Links: 0"));
  assert.ok(human.stdout.includes("Unsupported: 0"));
  assert.equal(human.stdout.includes("<c:chartSpace"), false);
  assert.equal(human.stdout.includes('"xml":'), false);
  assert.ok(human.stdout.length < 2000, `Summary has ${human.stdout.length} characters`);
});

test("pptx chart inspection rejects invalid flags before VFS access", async () => {
  const { shell, reads } = setup();
  for (const flags of [
    "--scope notes",
    "--all",
    "--output changed.pptx",
    "--shape Name --select token",
    "--slide 0"
  ]) {
    const result = await shell.exec(`pptx charts list 'seed deck.pptx' ${flags} --json`);
    assert.equal(result.exitCode, 2, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).operation, "charts.list");
  }
  assert.deepEqual(reads, []);
});

test("pptx chart reads enforce lower trusted input and output limits", async () => {
  const { shell, volume, bytes } = setup();
  for (const limit of ["maxBytes=512", "maxOutputBytes=512"]) {
    const result = await shell.exec(`pptx charts list 'seed deck.pptx' --limit ${limit} --json`);
    assert.equal(result.exitCode, 4, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).errors[0].code, "resource-limit");
  }
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/seed deck.pptx") as Buffer), bytes);
});

test("pptx charts get reports every candidate when a read is ambiguous", async () => {
  const { shell } = setup(true);
  const listed = await shell.exec("pptx charts list 'seed deck.pptx' --json");
  assert.equal(listed.exitCode, 0, listed.stdout + listed.stderr);
  assert.deepEqual(
    JSON.parse(listed.stdout).data.charts.map((chart: ChartRecord) => chart.shapeId),
    ["7", "19"]
  );
  const result = await shell.exec("pptx charts get 'seed deck.pptx' --json");
  assert.equal(result.exitCode, 1, result.stdout + result.stderr);
  const error = JSON.parse(result.stdout).errors[0];
  assert.equal(error.code, "ambiguous-selection");
  assert.deepEqual(error.context.candidates, JSON.parse(listed.stdout).locations);
});
