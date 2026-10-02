import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  Presentation,
  Inches,
  createPptxCommandEngine,
  addLayout,
  CategoryChartData,
  XL_CHART_TYPE,
  readCharts
} from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";

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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

it("appends slides synchronously through owned layouts and retains existing live handles", async () => {
  const deck = await Presentation(undefined, context);
  const layouts = deck.slide_layouts;
  expect(layouts.length).toBe(1);
  expect(layouts[0]!.name).toBe("Blank");
  expect([...layouts]).toEqual([layouts[0]]);
  expect(layouts.at(-1)).toBe(layouts[0]);
  const slides = deck.slides;
  const first = slides.add_slide(layouts[0]!);
  expect(first).not.toBeInstanceOf(Promise);
  first.name = "Tide survey";
  const frame = first.shapes.add_table(
    1,
    1,
    new Inches(1),
    new Inches(1),
    new Inches(2),
    new Inches(1)
  );
  frame.table.cell(0, 0).text = "Reef";
  const second = slides.add_slide(layouts[0]!);
  expect(deck.slides).toBe(slides);
  expect(slides.length).toBe(2);
  expect(slides[0]).toBe(first);
  expect(slides[1]).toBe(second);
  expect(first.part.package).toBe(layouts[0]!.part.package);
  first.name = "Updated survey";
  expect(first.shapes[0]!.shape_id).toBe(frame.shape_id);
  const reopened = await Presentation(await deck.save(), context);
  expect([...reopened.slides].map((slide) => slide.name)).toEqual(["Updated survey", ""]);
  expect(reopened.slides[0]!.shapes.length).toBe(1);
});

it("rejects foreign layouts and invalid positions without changing the graph", async () => {
  const deck = await Presentation(undefined, context);
  const other = await Presentation(undefined, context);
  const before = await deck.save();
  expect(() => deck.slides.add_slide(other.slide_layouts[0]!)).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
  expect(() => deck.slides.add_slide(null as never)).toThrowError(
    expect.objectContaining({ code: "invalid-type" })
  );
  for (const index of [-1, 1, 0.5, Number.NaN])
    expect(() => deck.slide_layouts[index]).toThrowError(
      expect.objectContaining({ code: "index-out-of-range" })
    );
  expect(deck.slides.length).toBe(0);
  expect(await deck.save()).toEqual(before);
});

it("uses the same inserted package graph as the direct SDK-backed command", async () => {
  const deck = await Presentation(undefined, context);
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/before", await deck.save());
  const slide = deck.slides.add_slide(deck.slide_layouts[0]!);
  expect(slide.slide_id).toBe(256);
  const modelBytes = await deck.save();
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 262144
  });
  const result = await engine.execute({
    args: ["slides", "add", "/before", "--layout", "Blank", "--output", "/after", "--json"].map(
      (value) => new TextEncoder().encode(value)
    ),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
    publishOutput: async (request) => {
      volume.writeFileSync(request.outputPath, request.bytes);
    }
  });
  expect(result.exitCode, new TextDecoder().decode(result.stdout)).toBe(0);
  const entries = (bytes: Uint8Array) =>
    inspectZip(bytes)
      .map(({ name, payload }) => ({ name, payload }))
      .sort((a, b) => a.name.localeCompare(b.name));
  expect(entries(new Uint8Array(volume.readFileSync("/after") as Buffer))).toEqual(
    entries(modelBytes)
  );
});

it("follows declared master layout order and clones sparse placeholders without prompts", async () => {
  const initial = await (await Presentation(undefined, context)).save();
  const first = await addLayout(
    initial,
    {
      scope: "layouts",
      master: "/ppt/slideMasters/slideMaster1.xml",
      name: "Zebra",
      placeholders: [
        {
          type: "title",
          index: 0,
          name: "Heading",
          text: "Layout prompt",
          x: 100,
          y: 100,
          width: 10000,
          height: 10000
        },
        {
          type: "body",
          index: 7,
          name: "Summary",
          text: "Body prompt",
          x: 100,
          y: 200,
          width: 10000,
          height: 10000
        },
        { type: "dt", index: 11, name: "Date" }
      ]
    },
    context
  );
  const second = await addLayout(
    first.bytes,
    { scope: "layouts", master: "/ppt/slideMasters/slideMaster1.xml", name: "Alpha" },
    context
  );
  const deck = await Presentation(second.bytes, context);
  const layouts = deck.slide_layouts;
  expect([...layouts].map((layout) => layout.name)).toEqual(["Blank", "Zebra", "Alpha"]);
  expect(layouts.index(layouts[1]!)).toBe(1);
  expect(layouts.get_by_name("Zebra")).toBe(layouts[1]);
  expect(layouts.get_by_name("Missing")).toBeNull();
  expect(layouts.get_by_name("Missing", layouts[0]!)).toBe(layouts[0]);
  layouts[2]!.name = null;
  expect(layouts[2]!.name).toBe("");
  const slide = deck.slides.add_slide(layouts[1]!);
  expect([...slide.placeholders].map((placeholder) => placeholder.placeholder_format.idx)).toEqual([
    0, 7
  ]);
  expect(slide.shapes.title!.text).toBe("");
  slide.shapes.title!.text = "Coastal census";
  slide.placeholders[7]!.text = "Observed on shore";
  const reopened = await Presentation(await deck.save(), context);
  expect(reopened.slides[0]!.shapes.title!.text).toBe("Coastal census");
  expect(reopened.slides[0]!.placeholders[7]!.text).toBe("Observed on shore");
});

it("retains pending workbooks when appending and supports charts on newly inserted slides", async () => {
  const deck = await Presentation(undefined, context);
  const data = new CategoryChartData();
  data.categories = ["Harbor", "Dune"];
  data.add_series("Birds", [3, 8]);
  const first = deck.slides.add_slide(deck.slide_layouts[0]!);
  const chart = first.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    new Inches(1),
    new Inches(1),
    new Inches(4),
    new Inches(3),
    data
  ).chart;
  const second = deck.slides.add_slide(deck.slide_layouts[0]!);
  chart.has_legend = false;
  const next = second.shapes.add_chart(
    XL_CHART_TYPE.LINE,
    new Inches(1),
    new Inches(1),
    new Inches(4),
    new Inches(3),
    data
  ).chart;
  next.has_legend = true;
  expect(first.shapes.length).toBe(1);
  expect(second.shapes.length).toBe(1);
  const saved = await deck.save();
  expect((await Presentation(saved, context)).slides.length).toBe(2);
  expect(
    (await readCharts(saved, {}, context)).map((item) =>
      item.plots[0]!.series[0]!.values!.points.map((point) => Number(point.value))
    )
  ).toEqual([
    [3, 8],
    [3, 8]
  ]);
  expect(chart.has_legend).toBe(false);
  expect(next.has_legend).toBe(true);
});

it("reports missing first-master layouts with a typed index error on property access", async () => {
  const original = await (await Presentation(undefined, context)).save();
  const entries = inspectZip(original).map(({ name, payload }) => {
    if (name !== "ppt/presentation.xml") return { name, bytes: payload };
    let xml = parseXmlPart(payload, context.xmlLimits);
    const masterList = xml.root.children.find((node) => node.name.localName === "sldMasterIdLst")!;
    xml = xml.spliceChildren(xml.root, xml.root.children.indexOf(masterList), 1, []);
    return { name, bytes: xml.bytes() };
  });
  const deck = await Presentation(storedArchive(entries), context);
  expect(() => deck.slide_layouts).toThrowError(
    expect.objectContaining({ code: "index-out-of-range" })
  );
});

it("admits an image asynchronously on a newly appended slide without losing existing owners", async () => {
  const deck = await Presentation(undefined, context);
  const first = deck.slides.add_slide(deck.slide_layouts[0]!);
  first.name = "Existing shore";
  const slide = deck.slides.add_slide(deck.slide_layouts[0]!);
  const bytes = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 80, 141, 238, 255, 15, 0, 3,
    199, 2, 15, 253, 11, 32, 105, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
  ]);
  const pending = slide.shapes.add_picture(bytes, new Inches(1), new Inches(1));
  expect(pending).toBeInstanceOf(Promise);
  const picture = await pending;
  expect(picture.image.blob).toEqual(bytes);
  first.name = "Updated shore";
  const reopened = await Presentation(await deck.save(), context);
  expect(reopened.slides[0]!.name).toBe("Updated shore");
  expect(reopened.slides[1]!.shapes[0]!.shape_id).toBe(picture.shape_id);
});
