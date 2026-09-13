import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { addChart, setCharts } from "./chart-editing.js";
import { inspectZip } from "../tests/zip-reader.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  createChartXml,
  validateChartData,
  type ChartData,
  type CreatableChartType
} from "./chart-editing.js";

const families = [
  ["AREA", "areaChart", '<c:grouping val="standard"/>'],
  ["AREA_STACKED", "areaChart", '<c:grouping val="stacked"/>'],
  ["AREA_STACKED_100", "areaChart", '<c:grouping val="percentStacked"/>'],
  ["DOUGHNUT", "doughnutChart", '<c:holeSize val="50"/>'],
  ["DOUGHNUT_EXPLODED", "doughnutChart", '<c:explosion val="25"/>'],
  ["RADAR", "radarChart", '<c:radarStyle val="marker"/>'],
  ["RADAR_FILLED", "radarChart", '<c:radarStyle val="filled"/>'],
  ["RADAR_MARKERS", "radarChart", '<c:radarStyle val="marker"/>'],
  ["BUBBLE", "bubbleChart", '<c:bubble3D val="0"/>'],
  ["BUBBLE_THREE_D_EFFECT", "bubbleChart", '<c:bubble3D val="1"/>']
] as const;

it.each(families)("writes independent plot and data assertions for %s", (type, plot, fragment) => {
  const bubble = type.startsWith("BUBBLE");
  const data = bubble
    ? {
        series: [
          { name: "Soundings", xValues: [8, 3, 8], values: [2, null, -1], bubbleSizes: [0, 5, 9] }
        ]
      }
    : {
        categories: ["Port", null, "Port"],
        series: [{ name: "Soundings", values: [2, null, -1] }]
      };
  const xml = createChartXml(type as CreatableChartType, data);
  expect(xml).toContain(`<c:${plot}>`);
  expect(xml).toContain(fragment);
  expect(xml).toContain('<c:pt idx="2"><c:v>-1</c:v></c:pt>');
  expect(xml).not.toContain('<c:pt idx="1"><c:v>null</c:v>');
  expect(xml).toContain(bubble ? "<c:xVal>" : "<c:cat>");
  if (bubble) {
    expect(xml).toContain("<c:bubbleSize><c:numRef><c:f>Sheet1!$C$2:$C$4</c:f>");
    expect(xml).toContain('<c:pt idx="0"><c:v>0</c:v></c:pt>');
    expect(xml).not.toContain("<c:catAx>");
    expect(xml).not.toContain("<c:marker>");
  }
  if (type.startsWith("DOUGHNUT")) expect(xml).not.toContain("<c:axId");
  if (type === "RADAR") expect(xml).toContain('<c:marker><c:symbol val="none"/></c:marker>');
  if (type === "RADAR_MARKERS")
    expect(xml).toContain('<c:marker><c:symbol val="circle"/></c:marker>');
});

it("writes outer-to-inner hierarchical worksheet references and leaf-first sparse cache levels", () => {
  const xml = createChartXml(
    "AREA" as CreatableChartType,
    {
      categoryLevels: [
        ["Coast", null, "Inland"],
        ["A", "B", "C"]
      ],
      series: [{ name: "Volume", values: [4, 7, 1] }]
    } as ChartData
  );
  expect(xml).toContain(
    '<c:multiLvlStrRef><c:f>Sheet1!$A$2:$B$4</c:f><c:multiLvlStrCache><c:ptCount val="3"/><c:lvl><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt><c:pt idx="2"><c:v>C</c:v></c:pt></c:lvl><c:lvl><c:pt idx="0"><c:v>Coast</c:v></c:pt><c:pt idx="2"><c:v>Inland</c:v></c:pt></c:lvl>'
  );
  expect(xml).toContain("<c:f>Sheet1!$C$2:$C$4</c:f>");
});

it("inherits data number formats while keeping category and series overrides independent", () => {
  const xml = createChartXml(
    "AREA" as CreatableChartType,
    {
      categories: [1, 2],
      numberFormat: "0.0%",
      categoryNumberFormat: "000",
      series: [
        { name: "Share", values: [0.1, 0.2] },
        { name: "Count", values: [2, 3], numberFormat: "0" }
      ]
    } as ChartData
  );
  expect(xml).toContain("<c:formatCode>000</c:formatCode>");
  expect(xml).toContain("<c:formatCode>0.0%</c:formatCode>");
  expect(xml).toContain("<c:formatCode>0</c:formatCode>");
});

it.each(["AREA", "AREA_STACKED", "AREA_STACKED_100", "RADAR", "RADAR_FILLED", "RADAR_MARKERS"])(
  "keeps date systems explicit for %s",
  (type) => {
    const xml = createChartXml(
      type as CreatableChartType,
      {
        categories: ["1904-01-01T00:00:00Z", "1904-01-03T00:00:00Z"],
        date1904: true,
        series: [{ name: "Days", values: [1, 2] }]
      } as ChartData
    );
    expect(xml).toContain('<c:date1904 val="1"/>');
    expect(xml).toContain('<c:pt idx="0"><c:v>0</c:v></c:pt>');
    expect(xml).toContain(type.startsWith("RADAR") ? "<c:catAx>" : "<c:dateAx>");
  }
);

it.each([
  { xValues: [1], values: [2] },
  { xValues: [1], values: [2], bubbleSizes: [-1] },
  { xValues: [1], values: [2], bubbleSizes: [null] },
  { xValues: [1], values: [2], bubbleSizes: [Infinity] },
  { xValues: [1], values: [2], bubbleSizes: [1, 2] }
])("rejects invalid bubble channels %#", (series) => {
  expect(() =>
    validateChartData(
      { series: [{ name: "Dot", ...series }] } as ChartData,
      "BUBBLE" as CreatableChartType
    )
  ).toThrow();
});
it.each(["AREA_3D", "BAR_3D", "STOCK_HLC", "PIE_OF_PIE", "SURFACE"])(
  "keeps unsupported construction explicit for %s",
  (type) => {
    expect(() =>
      createChartXml(type as CreatableChartType, {
        categories: ["A"],
        series: [{ name: "Count", values: [1] }]
      })
    ).toThrow();
  }
);

const categoryVariants = [
  "AREA",
  "AREA_STACKED",
  "AREA_STACKED_100",
  "BAR_CLUSTERED",
  "BAR_STACKED",
  "BAR_STACKED_100",
  "COLUMN_CLUSTERED",
  "COLUMN_STACKED",
  "COLUMN_STACKED_100",
  "DOUGHNUT",
  "DOUGHNUT_EXPLODED",
  "LINE",
  "LINE_MARKERS",
  "LINE_MARKERS_STACKED",
  "LINE_MARKERS_STACKED_100",
  "LINE_STACKED",
  "LINE_STACKED_100",
  "PIE",
  "PIE_EXPLODED",
  "RADAR",
  "RADAR_FILLED",
  "RADAR_MARKERS"
] as const;
it.each(categoryVariants)(
  "retains numeric formats and repeated hierarchy boundaries in %s",
  (type) => {
    const numeric = createChartXml(type, {
      categories: [4, null, 2],
      categoryNumberFormat: "000",
      series: [{ name: "Units", values: [9, null, 3] }]
    });
    expect(numeric).toContain(
      '<c:cat><c:numRef><c:f>Sheet1!$A$2:$A$4</c:f><c:numCache><c:formatCode>000</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>4</c:v></c:pt><c:pt idx="2"><c:v>2</c:v></c:pt>'
    );
    const levels = createChartXml(type, {
      categoryLevels: [
        ["Region", null, "Region"],
        ["One", "Two", "Three"]
      ],
      series: [{ name: "Units", values: [9, 4, 3] }]
    });
    expect(levels).toContain(
      '<c:lvl><c:pt idx="0"><c:v>Region</c:v></c:pt><c:pt idx="2"><c:v>Region</c:v></c:pt></c:lvl>'
    );
    expect(levels).toContain("<c:f>Sheet1!$C$2:$C$4</c:f>");
  }
);
it.each(categoryVariants)("uses explicit 1900 and 1904 serial caches in %s", (type) => {
  for (const [date1904, serial] of [
    [false, 1462],
    [true, 0]
  ] as const) {
    const xml = createChartXml(type, {
      categories: ["1904-01-01T00:00:00Z"],
      date1904,
      series: [{ name: "Units", values: [9] }]
    });
    expect(xml).toContain(
      `<c:cat><c:numRef><c:f>Sheet1!$A$2:$A$2</c:f><c:numCache><c:formatCode>yyyy-mm-dd</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>${serial}</c:v></c:pt>`
    );
    if (type.startsWith("PIE") || type.startsWith("DOUGHNUT")) expect(xml).not.toContain("<c:axId");
    else expect(xml).toContain(type.startsWith("RADAR") ? "<c:catAx>" : "<c:dateAx>");
  }
});
it("keeps x and bubble size formats independent from a y-series override", () => {
  const xml = createChartXml("BUBBLE", {
    numberFormat: "0.0",
    series: [{ name: "Sample", numberFormat: "0%", xValues: [2], values: [0.1], bubbleSizes: [3] }]
  });
  expect(xml).toContain(
    "<c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$2</c:f><c:numCache><c:formatCode>0.0</c:formatCode>"
  );
  expect(xml).toContain(
    "<c:yVal><c:numRef><c:f>Sheet1!$B$2:$B$2</c:f><c:numCache><c:formatCode>0%</c:formatCode>"
  );
  expect(xml).toContain(
    "<c:bubbleSize><c:numRef><c:f>Sheet1!$C$2:$C$2</c:f><c:numCache><c:formatCode>0.0</c:formatCode>"
  );
});
it.each([
  { categories: ["A"], categoryLevels: [["A"]] },
  { categoryLevels: [["A"], ["B", "C"]] },
  { categoryLevels: [[2]] },
  { categoryLevels: [] },
  { categoryLevels: [["A"]], date1904: "true" },
  { categoryLevels: [["A"]], numberFormat: 0 }
])("rejects malformed hierarchy or data metadata %#", (fields) => {
  expect(() =>
    createChartXml("AREA", { ...fields, series: [{ name: "Units", values: [1] }] } as ChartData)
  ).toThrow();
});
it("starts parent spans again when ancestors change without merging equal labels across branches", () => {
  const xml = createChartXml("LINE", {
    categoryLevels: [
      ["North", "North", "South", "South"],
      ["Zone", "Zone", "Zone", "Zone"],
      ["A", "B", "C", "D"]
    ],
    series: [{ name: "Units", values: [1, 2, 3, 4] }]
  });
  expect(xml).toContain(
    '<c:lvl><c:pt idx="0"><c:v>Zone</c:v></c:pt><c:pt idx="2"><c:v>Zone</c:v></c:pt></c:lvl><c:lvl><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="2"><c:v>South</c:v></c:pt></c:lvl>'
  );
});
it("rejects hierarchy objects before evaluating a length accessor", () => {
  let reads = 0;
  const bad = {
    get length() {
      reads++;
      return 1;
    }
  };
  expect(() =>
    validateChartData(
      { categoryLevels: [bad], series: [{ name: "Units", values: [1] }] } as unknown as ChartData,
      "AREA"
    )
  ).toThrow();
  expect(reads).toBe(0);
});
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
it("creates and replaces date chart workbooks with the same explicit epoch as their caches", async () => {
  const volume = Volume.fromJSON({});
  const data = {
    categories: ["1904-01-01T00:00:00Z"],
    date1904: true,
    series: [{ name: "Days", values: [1] }]
  };
  volume.writeFileSync("/seed.pptx", await createPresentation({ slides: [{}] }, context));
  const source = await addChart(
    new Uint8Array(volume.readFileSync("/seed.pptx") as Buffer),
    { slide: 1, type: "AREA", data, left: 0, top: 0, width: 914400, height: 914400 },
    context
  );
  for (const result of [source, await setCharts(source, { slide: 1 }, { data }, context)]) {
    const entries = inspectZip(result);
    const workbook = inspectZip(
      entries.find((entry) => entry.name === "ppt/embeddings/chart1.xlsx")!.payload
    );
    expect(
      new TextDecoder().decode(workbook.find((entry) => entry.name === "xl/workbook.xml")!.payload)
    ).toContain('date1904="1"');
    expect(
      new TextDecoder().decode(workbook.find((entry) => entry.name === "xl/styles.xml")!.payload)
    ).toContain('formatCode="yyyy-mm-dd"');
    expect(
      new TextDecoder().decode(
        workbook.find((entry) => entry.name === "xl/worksheets/sheet1.xml")!.payload
      )
    ).toContain('<c r="A2" s="1"><v>0</v></c>');
  }
});

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
it.each(families)(
  "replaces simple workbook data while preserving plot decoration for %s",
  async (type) => {
    const data = type.startsWith("BUBBLE")
      ? { series: [{ name: "First", xValues: [1], values: [2], bubbleSizes: [3] }] }
      : { categoryLevels: [["Group"], ["A"]], series: [{ name: "First", values: [2] }] };
    const source = await addChart(
      await createPresentation({ slides: [{}] }, context),
      { slide: 1, type, data, left: 0, top: 0, width: 914400, height: 914400 },
      context
    );
    const update = type.startsWith("BUBBLE")
      ? {
          series: [
            { name: "Last", xValues: [4], values: [5], bubbleSizes: [6] },
            { name: "New", xValues: [7], values: [8], bubbleSizes: [9] }
          ]
        }
      : { categoryLevels: [["Group"], ["B"]], series: [{ name: "Last", values: [5] }] };
    const changed = await setCharts(source, { slide: 1 }, { data: update }, context);
    const xml = new TextDecoder().decode(
      inspectZip(changed).find((entry) => entry.name === "ppt/charts/chart1.xml")!.payload
    );
    expect(xml).toContain('<c:pt idx="0"><c:v>Last</c:v></c:pt>');
    expect(xml).toContain('<c:pt idx="0"><c:v>5</c:v></c:pt>');
    if (type === "DOUGHNUT_EXPLODED") expect(xml).toContain('<c:explosion val="25"/>');
    if (type === "BUBBLE_THREE_D_EFFECT")
      expect(xml.split('<c:bubble3D val="1"/>')).toHaveLength(3);
    if (type.startsWith("BUBBLE"))
      expect(xml).toContain("<c:bubbleSize><c:numRef><c:f>Sheet1!$F$2:$F$2</c:f>");
  }
);
