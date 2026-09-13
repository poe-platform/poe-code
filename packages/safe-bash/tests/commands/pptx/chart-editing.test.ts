import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { createPresentation, createPptxCommandEngine, readCharts } from "pptx";
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
