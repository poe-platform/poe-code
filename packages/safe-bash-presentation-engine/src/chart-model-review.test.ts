import { expect, it } from "vitest";
import { Chart } from "./chart-model.js";
import { parseXmlPart } from "./xml.js";
import { InvalidHandleError } from "./errors.js";
import { XL_LEGEND_POSITION, XL_TICK_MARK } from "./chart-enums.js";
function chart(body: string, strict = false) {
  const ns = strict
    ? "http://purl.oclc.org/ooxml/drawingml/chart"
    : "http://schemas.openxmlformats.org/drawingml/2006/chart";
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<c:chartSpace xmlns:c="${ns}"><c:chart>${body}</c:chart></c:chartSpace>`
    ),
    { maxBytes: 50000, maxNodes: 1000, maxDepth: 40 }
  );
  return {
    model: new Chart(
      () => xml,
      (next) => {
        xml = next;
      }
    ),
    xml: () => xml
  };
}
it.each([false, true])(
  "reuses fill choice semantics for chart-owned colors strict=%s",
  (strict) => {
    const { model } = chart(
      '<c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/></c:ser></c:barChart></c:plotArea>',
      strict
    );
    const fill = model.series.at(0).format.fill;
    fill.solid();
    expect(fill.type).toBe(1);
    fill.background();
    expect(fill.type).toBe(5);
    void model.series.at(0).format.line.color.brightness;
    expect(model.series.at(0).format.line.fill.type).toBe(1);
  }
);
it("rejects duplicate numeric cache indexes rather than selecting the last payload", () => {
  const { model } = chart(
    '<c:plotArea><c:lineChart><c:ser><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="0"><c:v>9</c:v></c:pt></c:numLit></c:val></c:ser></c:lineChart></c:plotArea>'
  );
  expect(() => model.series.at(0).values).toThrow();
});
it("rejects duplicate category cache indexes rather than exposing ambiguous hierarchy", () => {
  const { model } = chart(
    '<c:plotArea><c:barChart><c:ser><c:cat><c:strLit><c:ptCount val="1"/><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="0"><c:v>South</c:v></c:pt></c:strLit></c:cat></c:ser></c:barChart></c:plotArea>'
  );
  expect(() => [...model.plots.at(0).categories]).toThrow();
});
it("keeps a deleted series handle invalid after another series moves into its index", () => {
  const { model } = chart(
    '<c:plotArea><c:lineChart><c:ser><c:idx val="7"/><c:tx><c:v>first</c:v></c:tx></c:ser><c:ser><c:idx val="12"/><c:tx><c:v>second</c:v></c:tx></c:ser></c:lineChart></c:plotArea>'
  );
  const first = model.series.at(0);
  const root = model.element;
  const chartNode = root.children.find((n) => n.tag.localName === "chart")!;
  const plot = chartNode.children.find((n) => n.tag.localName === "plotArea")!.children[0]!;
  plot.remove(plot.children[0]!);
  expect(() => first.name).toThrow(InvalidHandleError);
});
it("keeps bounded gradient stop XML writable through a chart owner", () => {
  const { model } = chart("<c:plotArea><c:lineChart><c:ser/></c:lineChart></c:plotArea>");
  const fill = model.series.at(0).format.fill;
  fill.gradient();
  const stop = fill.gradient_stops.at(0);
  stop.element.set({ namespace: "", localName: "pos" }, "30000");
  expect(stop.position).toBe(0.3);
});
it.each([false, true])(
  "reads noncreating defaults and roundtrips chart title text strict=%s",
  (strict) => {
    const { model, xml } = chart(
      '<c:plotArea><c:lineChart/><c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:legend/>',
      strict
    );
    const before = xml().bytes();
    expect(model.category_axis.major_tick_mark).toBe(XL_TICK_MARK.NONE);
    expect(model.legend!.position).toBe(XL_LEGEND_POSITION.RIGHT);
    expect(model.has_title).toBe(false);
    expect(xml().bytes()).toEqual(before);
    model.chart_title.text_frame.text = "Quarter & outlook";
    expect(model.chart_title.text_frame.text).toBe("Quarter & outlook");
  }
);

it("retains category equality for inherited collection membership and sparse hierarchy traversal", () => {
  const { model } = chart(
    '<c:plotArea><c:barChart><c:ser><c:cat><c:multiLvlStrRef><c:multiLvlStrCache><c:ptCount val="3"/><c:lvl><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt><c:pt idx="2"><c:v>C</c:v></c:pt></c:lvl><c:lvl><c:pt idx="0"><c:v>East</c:v></c:pt><c:pt idx="2"><c:v>West</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat></c:ser></c:barChart></c:plotArea>'
  );
  const categories = model.plots.at(0).categories;
  expect(categories.depth).toBe(2);
  expect(categories.flattened_labels).toEqual([
    ["East", "A"],
    ["East", "B"],
    ["West", "C"]
  ]);
  const leaf = categories.at(1);
  expect(categories.includes(leaf)).toBe(true);
  expect(categories.count(leaf)).toBe(1);
  expect(categories.index(leaf)).toBe(1);
  const level = categories.levels[0]!;
  expect(level.includes(level.at(0))).toBe(true);
});
it("exposes numeric chart collection indexing as the documented JS sequence protocol", () => {
  const { model } = chart(
    '<c:plotArea><c:lineChart><c:ser><c:idx val="0"/></c:ser></c:lineChart></c:plotArea>'
  );
  const collection = model.series;
  expect(Reflect.get(collection, "0")?.equals(collection.at(0))).toBe(true);
});
