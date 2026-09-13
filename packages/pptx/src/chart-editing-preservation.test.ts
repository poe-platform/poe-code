import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { addChart, setCharts } from "./chart-editing.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";

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
const data = { categories: ["First", "Last"], series: [{ name: "Count", values: [1, null] }] };
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function seed() {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/seed.pptx", await createPresentation({ slides: [{}] }, context));
  return addChart(
    new Uint8Array(volume.readFileSync("/seed.pptx") as Buffer),
    {
      slide: 1,
      type: "COLUMN_CLUSTERED",
      data,
      left: 0,
      top: 0,
      width: 914400,
      height: 914400,
      legend: true
    },
    context
  );
}
function chartBytes(bytes: Uint8Array) {
  return inspectZip(bytes).find((e) => e.name === "ppt/charts/chart1.xml")!.payload;
}
function patchChart(bytes: Uint8Array, change: (xml: string) => string) {
  return writePackageArchive(
    inspectZip(bytes).map((e) => ({
      name: e.name,
      bytes: e.name === "ppt/charts/chart1.xml" ? encode(change(decode(e.payload))) : e.payload
    })),
    context,
    { compression: "store" }
  );
}
it("rejects formula expressions instead of silently replacing their authority", async () => {
  const source = await patchChart(await seed(), (xml) =>
    xml.replace("Sheet1!$B$2:$B$3", "SUM(Sheet1!$B$2:$B$3)")
  );
  await expect(setCharts(source, { slide: 1 }, { data }, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
it("expands simple series with independent labels and synchronized cells", async () => {
  const bytes = await setCharts(
    await seed(),
    { slide: 1 },
    {
      data: {
        categories: ["Only"],
        series: [
          { name: "A", values: [2] },
          { name: "B", values: [4] }
        ]
      }
    },
    context
  );
  const xml = decode(chartBytes(bytes));
  expect(xml).toContain('<c:idx val="1"/><c:order val="1"/>');
  expect(xml).toContain("<c:f>Sheet1!$C$2:$C$2</c:f>");
  const book = inspectZip(bytes).find((e) => e.name.endsWith(".xlsx"))!;
  expect(
    decode(inspectZip(book.payload).find((e) => e.name === "xl/worksheets/sheet1.xml")!.payload)
  ).toContain('<c r="C2"><v>4</v></c>');
});
it("refuses shadowed fallback style edits without changing unknown choices", async () => {
  const source = await patchChart(await seed(), (xml) =>
    xml.replace(
      "<c:chart>",
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:unknown-chart-style"><mc:Choice Requires="u"><u:style val="110"/></mc:Choice><mc:Fallback><c:style val="2"/></mc:Fallback></mc:AlternateContent><c:chart>'
    )
  );
  await expect(setCharts(source, { slide: 1 }, { style: 7 }, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
it("enabling an existing legend preserves custom placement and formatting", async () => {
  const source = await patchChart(await seed(), (xml) =>
    xml
      .replace('<c:legendPos val="r"/>', '<c:legendPos val="b"/>')
      .replace(
        '<c:overlay val="0"/></c:legend>',
        '<c:overlay val="1"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1500"/></a:pPr></a:p></c:txPr></c:legend>'
      )
  );
  const changed = await setCharts(source, { slide: 1 }, { legend: true }, context);
  expect(chartBytes(changed)).toEqual(chartBytes(source));
});
it("rewrites only chart data and its workbook while preserving theme dependencies", async () => {
  const source = await seed();
  const changed = await setCharts(
    source,
    { slide: 1 },
    { data: { categories: ["Second", "First"], series: [{ name: "New", values: [null, 0] }] } },
    context
  );
  const entries = inspectZip(changed);
  for (const old of inspectZip(source).filter(
    (e) => e.name !== "ppt/charts/chart1.xml" && !e.name.endsWith(".xlsx")
  )) {
    expect(entries.find((e) => e.name === old.name)!.payload).toEqual(old.payload);
  }
  expect(decode(chartBytes(changed))).toContain(
    '<c:ptCount val="2"/><c:pt idx="1"><c:v>0</c:v></c:pt>'
  );
});

it.each([
  ["XY_SCATTER_SMOOTH", '<c:marker><c:symbol val="circle"/></c:marker>', '<c:smooth val="1"/>'],
  ["LINE_MARKERS", '<c:marker><c:symbol val="circle"/></c:marker>', '<c:smooth val="0"/>']
] as const)("new series retain the existing %s variant", async (type, marker, smooth) => {
  const scatter = type === "XY_SCATTER_SMOOTH";
  const d = scatter
    ? { series: [{ name: "A", xValues: [3], values: [5] }] }
    : { categories: ["A"], series: [{ name: "A", values: [5] }] };
  const source = await addChart(
    await createPresentation({ slides: [{}] }, context),
    { slide: 1, type, data: d, left: 0, top: 0, width: 914400, height: 914400 },
    context
  );
  const changed = await setCharts(
    source,
    { slide: 1 },
    { data: { ...d, series: [...d.series, { ...d.series[0]!, name: "B" }] } },
    context
  );
  const xml = decode(chartBytes(changed));
  const second = xml.slice(xml.indexOf('<c:idx val="1"/>'), xml.lastIndexOf("</c:ser>"));
  expect(second).toContain(marker);
  expect(second).toContain(smooth);
});
