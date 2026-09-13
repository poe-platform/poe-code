import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { Chart, createPptxCommandEngine, XL_AXIS_CROSSES } from "pptx";
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
    maxArchiveBytes: 524288, maxEntryBytes: 131072, maxTotalBytes: 524288,
    maxMembers: 128, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024,
    maxTextBytes: 131072, chunkSize: 8192
  },
  xmlLimits: { maxBytes: 131072, maxNodes: 8000, maxDepth: 64 },
  relationshipLimits: { maxBytes: 131072, maxParts: 128, maxRelationships: 128 }
};

before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

for (const scenario of [
  { name: "starts custom crossing at zero", crossing: '<c:crosses val="autoZero"/>', update: { crosses: "CUSTOM" }, expected: 0 },
  { name: "retains an existing custom coordinate", crossing: '<c:crossesAt val="-2.5"/>', update: { crosses: "CUSTOM" }, expected: -2.5 },
  { name: "clears a custom coordinate", crossing: '<c:crossesAt val="17"/>', update: { crossesAt: null }, expected: null }
]) {
  test(`pptx charts set ${scenario.name} on the crossed axis`, async () => {
    const fixture = createDeckFixture("seed-library");
    const chartPath = `${fixture.root}/ppt/charts/chart1.xml`;
    fixture.volume.writeFileSync(chartPath,
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:axId val="10"/><c:axId val="20"/></c:barChart><c:catAx><c:axId val="10"/><c:crossAx val="20"/>${scenario.crossing}</c:catAx><c:valAx><c:axId val="20"/><c:crossAx val="10"/><c:crosses val="max"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`);
    const source = storedArchive(Object.entries(fixture.volume.toJSON())
      .filter(([, value]) => value !== null)
      .map(([path]) => ({ name: path.slice(fixture.root.length + 1), bytes: new Uint8Array(fixture.volume.readFileSync(path) as Buffer) })));
    const volume = Volume.fromJSON({ "/work/input.pptx": Buffer.from(source) });
    const fs = new MemoryFileSystem();
    fs.readStream = async function* (path, options) {
      options?.signal?.throwIfAborted();
      yield new Uint8Array(volume.readFileSync(path) as Buffer);
    };
    const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({
      engine: createPptxCommandEngine({ context, maxArgumentBytes: 16384, maxOutputBytes: 524288 })
    }));
    const updates = JSON.stringify([{ target: "valueAxis", ...scenario.update }]);
    const result = await shell.exec(`pptx charts set input.pptx --slide 1 --objects '${updates}' --output -`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = inspectZip(result.stdoutBytes).find((part) => part.name === "ppt/charts/chart1.xml")!.payload;
    const xml = parseXmlPart(payload, context.xmlLimits);
    const plotArea = xml.root.children[0]!.children[0]!;
    const category = plotArea.children.find((node) => node.name.localName === "catAx")!;
    const value = plotArea.children.find((node) => node.name.localName === "valAx")!;
    const crossing = category.children.find((node) => node.name.localName === "crossesAt");
    assert.equal(crossing?.attributes.find((attribute) => attribute.name.localName === "val")?.value,
      scenario.expected === null ? undefined : String(scenario.expected));
    assert.equal(category.children.some((node) => node.name.localName === "crosses"), false);
    assert.ok(xml.markup(value).includes('<c:crosses val="max"/>'));
    const chart = new Chart(() => xml, () => assert.fail("reading the chart must not write"));
    assert.equal(chart.value_axis.crosses, XL_AXIS_CROSSES.CUSTOM);
    assert.equal(chart.value_axis.crosses_at, scenario.expected);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/input.pptx") as Buffer), source);
  });
}
