import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
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
