import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { addChart, setCharts, type ChartData, type CreatableChartType } from "./chart-editing.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

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
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const category = { categories: ["Harbor", "Ridge"], series: [{ name: "Samples", values: [2, 4] }] };
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function seed(type: CreatableChartType = "COLUMN_CLUSTERED", data: ChartData = category) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/seed.pptx", await createPresentation({ slides: [{}] }, context));
  return addChart(
    new Uint8Array(fs.readFileSync("/seed.pptx") as Buffer),
    {
      slide: 1,
      type,
      data,
      left: 0,
      top: 0,
      width: 914400,
      height: 914400
    },
    context
  );
}
function patch(bytes: Uint8Array, chart: (xml: string) => string, sheet?: string) {
  return storedArchive(
    inspectZip(bytes).map((entry) => ({
      name: entry.name,
      bytes: entry.name.endsWith("chart1.xml")
        ? encode(chart(decode(entry.payload)))
        : entry.name.endsWith(".xlsx") && sheet
          ? storedArchive(
              inspectZip(entry.payload).map((part) => ({
                name: part.name,
                bytes: part.name.endsWith("sheet1.xml") ? encode(sheet) : part.payload
              }))
            )
          : entry.payload
    }))
  );
}
function outputs(bytes: Uint8Array) {
  const entries = inspectZip(bytes);
  return {
    chart: decode(entries.find((entry) => entry.name.endsWith("chart1.xml"))!.payload),
    sheet: decode(
      inspectZip(entries.find((entry) => entry.name.endsWith(".xlsx"))!.payload).find((entry) =>
        entry.name.endsWith("sheet1.xml")
      )!.payload
    )
  };
}
it.each(["XY_SCATTER", "BUBBLE"] as const)(
  "rewrites vertically stacked simple %s series",
  async (type) => {
    const bubble = type === "BUBBLE";
    const data = {
      series: [
        { name: "Low", xValues: [3], values: [5], ...(bubble ? { bubbleSizes: [0] } : {}) },
        { name: "High", xValues: [7], values: [9], ...(bubble ? { bubbleSizes: [2] } : {}) }
      ]
    };
    const source = patch(
      await seed(type, data),
      (xml) => {
        for (const [from, to] of bubble
          ? [
              ["$D$2:$D$2", "$A$5:$A$5"],
              ["$E$2:$E$2", "$B$5:$B$5"],
              ["$F$2:$F$2", "$C$5:$C$5"],
              ["$E$1", "$B$4"]
            ]
          : [
              ["$C$2:$C$2", "$A$5:$A$5"],
              ["$D$2:$D$2", "$B$5:$B$5"],
              ["$D$1", "$B$4"]
            ])
          xml = xml.replaceAll(from!, to!);
        return xml;
      },
      `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>Low</t></is></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>5</v></c>${bubble ? '<c r="C2"><v>0</v></c>' : ""}</row><row r="4"><c r="B4" t="inlineStr"><is><t>High</t></is></c></row><row r="5"><c r="A5"><v>7</v></c><c r="B5"><v>9</v></c>${bubble ? '<c r="C5"><v>2</v></c>' : ""}</row></sheetData></worksheet>`
    );
    const next = outputs(await setCharts(source, { slide: 1 }, { data }, context));
    expect(next.chart).toContain(bubble ? "Sheet1!$E$2:$E$2" : "Sheet1!$D$2:$D$2");
    expect(next.sheet).toContain(bubble ? '<c r="E2"><v>9</v></c>' : '<c r="D2"><v>9</v></c>');
    expect(next.sheet).not.toContain('r="A5"');
  }
);
it("accepts quoted direct relative references for a simple owned category sheet", async () => {
  const source = patch(await seed(), (xml) =>
    xml.replaceAll("Sheet1!", "'Sheet1'!").replaceAll("$", "")
  );
  const next = outputs(await setCharts(source, { slide: 1 }, { data: category }, context));
  expect(next.chart).toContain("Sheet1!$B$2:$B$3");
});
it("rejects unrelated worksheet values before replacement can erase them", async () => {
  const bytes = await seed();
  const sheet = outputs(bytes).sheet.replace(
    "</sheetData>",
    '<row r="8"><c r="H8" t="inlineStr"><is><t>Keep this note</t></is></c></row></sheetData>'
  );
  const source = patch(bytes, (xml) => xml, sheet);
  const snapshot = source.slice();
  await expect(
    setCharts(source, { slide: 1 }, { data: category }, context).then(() => "published")
  ).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(source).toEqual(snapshot);
});
it("rejects dependent title formulas before canonicalizing chart ranges", async () => {
  const source = patch(await seed(), (xml) =>
    xml.replace(
      '<c:autoTitleDeleted val="1"/>',
      '<c:title><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Samples</c:v></c:pt></c:strCache></c:strRef></c:tx></c:title>'
    )
  );
  await expect(
    setCharts(source, { slide: 1 }, { data: category }, context).then(() => "published")
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects a chart epoch that disagrees with its workbook", async () => {
  const source = patch(await seed(), (xml) =>
    xml.replace("<c:chart>", '<c:date1904 val="1"/><c:chart>')
  );
  await expect(
    setCharts(source, { slide: 1 }, { data: category }, context).then(() => "published")
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("allocates unique series identities when growing imported series", async () => {
  const source = patch(await seed(), (xml) => xml.replace('<c:idx val="0"/>', '<c:idx val="1"/>'));
  const next = outputs(
    await setCharts(
      source,
      { slide: 1 },
      {
        data: {
          categories: ["One"],
          series: [
            { name: "Retained", values: [1] },
            { name: "Added", values: [2] }
          ]
        }
      },
      context
    )
  );
  const xml = parseXmlPart(encode(next.chart), context.xmlLimits);
  const ids: string[] = [];
  function visit(node: XmlElement) {
    if (node.name.localName === "idx")
      ids.push(node.attributes.find((a) => a.name.localName === "val")!.value);
    node.children.forEach(visit);
  }
  visit(xml.root);
  expect(ids).toEqual(["1", "2"]);
});

it.each([
  "BAR_CLUSTERED",
  "BUBBLE",
  "BUBBLE_THREE_D_EFFECT",
  "XY_SCATTER",
  "XY_SCATTER_LINES",
  "XY_SCATTER_LINES_NO_MARKERS",
  "XY_SCATTER_SMOOTH",
  "XY_SCATTER_SMOOTH_NO_MARKERS"
] as const)("synchronizes growing, same-size, and shrinking datasets for %s", async (type) => {
  const scatter = type !== "BAR_CLUSTERED";
  const bubble = type.startsWith("BUBBLE");
  const data = (count: number): ChartData => ({
    ...(!scatter ? { categories: ["Sound", null] } : {}),
    series: Array.from({ length: count }, (_, index) => ({
      name: `Measure ${index}`,
      values: [index, null],
      ...(scatter ? { xValues: [7, -1] } : {}),
      ...(bubble ? { bubbleSizes: [0, 2] } : {})
    }))
  });
  let bytes = await seed(type, data(2));
  for (const count of [3, 3, 1]) {
    bytes = await setCharts(bytes, { slide: 1 }, { data: data(count) }, context);
    const result = outputs(bytes);
    const tree = parseXmlPart(encode(result.chart), context.xmlLimits).root;
    const plotArea = tree.children
      .find((node) => node.name.localName === "chart")!
      .children.find((node) => node.name.localName === "plotArea")!;
    expect(
      plotArea.children
        .flatMap((node) => node.children)
        .filter((node) => node.name.localName === "ser")
    ).toHaveLength(count);
    expect(result.chart).toContain(`<c:v>Measure ${count - 1}</c:v>`);
    expect(result.sheet).toContain(`>Measure ${count - 1}</t>`);
    expect(result.chart).not.toContain(`<c:v>Measure ${count}</c:v>`);
    expect(result.sheet).not.toContain(`>Measure ${count}</t>`);
    expect(result.chart).toContain('<c:ptCount val="2"/>');
    expect(result.chart).toContain('<c:pt idx="0"><c:v>0</c:v></c:pt>');
    expect(result.sheet).not.toContain("<v>null</v>");
  }
});
it.each([
  ["1899-12-31T00:00:00Z", false, 0],
  ["1900-02-28T00:00:00Z", false, 59],
  ["1900-03-01T00:00:00Z", false, 61],
  ["1904-01-01T00:00:00Z", true, 0],
  ["2016-12-22T00:00:00Z", false, 42726],
  ["1999-12-31T00:00:00Z", true, 35063],
  ["1990-09-01T00:00:00Z", true, 31655]
] as const)(
  "keeps date %s in epoch %s consistent through worksheet and cache replacement",
  async (date, date1904, serial) => {
    const data = { categories: [date], date1904, series: [{ name: "Day", values: [0] }] };
    const source = await seed("COLUMN_CLUSTERED", data);
    for (const bytes of [source, await setCharts(source, { slide: 1 }, { data }, context)]) {
      const result = outputs(bytes);
      expect(result.chart).toContain(`<c:pt idx="0"><c:v>${serial}</c:v></c:pt>`);
      expect(result.sheet).toContain(`<c r="A2" s="1"><v>${serial}</v></c>`);
      expect(result.chart).toContain("<c:formatCode>yyyy-mm-dd</c:formatCode>");
    }
  }
);

it.each(["synchronize-simple", "reject-complex"])(
  "publishes consistent data through CLI policy %s and preserves dry-run destinations",
  async (policy) => {
    const source = await seed();
    const fs = Volume.fromJSON({ "/deck.pptx": Buffer.from(source), "/result.pptx": "retained" });
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 32768,
      maxOutputBytes: 524288
    });
    const data = { categories: ["Replacement"], series: [{ name: "Readings", values: [8] }] };
    const args = [
      "charts",
      "replace",
      "/deck.pptx",
      "--slide",
      "1",
      "--data",
      JSON.stringify(data),
      "--workbook-policy",
      policy,
      "--output",
      "/result.pptx",
      "--force",
      "--json"
    ];
    const publishOutput = vi.fn(
      async (output: { outputPath: string; bytes: Uint8Array; dryRun: boolean }) => {
        if (!output.dryRun) fs.writeFileSync(output.outputPath, output.bytes);
      }
    );
    const run = (extra: string[]) =>
      engine.execute({
        args: [...args, ...extra].map(encode),
        signal: new AbortController().signal,
        readInput: async (path) => new Uint8Array(fs.readFileSync(path) as Buffer),
        publishOutput
      });
    expect((await run(["--dry-run"])).exitCode).toBe(0);
    expect(publishOutput).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true }));
    publishOutput.mockClear();
    expect(fs.readFileSync("/result.pptx", "utf8")).toBe("retained");
    const result = await run([]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      version: 1,
      operation: "charts.replace",
      ok: true,
      affected: 1,
      errors: []
    });
    const output = outputs(new Uint8Array(fs.readFileSync("/result.pptx") as Buffer));
    expect(output.chart).toContain("Sheet1!$B$2:$B$2");
    expect(output.sheet).toContain('<c r="B2"><v>8</v></c>');
    expect(publishOutput).toHaveBeenCalledTimes(1);
    fs.writeFileSync(
      "/deck.pptx",
      patch(source, (xml) => xml.replace("Sheet1!$B$2:$B$3", "SUM(Sheet1!$B$2:$B$3)"))
    );
    const snapshot = fs.readFileSync("/result.pptx");
    const failed = await run([]);
    expect(failed.exitCode).toBe(1);
    expect(JSON.parse(decode(failed.stdout))).toMatchObject({ ok: false, affected: 0, data: null });
    expect(publishOutput).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync("/result.pptx")).toEqual(snapshot);
  }
);

it.each([
  ["BAR_CLUSTERED", 2, 2, 3, 3],
  ["BAR_STACKED_100", 2, 2, 3, 3],
  ["COLUMN_CLUSTERED", 2, 2, 3, 3],
  ["LINE", 4, 3, 3, 2],
  ["PIE", 3, 1, 5, 1],
  ["XY_SCATTER", 3, 2, 3, 3],
  ["BUBBLE", 3, 2, 3, 3]
] as const)(
  "replaces %s dimensions %sx%s with %sx%s",
  async (type, oldPoints, oldSeries, points, series) => {
    const dataset = (pointCount: number, seriesCount: number, prefix: string): ChartData => ({
      ...(!["XY_SCATTER", "BUBBLE"].includes(type)
        ? {
            categories: Array.from(
              { length: pointCount },
              (_, index) => `${prefix} station ${index}`
            )
          }
        : {}),
      series: Array.from({ length: seriesCount }, (_, index) => ({
        name: `${prefix} measure ${index}`,
        values: Array.from({ length: pointCount }, (_, point) => index + point),
        ...(["XY_SCATTER", "BUBBLE"].includes(type)
          ? { xValues: Array.from({ length: pointCount }, (_, point) => point * 2) }
          : {}),
        ...(type === "BUBBLE"
          ? { bubbleSizes: Array.from({ length: pointCount }, (_, point) => point) }
          : {})
      }))
    });
    const source = await seed(type, dataset(oldPoints, oldSeries, "Old"));
    const result = outputs(
      await setCharts(source, { slide: 1 }, { data: dataset(points, series, "New") }, context)
    );
    expect(result.chart).not.toContain("Old measure");
    expect(result.sheet).not.toContain("Old measure");
    for (let index = 0; index < series; index++) {
      expect(result.chart).toContain(`<c:v>New measure ${index}</c:v>`);
      expect(result.sheet).toContain(`>New measure ${index}</t>`);
    }
    expect(result.chart).toContain(`<c:ptCount val="${points}"/>`);
    expect(result.chart).toContain(`$${points + 1}</c:f>`);
    expect(result.sheet).toContain(`<row r="${points + 1}">`);
    expect(result.sheet).not.toContain(`<row r="${points + 2}">`);
  }
);

it("trims series by declared display order while preserving surviving identities", async () => {
  const data = {
    categories: ["One"],
    series: [
      { name: "Later", values: [4] },
      { name: "Earlier", values: [2] }
    ]
  };
  const source = patch(await seed("COLUMN_CLUSTERED", data), (xml) =>
    xml
      .replace('<c:idx val="0"/><c:order val="0"/>', '<c:idx val="3"/><c:order val="4"/>')
      .replace('<c:idx val="1"/><c:order val="1"/>', '<c:idx val="1"/><c:order val="2"/>')
  );
  const next = outputs(
    await setCharts(
      source,
      { slide: 1 },
      { data: { categories: ["New"], series: [{ name: "Kept", values: [8] }] } },
      context
    )
  );
  expect(next.chart).toContain('<c:idx val="1"/><c:order val="2"/>');
  expect(next.chart).not.toContain('<c:idx val="3"/>');
  expect(next.chart).toContain("Sheet1!$B$2:$B$2");
  expect(next.sheet).toContain('<c r="B2"><v>8</v></c>');
});

it("replaces string categories with unsorted numeric labels while retaining series decoration", async () => {
  const source = patch(await seed(), (xml) =>
    xml.replace(
      '<c:idx val="0"/><c:order val="0"/>',
      '<c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="246810"/></a:solidFill></c:spPr>'
    )
  );
  const next = outputs(
    await setCharts(
      source,
      { slide: 1 },
      { data: { categories: [42, 24], series: [{ name: "Numeric", values: [7, -2] }] } },
      context
    )
  );
  expect(next.chart).toContain("<c:numRef><c:f>Sheet1!$A$2:$A$3</c:f><c:numCache>");
  expect(next.chart).toContain(
    '<c:pt idx="0"><c:v>42</c:v></c:pt><c:pt idx="1"><c:v>24</c:v></c:pt>'
  );
  expect(next.chart).toContain('<a:srgbClr val="246810"/>');
  expect(next.sheet).toContain('<c r="A2"><v>42</v></c>');
  expect(next.sheet).toContain('<c r="A3"><v>24</v></c>');
  expect(next.sheet).toContain('<c r="B3"><v>-2</v></c>');
});
