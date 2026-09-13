import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDeckFixture } from "../tests/fixtures/decks.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";
import { inspectChart, readCharts } from "./charts.js";
const c = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const limits = { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 };
function chart(body: string, ns = c) {
  return inspectChart(
    parseXmlPart(
      new TextEncoder().encode(
        `<c:chartSpace xmlns:c="${ns}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:x="urn:custom">${body}</c:chartSpace>`
      ),
      limits
    )
  );
}
it("separates formula caches from authoritative literal series values without filling sparse points", () => {
  const result = chart(
    `<c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:ser><c:idx val="7"/><c:order val="2"/><c:tx><c:v>Revenue &amp; cost</c:v></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="2"><c:v>West</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numLit><c:formatCode>0.00</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>12.5</c:v></c:pt><c:pt idx="2"><c:v>#N/A</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="10"/></c:barChart></c:plotArea></c:chart>`
  );
  expect(result.plots[0]).toMatchObject({
    type: "barChart",
    axisIds: ["10"],
    properties: { barDir: "col", grouping: "stacked" }
  });
  expect(result.plots[0]!.series[0]).toMatchObject({
    index: "7",
    order: "2",
    name: "Revenue & cost",
    categories: {
      authority: "referenced",
      formula: "Sheet1!$A$2:$A$4",
      cached: true,
      pointCount: "3",
      points: [{ index: "2", value: "West" }]
    },
    values: {
      authority: "literal",
      cached: false,
      formatCode: "0.00",
      points: [
        { index: "0", value: "12.5" },
        { index: "2", value: "#N/A" }
      ]
    }
  });
});
it.each([
  "areaChart",
  "area3DChart",
  "barChart",
  "bar3DChart",
  "lineChart",
  "line3DChart",
  "pieChart",
  "pie3DChart",
  "doughnutChart",
  "ofPieChart",
  "radarChart",
  "scatterChart",
  "bubbleChart",
  "stockChart",
  "surfaceChart",
  "surface3DChart"
])("inventories the %s plot family without converting its representation", (type) => {
  expect(chart(`<c:chart><c:plotArea><c:${type}/></c:plotArea></c:chart>`).plots[0]!.type).toBe(
    type
  );
});
it("retains hierarchical categories and independent XY and bubble sources", () => {
  const result = chart(
    `<c:chart><c:plotArea><c:bubbleChart><c:ser><c:cat><c:multiLvlStrRef><c:f>Grid!A1:B2</c:f><c:multiLvlStrCache><c:ptCount val="2"/><c:lvl><c:pt idx="0"><c:v>Local</c:v></c:pt></c:lvl><c:lvl><c:pt idx="0"><c:v>Region</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat><c:xVal><c:numLit><c:pt idx="0"><c:v>1</c:v></c:pt></c:numLit></c:xVal><c:yVal><c:numRef><c:f>Grid!C1</c:f></c:numRef></c:yVal><c:bubbleSize><c:numLit><c:pt idx="0"><c:v>4</c:v></c:pt></c:numLit></c:bubbleSize></c:ser></c:bubbleChart></c:plotArea></c:chart>`
  );
  const series = result.plots[0]!.series[0]!;
  expect(series.categories!.levels).toEqual([
    [{ index: "0", value: "Local" }],
    [{ index: "0", value: "Region" }]
  ]);
  expect(series.xValues!.points).toEqual([{ index: "0", value: "1" }]);
  expect(series.yValues).toMatchObject({ authority: "referenced", cached: false, points: [] });
  expect(series.bubbleSizes!.points).toEqual([{ index: "0", value: "4" }]);
});
it("enumerates axes labels points legends and styles without creating absent defaults", () => {
  const result = chart(
    `<c:style val="12"/><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarter</a:t></a:r></a:p></c:rich></c:tx></c:title><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotArea><c:lineChart><c:ser><c:marker><c:symbol val="circle"/></c:marker><c:dPt><c:idx val="3"/><c:invertIfNegative val="1"/></c:dPt><c:dLbls><c:showVal val="1"/></c:dLbls></c:ser></c:lineChart><c:valAx><c:axId val="4"/><c:scaling><c:min val="-5"/><c:max val="20"/></c:scaling><c:crossAx val="8"/><c:majorGridlines/><c:numFmt formatCode="0%" sourceLinked="0"/></c:valAx></c:plotArea></c:chart>`
  );
  expect(result.style).toBe("12");
  expect(result.title!.text).toContain("Quarter");
  expect(result.legend!.children.map((x) => x.name)).toEqual(["legendPos", "overlay"]);
  expect(result.axes[0]).toMatchObject({
    type: "valAx",
    id: "4",
    crossAxisId: "8",
    properties: { axId: "4", crossAx: "8" }
  });
  expect(result.axes[0]!.xml).toContain('formatCode="0%"');
  expect(result.plots[0]!.series[0]!.points[0]!.xml).toContain('val="3"');
  expect(result.plots[0]!.series[0]!.labels!.xml).toContain("showVal");
  expect(chart(`<c:chart><c:plotArea/></c:chart>`)).toMatchObject({
    title: null,
    legend: null,
    style: null,
    plots: [],
    axes: []
  });
});
it("recognizes strict charts while retaining foreign and unsupported markup exactly", () => {
  const body = `<c:chart><c:plotArea><x:barChart/><c:lineChart><c:ser><c:trendline><c:trendlineType val="linear"/></c:trendline></c:ser></c:lineChart></c:plotArea></c:chart><c:extLst><c:ext uri="custom"><x:payload keep='yes'/></c:ext></c:extLst>`;
  const result = chart(body, "http://purl.oclc.org/ooxml/drawingml/chart");
  expect(result.plots.map((x) => x.type)).toEqual(["lineChart"]);
  expect(result.unsupported.map((x) => x.name)).toEqual(
    expect.arrayContaining(["barChart", "trendline", "extLst"])
  );
  expect(result.xml).toContain("<x:payload keep='yes'/>");
});
it("selects the classic style fallback while preserving an unsupported style choice", () => {
  const result = chart(
    `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:e="urn:new-style"><mc:Choice Requires="e"><e:style val="110"/></mc:Choice><mc:Fallback><c:style val="10"/></mc:Fallback></mc:AlternateContent><c:chart><c:plotArea/></c:chart>`
  );
  expect(result.style).toBe("10");
  expect(result.xml).toContain('val="110"');
});
it("reports unknown classic elements once and exposes external data update intent", () => {
  const result = chart(
    `<c:externalData xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="book"><c:autoUpdate val="0"/></c:externalData><c:chart><c:plotArea><c:futureChart><x:payload/></c:futureChart></c:plotArea></c:chart>`
  );
  expect(result.unsupported.map((x) => x.name)).toEqual(["futureChart"]);
  expect(result.externalData[0]!.xml).toContain('r:id="book"');
  expect(result.externalData[0]!.children[0]!.attributes).toEqual({ val: "0" });
});

it.each([
  null,
  "invalid",
  { slide: 0 },
  { scope: "masters" },
  { chart: 1 },
  { select: "token", shape: "name" }
])("rejects invalid chart selectors before reading bytes (%j)", async (options) => {
  const read = vi.fn();
  await expect(readCharts({ read }, options as never, {} as never)).rejects.toBeDefined();
  expect(read).not.toHaveBeenCalled();
});
it("rejects chart selector accessors without invoking them", async () => {
  const getter = vi.fn(() => 1),
    options = Object.defineProperty({}, "slide", { get: getter });
  await expect(readCharts(new Uint8Array(), options, {} as never)).rejects.toMatchObject({
    code: "invalid-value"
  });
  expect(getter).not.toHaveBeenCalled();
});

it("rejects inherited chart selectors without reading input", async () => {
  const read = vi.fn();
  await expect(
    readCharts({ read }, Object.create({ slide: 1 }), {} as never)
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(read).not.toHaveBeenCalled();
});

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
  xmlLimits: limits,
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
it("snapshots selectors before awaiting the caller byte source", async () => {
  const { volume, root } = createDeckFixture("seed-library");
  const bytes = storedArchive(
    Object.keys(volume.toJSON()).map((path) => ({
      name: path.slice(root.length + 1),
      bytes: new Uint8Array(volume.readFileSync(path) as Buffer)
    }))
  );
  const options = { slide: 1 };
  let offset = 0;
  const records = await readCharts(
    {
      read: async (max) => {
        options.slide = 999;
        if (offset === bytes.length) return null;
        const chunk = bytes.slice(offset, offset + max);
        offset += chunk.length;
        return chunk;
      }
    },
    options,
    context
  );
  expect(records).toHaveLength(1);
  expect(records[0]!.chartPart).toBe("/ppt/charts/chart1.xml");
  const selected = await readCharts(bytes, { select: records[0]!.token }, context);
  expect(selected.map((x) => x.chartPart)).toEqual(["/ppt/charts/chart1.xml"]);
  expect(await readCharts(bytes, { shape: "Absent chart" }, context)).toEqual([]);
});
