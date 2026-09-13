import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { readCharts } from "./charts.js";

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
const data = { categories: ["West", "East", "West"], series: [{ name: "", values: [0, null, 9] }] };
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function setup() {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", await createPresentation({ slides: [{}] }, context));
  const reads: string[] = [];
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 16384,
    maxOutputBytes: 524288
  });
  const run = async (args: string[]) => {
    const result = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => {
        reads.push(path);
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      },
      publishOutput: async (output) => {
        if (!output.dryRun) volume.writeFileSync(output.outputPath, output.bytes);
      }
    });
    return { ...result, value: JSON.parse(new TextDecoder().decode(result.stdout)) };
  };
  return { volume, reads, run };
}
const add = [
  "charts",
  "add",
  "/deck.pptx",
  "--slide",
  "1",
  "--type",
  "COLUMN_CLUSTERED",
  "--data",
  JSON.stringify(data),
  "--left",
  "1in",
  "--top",
  "1in",
  "--width",
  "6in",
  "--height",
  "3in"
];
it("creates ordered missing-point chart data through command schema and reads it through the SDK", async () => {
  const f = await setup();
  const result = await f.run([
    ...add,
    "--style",
    "12",
    "--title",
    "",
    "--legend",
    "false",
    "--output",
    "/out.pptx",
    "--json"
  ]);
  expect(result.exitCode, JSON.stringify(result.value)).toBe(0);
  expect(result.value).toMatchObject({
    operation: "charts.add",
    affected: 1,
    data: { dryRun: false }
  });
  const charts = await readCharts(
    new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
    {},
    context
  );
  expect(charts[0]!.style).toBe("12");
  expect(charts[0]!.plots[0]!.series[0]!.categories!.points).toEqual([
    { index: "0", value: "West" },
    { index: "1", value: "East" },
    { index: "2", value: "West" }
  ]);
  expect(charts[0]!.plots[0]!.series[0]!.values!.points).toEqual([
    { index: "0", value: "0" },
    { index: "2", value: "9" }
  ]);
  const schema = await f.run(["schema", "charts", "add", "--json"]);
  const optionsValidator = compileJsonSchema(schema.value.data.operations["charts.add"].options);
  const options = {
    slide: 1,
    type: "COLUMN_CLUSTERED",
    data,
    left: { value: 1, unit: "in" },
    top: { value: 1, unit: "in" },
    width: { value: 6, unit: "in" },
    height: { value: 3, unit: "in" },
    dryRun: true
  };
  expect(optionsValidator.validate(options).ok).toBe(true);
  expect(optionsValidator.validate({ ...options, width: "6in" }).ok).toBe(false);
  expect(
    compileJsonSchema(schema.value.data.operations["charts.add"].result).validate(result.value).ok
  ).toBe(true);
  const updated = await f.run([
    "charts",
    "set",
    "/out.pptx",
    "--slide",
    "1",
    "--style",
    "4",
    "--in-place",
    "--json"
  ]);
  expect(updated.exitCode, JSON.stringify(updated.value)).toBe(0);
  expect(
    (
      await readCharts(new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer), {}, context)
    )[0]!.style
  ).toBe("4");
});
it("validates chart mutations before reading inputs and performs dry runs without publication", async () => {
  const f = await setup();
  for (const extra of [
    ["--style", "49"],
    ["--legend", "yes"],
    ["--scope", "notes"],
    ["--type", "PIE"]
  ]) {
    expect((await f.run([...add, ...extra, "--dry-run", "--json"])).exitCode).toBe(2);
  }
  expect((await f.run([...add, "--json"])).exitCode).toBe(2);
  const stdin = [...add];
  stdin[2] = "-";
  expect((await f.run([...stdin, "--in-place", "--json"])).exitCode).toBe(2);
  expect(f.reads).toEqual([]);
  const dry = await f.run([...add, "--dry-run", "--json"]);
  expect(dry.exitCode, JSON.stringify(dry.value)).toBe(0);
  expect(dry.value.affected).toBe(1);
  expect(
    await readCharts(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer), {}, context)
  ).toEqual([]);
});

it("rejects invalid series lengths before reads and preserves a destination on ambiguity", async () => {
  const f = await setup();
  const bad = [...add];
  bad[bad.indexOf("--data") + 1] = JSON.stringify({
    categories: ["One", "Two"],
    series: [{ name: "Count", values: [1] }]
  });
  expect((await f.run([...bad, "--dry-run", "--json"])).exitCode).toBe(2);
  expect(f.reads).toEqual([]);
  expect((await f.run([...add, "--in-place", "--json"])).exitCode).toBe(0);
  expect((await f.run([...add, "--in-place", "--json"])).exitCode).toBe(0);
  const sentinel = new Uint8Array([3, 1, 4]);
  f.volume.writeFileSync("/out.pptx", sentinel);
  const result = await f.run([
    "charts",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--style",
    "4",
    "--output",
    "/out.pptx",
    "--force",
    "--json"
  ]);
  expect(result.exitCode, JSON.stringify(result.value)).toBe(1);
  expect(result.value.errors[0].code).toBe("ambiguous-selection");
  expect(new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer)).toEqual(sentinel);
  const all = await f.run([
    "charts",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--style",
    "4",
    "--all",
    "--dry-run",
    "--json"
  ]);
  expect(all.exitCode, JSON.stringify(all.value)).toBe(0);
  expect(all.value.affected).toBe(2);
  const empty = await f.run([
    "charts",
    "set",
    "/deck.pptx",
    "--shape",
    "absent",
    "--style",
    "4",
    "--allow-empty",
    "--dry-run",
    "--json"
  ]);
  expect(empty.exitCode, JSON.stringify(empty.value)).toBe(0);
  expect(empty.value.affected).toBe(0);
});

it("replaces synchronized data through opaque selection and validates explicit workbook policy", async () => {
  const f = await setup();
  expect((await f.run([...add, "--in-place", "--json"])).exitCode).toBe(0);
  const chart = (
    await readCharts(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer), {}, context)
  )[0]!;
  const command = [
    "charts",
    "replace",
    "/deck.pptx",
    "--select",
    chart.token,
    "--data",
    JSON.stringify({ categories: ["New"], series: [{ name: "Now", values: [8] }] }),
    "--in-place",
    "--json"
  ];
  expect((await f.run(command)).exitCode).toBe(2);
  const result = await f.run([...command, "--workbook-policy", "synchronize-simple"]);
  expect(result.exitCode, JSON.stringify(result.value)).toBe(0);
  expect(result.value.affected).toBe(1);
  const updated = (
    await readCharts(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer), {}, context)
  )[0]!;
  expect(updated.plots[0]!.series[0]!.values!.points).toEqual([{ index: "0", value: "8" }]);
});
