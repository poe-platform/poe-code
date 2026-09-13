import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Chart } from "./chart-model.js";
import { applyChartFontUpdate, validateChartFontUpdate } from "./chart-font-operations.js";
import { parseXmlPart } from "./xml.js";
function fixture() {
  const volume = Volume.fromJSON({});
  let xml = parseXmlPart(
    new TextEncoder().encode(
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:lineChart><c:ser><c:idx val="0"/><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>3</c:v></c:pt></c:numLit></c:val></c:ser><c:dLbls/></c:lineChart><c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx></c:plotArea><c:legend/></c:chart></c:chartSpace>'
    ),
    { maxBytes: 50000, maxNodes: 1000, maxDepth: 40 }
  );
  const chart = new Chart(
    () => xml,
    (next) => {
      xml = next;
      volume.writeFileSync("/chart.xml", next.bytes());
    }
  );
  return { chart, read: () => xml, volume };
}
it.each([
  "chart",
  "legend",
  "title",
  "categoryAxisTitle",
  "valueAxisTitle",
  "categoryTickLabels",
  "valueTickLabels",
  "dataLabels",
  "dataLabel"
] as const)("applies inherited font fields to %s through the model", (owner) => {
  const { chart, read } = fixture();
  const selectors =
    owner === "dataLabels" ? { plot: 0 } : owner === "dataLabel" ? { series: 0, point: 0 } : {};
  applyChartFontUpdate(chart, {
    owner,
    ...selectors,
    bold: true,
    italic: false,
    name: "Aptos",
    size: { value: 18, unit: "pt" },
    underline: "DOUBLE_LINE",
    languageId: "POLISH",
    color: { theme: "accent2", brightness: 0.25 }
  });
  const markup = read().markup(read().root);
  for (const token of [
    'b="1"',
    'i="0"',
    'sz="1800"',
    'u="dbl"',
    'lang="pl-PL"',
    'typeface="Aptos"',
    'val="accent2"',
    'lumOff val="25000"'
  ])
    expect(markup).toContain(token);
});
it("persists arbitrary gradient stops and clears inherited font declarations in memfs", () => {
  const { chart, read, volume } = fixture();
  applyChartFontUpdate(chart, {
    owner: "chart",
    bold: true,
    size: { value: 12, unit: "pt" },
    fill: {
      kind: "gradient",
      angle: 15,
      stops: [
        { position: 0, color: "000000" },
        { position: 0.4, color: "ABABAB" },
        { position: 1, color: "FFFFFF" }
      ]
    }
  });
  expect(chart.font.fill.gradient_stops.length).toBe(3);
  applyChartFontUpdate(chart, {
    owner: "chart",
    bold: null,
    size: null,
    languageId: null,
    underline: null
  });
  expect(chart.font.bold).toBeNull();
  expect(chart.font.size).toBeNull();
  expect(new Uint8Array(volume.readFileSync("/chart.xml") as Buffer)).toEqual(read().bytes());
});
it.each([
  { owner: "chart", size: { value: 0, unit: "pt" } },
  { owner: "chart", bold: "true" },
  { owner: "legend", plot: 0, bold: true },
  { owner: "dataLabels", bold: true },
  { owner: "dataLabel", series: 0, bold: true },
  { owner: "chart", underline: "MIXED" },
  { owner: "chart", languageId: "MIXED" },
  { owner: "chart", name: "" },
  { owner: "chart", color: "000000", fill: { kind: "none" } },
  { owner: "chart" }
])("rejects invalid font update before creating model nodes %j", (update) => {
  const { chart, read } = fixture(),
    before = read().bytes();
  expect(() => applyChartFontUpdate(chart, update as never)).toThrow();
  expect(read().bytes()).toEqual(before);
});
it("rejects nested accessors without calling user code", () => {
  let invoked = false;
  const size = Object.defineProperty({ unit: "pt" }, "value", {
    enumerable: true,
    get() {
      invoked = true;
      return 18;
    }
  });
  expect(() => validateChartFontUpdate({ owner: "chart", size })).toThrow();
  expect(invoked).toBe(false);
});

it("bounds malformed font nesting before any deep accessor can run", () => {
  let invoked = false;
  let nested: object = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    }
  });
  for (let depth = 0; depth < 100; depth++) nested = { child: nested };
  expect(() => validateChartFontUpdate({ owner: "chart", fill: nested })).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
  expect(invoked).toBe(false);
});
