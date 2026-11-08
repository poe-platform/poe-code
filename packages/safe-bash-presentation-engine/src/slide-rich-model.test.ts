import { XL_CHART_TYPE } from "./chart-enums.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Presentation } from "./presentation-model.js";
import { createPresentation } from "./creation.js";
import { SlidePlaceholder, Picture, GraphicFrame } from "./slide-model.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
import { parseXmlPart } from "./xml.js";
import { required } from "./masters.js";
import { Volume } from "memfs";
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
async function deck(type: string | readonly string[] = "pic", count = 1) {
  const original = await createPresentation({ slides: [{ name: "Survey" }] }, context);
  const members: { name: string; bytes: Uint8Array }[] = inspectZip(original).map(
    ({ name, payload }) => ({ name, bytes: payload })
  );
  const slide = members.find((x) => x.name === "ppt/slides/slide1.xml")!;
  const xml = parseXmlPart(slide.bytes, context.xmlLimits),
    tree = required(required(xml.root, "cSld"), "spTree");
  slide.bytes = xml
    .spliceChildren(
      tree,
      tree.children.length,
      0,
      Array.from(
        { length: count },
        (_, i) =>
          `<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="${7 + i}" name="Rich slot"/><p:cNvSpPr/><p:nvPr><p:ph type="${typeof type === "string" ? type : type[i]}" idx="${14 + i}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="600000" cy="400000"/></a:xfrm></p:spPr></p:sp>`
      )
    )
    .bytes();
  return Presentation(storedArchive(members), context);
}
const raster = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 80, 141, 238, 255, 15, 0, 3, 199,
  2, 15, 253, 11, 32, 105, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);
it("owns live slide collections and inserts a picture from explicit bytes with preserved sparse identity", async () => {
  const presentation = await deck();
  expect(presentation.slides.length).toBe(1);
  const slide = presentation.slides[0]!;
  expect([...presentation.slides][0]).toBe(slide);
  expect(slide.slide_id).toBe(256);
  expect(presentation.slides.at(-1)).toBe(slide);
  expect(presentation.slides.get_by_id(256)).toBe(slide);
  expect(presentation.slides.get_by_id(900)).toBeNull();
  expect(slide.name).toBe("Survey");
  slide.name = "Lagoon";
  expect(slide.element.name.localName).toBe("sld");
  const old = slide.placeholders.get(14) as SlidePlaceholder;
  const picture = await old.insert_picture(raster);
  expect(picture).toBeInstanceOf(Picture);
  expect(picture.shape_id).toBe(7);
  expect(picture.placeholder_format.idx).toBe(14);
  expect(picture.crop_top).toBeCloseTo(1 / 6, 4);
  picture.crop_left = -0.1;
  picture.crop_right = 0.1;
  picture.crop_top = 0.1;
  picture.crop_bottom = 0.2;
  expect([picture.crop_left, picture.crop_right, picture.crop_top, picture.crop_bottom]).toEqual([
    -0.1, 0.1, 0.1, 0.2
  ]);
  expect(() => old.name).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", await presentation.save());
  const reopened = await Presentation(
    new Uint8Array(volume.readFileSync("/deck") as Buffer),
    context
  );
  expect(reopened.slides[0]!.name).toBe("Lagoon");
  expect(reopened.slides[0]!.placeholders[14]).toBeInstanceOf(Picture);
  expect(() => presentation.slides.get(-1)).toThrowError(
    expect.objectContaining({ code: "index-out-of-range" })
  );
});
it("returns a live graphic frame for chart insertion and rejects unavailable table access", async () => {
  const presentation = await deck("chart");
  const old = presentation.slides[0]!.placeholders[14] as SlidePlaceholder;
  const frame = old.insert_chart("BAR_CLUSTERED", {
    categories: ["Bay", "Hill"],
    series: [{ name: "Count", values: [2, 3] }]
  });
  expect(frame).toBeInstanceOf(GraphicFrame);
  expect(frame.has_chart).toBe(true);
  expect(frame.chart.chart_type).toBe(57);
  frame.chart.chart_style = 12;
  frame.chart.has_legend = true;
  expect(frame.chart.chart_style).toBe(12);
  expect(frame.chart.has_legend).toBe(true);
  expect(frame.has_table).toBe(false);
  expect(frame.shape_id).toBe(7);
  expect(frame.shape_type).toBe(14);
  expect(() => frame.table).toThrowError(expect.objectContaining({ code: "property-unavailable" }));
  expect(() => old.width).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  expect(
    (await Presentation(await presentation.save(), context)).slides[0]!.placeholders[14]
  ).toBeInstanceOf(GraphicFrame);
});
it("leaves invalid picture insertion atomic and rejects concurrent edits", async () => {
  const presentation = await deck(),
    old = presentation.slides[0]!.placeholders[14] as SlidePlaceholder;
  await expect(old.insert_picture(new Uint8Array([1]))).rejects.toThrow();
  expect(old.shape_id).toBe(7);
  const pending = old.insert_picture(raster);
  presentation.slides[0]!.name = "Concurrent";
  await expect(pending).rejects.toMatchObject({ code: "stale-selection" });
  expect(old.shape_id).toBe(7);
});
it("inherits master geometry by type category even when master idx differs", async () => {
  const source = await (await deck("tbl")).save();
  const members: { name: string; bytes: Uint8Array }[] = inspectZip(source).map(
    ({ name, payload }) => ({ name, bytes: payload })
  );
  for (const [suffix, type, idx, geometry] of [
    ["slides/slide1.xml", "tbl", 14, ""],
    ["slideLayouts/slideLayout1.xml", "tbl", 14, ""],
    [
      "slideMasters/slideMaster1.xml",
      "body",
      4,
      '<a:xfrm><a:off x="0" y="230"/><a:ext cx="640" cy="480"/></a:xfrm>'
    ]
  ] as const) {
    const member = members.find((x) => x.name === `ppt/${suffix}`)!;
    const xml = parseXmlPart(member.bytes, context.xmlLimits),
      tree = required(required(xml.root, "cSld"), "spTree");
    const existing = tree.children.findIndex((n) => n.name.localName === "sp");
    member.bytes = xml
      .spliceChildren(tree, existing < 0 ? tree.children.length : existing, existing < 0 ? 0 : 1, [
        `<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="7" name="Inherited"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}" idx="${idx}"/></p:nvPr></p:nvSpPr><p:spPr>${geometry}</p:spPr></p:sp>`
      ])
      .bytes();
  }
  const presentation = await Presentation(storedArchive(members), context),
    placeholder = presentation.slides[0]!.placeholders[14] as SlidePlaceholder;
  expect([
    placeholder.left?.emu,
    placeholder.top?.emu,
    placeholder.width?.emu,
    placeholder.height?.emu
  ]).toEqual([0, 230, 640, 480]);
  const frame = placeholder.insert_table(1, 1);
  expect([frame.left?.emu, frame.top?.emu, frame.width?.emu, frame.height?.emu]).toEqual([
    0, 230, 640, 370840
  ]);
  frame.table.cell(0, 0).text = "Inherited area";
  expect(
    (await Presentation(await presentation.save(), context)).slides[0]!.placeholders[14]
  ).toBeInstanceOf(GraphicFrame);
});
it("creates multiple chart handles synchronously and serializes each deferred workbook once", async () => {
  const presentation = await deck("chart", 2);
  const first = (presentation.slides[0]!.placeholders[14] as SlidePlaceholder).insert_chart(
    "LINE",
    { categories: ["A"], series: [{ name: "First", values: [2] }] }
  );
  const second = (presentation.slides[0]!.placeholders[15] as SlidePlaceholder).insert_chart(
    "COLUMN_CLUSTERED",
    { categories: ["B"], series: [{ name: "Second", values: [5] }] }
  );
  expect(first).toBeInstanceOf(GraphicFrame);
  expect(second).toBeInstanceOf(GraphicFrame);
  first.chart.chart_style = 8;
  second.chart.chart_style = 9;
  const bytes = await presentation.save();
  const workbookNames = inspectZip(bytes)
    .filter((member) => member.name.endsWith(".xlsx"))
    .map((member) => member.name);
  expect(workbookNames).toHaveLength(2);
  expect(new Set(workbookNames).size).toBe(2);
  const reopened = await Presentation(bytes, context);
  expect((reopened.slides[0]!.placeholders[14] as GraphicFrame).chart.chart_style).toBe(8);
  expect((reopened.slides[0]!.placeholders[15] as GraphicFrame).chart.chart_style).toBe(9);
  expect(await presentation.save()).toEqual(bytes);
});
it("rejects concurrent model mutation while flushing deferred chart workbooks", async () => {
  const presentation = await deck("chart");
  const frame = (presentation.slides[0]!.placeholders[14] as SlidePlaceholder).insert_chart(
    "LINE",
    { categories: ["A"], series: [{ name: "Readings", values: [1] }] }
  );
  expect(frame).toBeInstanceOf(GraphicFrame);
  const pending = presentation.save();
  presentation.slides[0]!.name = "New name";
  await expect(pending).rejects.toMatchObject({ code: "stale-selection" });
  expect((await Presentation(await presentation.save(), context)).slides[0]!.name).toBe("New name");
});
it("flushes a pending chart workbook before package-backed picture insertion", async () => {
  const presentation = await deck(["chart", "pic"], 2);
  const chart = (presentation.slides[0]!.placeholders[14] as SlidePlaceholder).insert_chart(
    "LINE",
    { categories: ["Dock"], series: [{ name: "Visits", values: [4] }] }
  );
  const picture = await (
    presentation.slides[0]!.placeholders[15] as SlidePlaceholder
  ).insert_picture(raster);
  expect(chart.has_chart).toBe(true);
  expect(picture).toBeInstanceOf(Picture);
  chart.chart.chart_style = 10;
  const reopened = await Presentation(await presentation.save(), context);
  expect((reopened.slides[0]!.placeholders[14] as GraphicFrame).chart.chart_style).toBe(10);
  expect(reopened.slides[0]!.placeholders[15]).toBeInstanceOf(Picture);
});
it("rejects invalid chart data synchronously without installing package changes", async () => {
  const presentation = await deck("chart"),
    placeholder = presentation.slides[0]!.placeholders[14] as SlidePlaceholder;
  const before = await presentation.save();
  expect(() =>
    placeholder.insert_chart("LINE", {
      categories: ["One"],
      series: [{ name: "Bad", values: [Number.NaN] }]
    })
  ).toThrow();
  expect(placeholder.shape_id).toBe(7);
  expect(await presentation.save()).toEqual(before);
});

it("accepts documented numeric chart enums and rejects unsupported enums before mutation", async () => {
  const presentation = await deck("chart");
  const placeholder = presentation.slides[0]!.placeholders[14] as SlidePlaceholder;
  const data = { categories: ["Harbor"], series: [{ name: "Boats", values: [3] }] };
  const before = await presentation.save();
  expect(() => placeholder.insert_chart(XL_CHART_TYPE.THREE_D_AREA, data)).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
  expect(await presentation.save()).toEqual(before);
  const frame = placeholder.insert_chart(XL_CHART_TYPE.LINE, data);
  expect(frame).toBeInstanceOf(GraphicFrame);
  expect(frame.chart.chart_type).toBe(XL_CHART_TYPE.LINE);
  expect(
    (await Presentation(await presentation.save(), context)).slides[0]!.placeholders[14]
  ).toBeInstanceOf(GraphicFrame);
});
