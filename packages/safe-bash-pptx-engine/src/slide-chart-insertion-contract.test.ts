import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  CategoryChartData,
  Presentation,
  createPresentation,
  createPptxCommandEngine,
  Inches,
  GraphicFrame,
  XL_CHART_TYPE,
  readCharts
} from "./index.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

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
function data() {
  const values = new CategoryChartData();
  values.categories = ["Inlet", "Shore"];
  values.add_series("Count", [4, 7]);
  return values;
}
it("inserts a synchronous live chart frame and saves its generated workbook", async () => {
  const source = await createPresentation({ slides: [{ name: "Counts" }] }, context);
  const deck = await Presentation(source, context);
  const frame = deck.slides[0]!.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    new Inches(1),
    new Inches(1),
    new Inches(4),
    new Inches(3),
    data()
  );
  expect(frame).toBeInstanceOf(GraphicFrame);
  expect(frame).not.toBeInstanceOf(Promise);
  expect(frame.has_chart).toBe(true);
  expect(frame.part === deck.slides[0]!.part).toBe(true);
  expect(frame.chart.chart_type).toBe(XL_CHART_TYPE.COLUMN_CLUSTERED);
  frame.chart.has_legend = false;
  const replacement = data();
  replacement.categories = ["Dock", "Cove"];
  frame.chart.replace_data(replacement);
  const bytes = await deck.save();
  const reopened = await Presentation(bytes, context);
  const again = reopened.slides[0]!.shapes[0] as GraphicFrame;
  expect(again.chart.has_legend).toBe(false);
  expect(again.chart.plots[0]!.categories[0]!.label).toBe("Dock");
  expect(
    (await readCharts(bytes, {}, context))[0]!.plots[0]!.series[0]!.values!.points.map((point) =>
      Number(point.value)
    )
  ).toEqual([4, 7]);

  const volume = Volume.fromJSON({ "/deck.pptx": Buffer.from(source) });
  const result = await createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 262144
  }).execute({
    args: [
      "charts",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--type",
      "COLUMN_CLUSTERED",
      "--data",
      JSON.stringify(data().to_chart_data()),
      "--left",
      "1in",
      "--top",
      "1in",
      "--width",
      "4in",
      "--height",
      "3in",
      "--output",
      "/added.pptx",
      "--json"
    ].map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
    publishOutput: async (output) => {
      volume.writeFileSync(output.outputPath, output.bytes);
    }
  });
  expect(result.exitCode, new TextDecoder().decode(result.stdout)).toBe(0);
  const records = await readCharts(
    new Uint8Array(volume.readFileSync("/added.pptx") as Buffer),
    {},
    context
  );
  expect(
    records[0]!.plots[0]!.series[0]!.values!.points.map((point) => Number(point.value))
  ).toEqual([4, 7]);
});

it("rejects invalid chart geometry and grouped insertion before changing the slide", async () => {
  const deck = await Presentation(
    await createPresentation({ slides: [{ name: "Ranges" }] }, context),
    context
  );
  const shapes = deck.slides[0]!.shapes;
  const before = await deck.save();
  expect(() =>
    shapes.add_chart(
      XL_CHART_TYPE.COLUMN_CLUSTERED,
      new Inches(0),
      new Inches(0),
      new Inches(-1),
      new Inches(2),
      data()
    )
  ).toThrow();
  expect(await deck.save()).toEqual(before);
  const group = shapes.add_group_shape();
  const grouped = await deck.save();
  expect(() =>
    group.shapes.add_chart(
      XL_CHART_TYPE.COLUMN_CLUSTERED,
      new Inches(0),
      new Inches(0),
      new Inches(1),
      new Inches(2),
      data()
    )
  ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  expect(await deck.save()).toEqual(grouped);
});

it("keeps successive chart frames and pending workbook allocations distinct", async () => {
  const deck = await Presentation(
    await createPresentation({ slides: [{ name: "Counts" }] }, context),
    context
  );
  const shapes = deck.slides[0]!.shapes;
  const first = shapes.add_chart(
    "LINE",
    new Inches(0),
    new Inches(0),
    new Inches(2),
    new Inches(2),
    data()
  );
  const second = shapes.add_chart(
    "COLUMN_CLUSTERED",
    new Inches(3),
    new Inches(0),
    new Inches(2),
    new Inches(2),
    data()
  );
  expect(second.shape_id).not.toBe(first.shape_id);
  first.chart.has_legend = false;
  second.chart.has_legend = true;
  const result = await Presentation(await deck.save(), context);
  expect(result.slides[0]!.shapes.length).toBe(2);
  expect((result.slides[0]!.shapes[0] as GraphicFrame).chart.has_legend).toBe(false);
  expect((result.slides[0]!.shapes[1] as GraphicFrame).chart.has_legend).toBe(true);
});

it("distinguishes invalid argument types from unsupported chart values without mutation", async () => {
  const deck = await Presentation(
    await createPresentation({ slides: [{ name: "Admission" }] }, context),
    context
  );
  const shapes = deck.slides[0]!.shapes;
  const before = await deck.save();
  const insert = (type: unknown, x: unknown, builder: unknown) =>
    shapes.add_chart(
      type as never,
      x as never,
      new Inches(0),
      new Inches(2),
      new Inches(2),
      builder as never
    );
  for (const [type, x, builder] of [
    [null, new Inches(0), data()],
    [XL_CHART_TYPE.LINE, 0, data()],
    [XL_CHART_TYPE.LINE, new Inches(0), null],
    [XL_CHART_TYPE.LINE, new Inches(0), data().to_chart_data()]
  ]) {
    expect(() => insert(type, x, builder)).toThrowError(
      expect.objectContaining({ name: "TypeError", code: "invalid-type" })
    );
  }
  expect(() => insert(99999, new Inches(0), data())).toThrowError(
    expect.objectContaining({ name: "ValueError", code: "invalid-value" })
  );
  expect(await deck.save()).toEqual(before);
});
