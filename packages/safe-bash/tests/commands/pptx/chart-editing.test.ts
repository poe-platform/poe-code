import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { createPresentation, createPptxCommandEngine, readCharts } from "pptx";
import { createDeckFixture } from "../../../../pptx/tests/fixtures/decks.js";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 524288, maxReads: 1000, chunkBytes: 8192 },
  archiveLimits: {
    maxArchiveBytes: 524288,
    maxEntryBytes: 131072,
    maxTotalBytes: 524288,
    maxMembers: 128,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 131072,
    chunkSize: 8192
  },
  xmlLimits: { maxBytes: 131072, maxNodes: 8000, maxDepth: 64 },
  relationshipLimits: { maxBytes: 131072, maxParts: 128, maxRelationships: 128 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});

function advancedDeck(unsafe = false) {
  const fixture = createDeckFixture("coastal-observatory");
  const c = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const cs = "http://schemas.microsoft.com/office/drawing/2012/chartStyle";
  const rels = "http://schemas.openxmlformats.org/package/2006/relationships";
  fixture.volume.writeFileSync(
    `${fixture.root}/ppt/charts/chart1.xml`,
    `<c:chartSpace xmlns:c="${c}" xmlns:r="${r}" xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart"><c:chart><c:plotArea><c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="4"/><c:order val="0"/><c:tx><c:v>Lantern readings</c:v></c:tx><c:trendline><c:trendlineType val="linear"/></c:trendline><c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="fixedVal"/><c:val val="2"/></c:errBars></c:ser></c:bar3DChart><c:lineChart><c:grouping val="standard"/><c:ser><c:idx val="9"/><c:order val="1"/></c:ser></c:lineChart></c:plotArea></c:chart><c:extLst><c:ext uri="urn:lantern:style"><c14:style val="102"/>${unsafe ? '<u:payload xmlns:u="urn:lantern:unknown" owner="7"/>' : ""}</c:ext></c:extLst></c:chartSpace>`
  );
  const manifestPath = `${fixture.root}/[Content_Types].xml`;
  const manifest = parseXmlPart(
    new Uint8Array(fixture.volume.readFileSync(manifestPath) as Buffer),
    context.xmlLimits
  );
  fixture.volume.writeFileSync(
    manifestPath,
    manifest
      .spliceChildren(manifest.root, manifest.root.children.length, 0, [
        '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/charts/style1.xml" ContentType="application/vnd.ms-office.chartstyle+xml"/>'
      ])
      .bytes()
  );
  fixture.volume.mkdirSync(`${fixture.root}/ppt/charts/_rels`, { recursive: true });
  fixture.volume.writeFileSync(
    `${fixture.root}/ppt/charts/_rels/chart1.xml.rels`,
    `<Relationships xmlns="${rels}"><Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style1.xml"/></Relationships>`
  );
  fixture.volume.writeFileSync(
    `${fixture.root}/ppt/charts/style1.xml`,
    `<cs:chartStyle xmlns:cs="${cs}" xmlns:a="${a}" xmlns:r="${r}" id="102"><a:blip r:embed="rId7"/></cs:chartStyle>`
  );
  fixture.volume.writeFileSync(
    `${fixture.root}/ppt/charts/_rels/style1.xml.rels`,
    `<Relationships xmlns="${rels}"><Relationship Id="rId7" Type="${r}/image" Target="../media/tile.bmp"/></Relationships>`
  );
  const parts = Object.entries(fixture.volume.toJSON())
    .filter(([, value]) => value !== null)
    .map(([path]) => ({
      name: path.slice(fixture.root.length + 1),
      bytes: new Uint8Array(fixture.volume.readFileSync(path) as Buffer)
    }));
  return { parts, bytes: storedArchive(parts) };
}

function chartShell(files: Record<string, Buffer>) {
  const volume = Volume.fromJSON(files);
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({ context, maxArgumentBytes: 16384, maxOutputBytes: 524288 })
    })
  );
  return { volume, shell };
}

test("pptx text replacement retains every unrelated advanced chart resource hash", async () => {
  const source = advancedDeck();
  const { shell, volume } = chartShell({ "/work/source.pptx": Buffer.from(source.bytes) });
  const result = await shell.exec(
    "pptx text replace source.pptx --find 'Coastal observatory' --with 'Lantern station' --all --output -"
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parts = inspectZip(result.stdoutBytes);
  assert.deepEqual(
    parts.map((part) => part.name).sort(),
    source.parts.map((part) => part.name).sort()
  );
  for (const original of source.parts) {
    const actual = parts.find((part) => part.name === original.name)!.payload;
    if (original.name === "ppt/slides/slide1.xml") {
      assert.ok(new TextDecoder().decode(actual).includes("Lantern station"));
    } else {
      assert.equal(
        createHash("sha256").update(actual).digest("hex"),
        createHash("sha256").update(original.bytes).digest("hex"),
        original.name
      );
    }
  }
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer),
    source.bytes
  );
});

test("pptx slide import retains advanced chart bytes and transitive style image relationships", async () => {
  const source = advancedDeck();
  const destination = advancedDeck();
  const { shell, volume } = chartShell({
    "/work/source.pptx": Buffer.from(source.bytes),
    "/work/destination.pptx": Buffer.from(destination.bytes)
  });
  const result = await shell.exec(
    "pptx slides import destination.pptx --source source.pptx --source-slides '[1]' --theme-policy source --output -"
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parts = inspectZip(result.stdoutBytes);
  for (const name of ["ppt/charts/chart1.xml", "ppt/charts/style1.xml", "ppt/media/tile.bmp"]) {
    const original = source.parts.find((part) => part.name === name)!.bytes;
    const retained = parts.filter(
      (part) =>
        part.name === name ||
        part.name ===
          name.slice(0, name.lastIndexOf(".")) + "-import1" + name.slice(name.lastIndexOf("."))
    );
    assert.equal(retained.length, 2, name);
    for (const actual of retained) {
      assert.equal(
        createHash("sha256").update(actual.payload).digest("hex"),
        createHash("sha256").update(original).digest("hex"),
        actual.name
      );
    }
  }
  const chartLinks = new TextDecoder().decode(
    parts.find((part) => part.name === "ppt/charts/_rels/chart1-import1.xml.rels")!.payload
  );
  const styleLinks = new TextDecoder().decode(
    parts.find((part) => part.name === "ppt/charts/_rels/style1-import1.xml.rels")!.payload
  );
  assert.ok(chartLinks.includes('Id="rId6"'));
  assert.ok(chartLinks.includes('Target="style1-import1.xml"'));
  assert.ok(styleLinks.includes('Id="rId7"'));
  assert.ok(styleLinks.includes('Target="../media/tile-import1.bmp"'));
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer),
    source.bytes
  );
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/destination.pptx") as Buffer),
    destination.bytes
  );
});

test("pptx slide import refuses unknown chart references before binary publication", async () => {
  const source = advancedDeck(true);
  const destination = advancedDeck();
  const { shell, volume } = chartShell({
    "/work/source.pptx": Buffer.from(source.bytes),
    "/work/destination.pptx": Buffer.from(destination.bytes)
  });
  const result = await shell.exec(
    "pptx slides import destination.pptx --source source.pptx --source-slides '[1]' --theme-policy source --dry-run --json"
  );
  assert.equal(result.exitCode, 1, result.stdout + result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.affected, 0);
  assert.equal(envelope.data, null);
  assert.equal(envelope.errors[0].code, "unsupported-edit");
  const binary = await shell.exec(
    "pptx slides import destination.pptx --source source.pptx --source-slides '[1]' --theme-policy source --output -"
  );
  assert.equal(binary.exitCode, 1, binary.stderr);
  assert.equal(binary.stdoutBytes.length, 0);
  assert.ok(binary.stderr.includes("unsupported-edit"));
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer),
    source.bytes
  );
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/destination.pptx") as Buffer),
    destination.bytes
  );
});
after(() => mock.restoreAll());

test("pptx chart creation preserves scatter pairs through quoted virtual shell data and binary output", async () => {
  const original = await createPresentation({ slides: [{}] }, context);
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/seed deck.pptx", original);
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({ context, maxArgumentBytes: 16384, maxOutputBytes: 524288 })
    })
  );
  const data = JSON.stringify({
    series: [{ name: "Harbor & tide", xValues: [5, 2, 5], values: [1, null, 7] }]
  });
  const command = `pptx charts add 'seed deck.pptx' --slide 1 --type XY_SCATTER --data '${data}' --left 0in --top 0in --width 4in --height 3in`;
  const dry = await shell.exec(command + " --dry-run --json");
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.equal(JSON.parse(dry.stdout).affected, 1);
  const output = await shell.exec(command + " --output -");
  assert.equal(output.exitCode, 0, output.stderr);
  assert.equal(output.stderr, "");
  const charts = await readCharts(output.stdoutBytes, {}, context);
  assert.equal(charts[0]!.plots[0]!.type, "scatterChart");
  assert.deepEqual(charts[0]!.plots[0]!.series[0]!.xValues!.points, [
    { index: "0", value: "5" },
    { index: "1", value: "2" },
    { index: "2", value: "5" }
  ]);
  assert.deepEqual(charts[0]!.plots[0]!.series[0]!.yValues!.points, [
    { index: "0", value: "1" },
    { index: "2", value: "7" }
  ]);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/seed deck.pptx") as Buffer), original);
  const malformed = await shell.exec(command + " --style 0 --dry-run --json");
  assert.equal(malformed.exitCode, 2, malformed.stdout + malformed.stderr);
});
