import {
  chartNodeBinding,
  chartNode,
  chartDescendant,
  chartOptionalDescendant
} from "./chart-model-core.js";
import { sequenceSlice } from "./model-sequence.js";
import { XL_DATA_LABEL_POSITION, XL_MARKER_STYLE } from "./chart-enums.js";
import {
  ChartFormat,
  ChartNode,
  ChartSequence,
  booleanValue,
  numberValue,
  readBoolean,
  type ChartBinding
} from "./chart-model-core.js";
import { ChartTitle, TickLabels } from "./chart-model-axes.js";
import { InvalidHandleError, PropertyAccessError, ValueError } from "./errors.js";
import { attr, child } from "./masters.js";
import type { Chart } from "./chart-model.js";
import type { XmlElement, XmlPart } from "./xml.js";
export class DataLabels extends TickLabels {
  get position(): XL_DATA_LABEL_POSITION | null {
    const value = this.scalar("dLblPos");
    return value === null ? null : XL_DATA_LABEL_POSITION.from_xml(value);
  }
  set position(value: XL_DATA_LABEL_POSITION | null) {
    this.setScalar("dLblPos", value === null ? null : XL_DATA_LABEL_POSITION.to_xml(value));
  }
  get show_category_name() {
    return readBoolean(child(chartNode(this), "showCatName"), false);
  }
  set show_category_name(value: boolean) {
    booleanValue(value);
    this.setScalar("showCatName", value);
  }
  get show_legend_key() {
    return readBoolean(child(chartNode(this), "showLegendKey"), false);
  }
  set show_legend_key(value: boolean) {
    booleanValue(value);
    this.setScalar("showLegendKey", value);
  }
  get show_percentage() {
    return readBoolean(child(chartNode(this), "showPercent"), false);
  }
  set show_percentage(value: boolean) {
    booleanValue(value);
    this.setScalar("showPercent", value);
  }
  get show_series_name() {
    return readBoolean(child(chartNode(this), "showSerName"), false);
  }
  set show_series_name(value: boolean) {
    booleanValue(value);
    this.setScalar("showSerName", value);
  }
  get show_value() {
    return readBoolean(child(chartNode(this), "showVal"), false);
  }
  set show_value(value: boolean) {
    booleanValue(value);
    this.setScalar("showVal", value);
  }
}
export class DataLabel extends ChartTitle {
  get font() {
    return this.textFrame().paragraphs[0]!.font;
  }
  get position(): XL_DATA_LABEL_POSITION | null {
    const value = this.scalar("dLblPos");
    return value === null ? null : XL_DATA_LABEL_POSITION.from_xml(value);
  }
  set position(value: XL_DATA_LABEL_POSITION | null) {
    this.setScalar("dLblPos", value === null ? null : XL_DATA_LABEL_POSITION.to_xml(value));
  }
}
export class Marker extends ChartNode {
  get size(): number | null {
    const marker = child(chartNode(this), "marker"),
      size = marker && child(marker, "size");
    return size ? Number(attr(size, "val")) : null;
  }
  set size(value: number | null) {
    if (value !== null) numberValue(value, 2, 72, true);
    new MarkerProperties(chartDescendant(this, "marker", true)).size = value;
  }
  get style(): XL_MARKER_STYLE | null {
    const marker = child(chartNode(this), "marker"),
      symbol = marker && child(marker, "symbol");
    return symbol ? XL_MARKER_STYLE.from_xml(attr(symbol, "val") ?? "auto") : null;
  }
  set style(value: XL_MARKER_STYLE | null) {
    const token = value === null ? null : XL_MARKER_STYLE.to_xml(value);
    new MarkerProperties(chartDescendant(this, "marker", true)).style = token;
  }
  override get format(): ChartFormat {
    return new ChartFormat(chartDescendant(this, "marker", true));
  }
}
class MarkerProperties extends ChartNode {
  set size(value: number | null) {
    this.setScalar("size", value);
  }
  set style(value: string | null) {
    this.setScalar("symbol", value);
  }
}
function indexed(parent: ChartBinding, name: string, index: number, create: boolean): ChartBinding {
  const locate = (xml: XmlPart) =>
    parent
      .locate(xml)
      .children.find(
        (node) =>
          node.name.namespace === parent.locate(xml).name.namespace &&
          node.name.localName === name &&
          attr(child(node, "idx") ?? node, "val") === String(index)
      );
  if (create) parent.prepare?.();
  if (create && !locate(parent.read())) {
    const xml = parent.read(),
      node = parent.locate(xml),
      ns = node.name.namespace;
    const next = node.children.findIndex(
      (n) =>
        n.name.namespace === ns &&
        ((n.name.localName === name && Number(attr(child(n, "idx") ?? n, "val")) > index) ||
          [
            "dLbls",
            "trendline",
            "errBars",
            "cat",
            "val",
            "xVal",
            "yVal",
            "bubbleSize",
            "smooth",
            "bubble3D",
            "extLst"
          ].includes(n.name.localName))
    );
    parent.write(
      xml.spliceChildren(node, next < 0 ? node.children.length : next, 0, [
        `<c:${name} xmlns:c="${ns}"><c:idx val="${index}"/></c:${name}>`
      ])
    );
  }
  return {
    read: parent.read,
    write: parent.write,
    track: parent.track,
    locate: (xml) => {
      const found = locate(xml);
      if (!found) throw new InvalidHandleError();
      return found;
    }
  };
}
function deferredIndexed(parent: ChartBinding, name: string, index: number): ChartBinding {
  const virtual: XmlElement = {
    name: { namespace: parent.locate(parent.read()).name.namespace, localName: name },
    attributes: [],
    children: []
  };
  let materialized = false;
  const locate = (xml: XmlPart) => {
    const root = parent.locate(xml),
      node = root.children.find(
        (n) =>
          n.name.namespace === root.name.namespace &&
          n.name.localName === name &&
          attr(child(n, "idx") ?? n, "val") === String(index)
      );
    if (node) {
      materialized = true;
      return node;
    }
    if (materialized) throw new InvalidHandleError();
    return virtual;
  };
  return {
    read: parent.read,
    write: parent.write,
    track: parent.track,
    locate,
    prepare: () => {
      indexed(parent, name, index, true);
    }
  };
}
export class Point extends ChartNode {
  readonly #index: number;
  constructor(binding: ChartBinding, index: number) {
    super(binding);
    this.#index = index;
  }
  override get format(): ChartFormat {
    return new ChartFormat(indexed(chartNodeBinding(this), "dPt", this.#index, true));
  }
  get marker() {
    return new Marker(deferredIndexed(chartNodeBinding(this), "dPt", this.#index));
  }
  get data_label() {
    return new DataLabel(
      deferredIndexed(chartOptionalDescendant(this, "dLbls"), "dLbl", this.#index)
    );
  }
  override equals(other: unknown): boolean {
    return other instanceof Point && this.#index === other.#index && super.equals(other);
  }
}
export function cacheValues(
  xml: XmlPart,
  series: XmlElement,
  channel: string
): readonly (number | null)[] {
  const root = child(series, channel);
  if (!root) return [];
  const ref = child(root, "numRef"),
    cache = ref ? child(ref, "numCache") : child(root, "numLit");
  if (!cache) return [];
  const count = child(cache, "ptCount");
  const points = cache.children.filter(
    (n) => n.name.namespace === cache.name.namespace && n.name.localName === "pt"
  );
  const length = count
    ? Number(attr(count, "val"))
    : Math.max(0, ...points.map((n) => Number(attr(n, "idx")) + 1));
  if (!Number.isInteger(length) || length < 0 || length > 250000)
    throw new ValueError("Invalid chart cache size.");
  const values: (number | null)[] = Array.from({ length }, () => null);
  const indexes = new Set<number>();
  for (const point of points) {
    const idx = Number(attr(point, "idx")),
      v = child(point, "v"),
      text = v && xml.text(v);
    if (!Number.isInteger(idx) || idx < 0 || idx >= length || indexes.has(idx))
      throw new ValueError("Invalid chart point index.");
    indexes.add(idx);
    if (text !== null && text !== undefined && text !== "") {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ValueError("Invalid chart point value.");
      values[idx] = value;
    }
  }
  return Object.freeze(values);
}
export class BaseSeries extends ChartNode {
  get index(): number {
    return Number(this.scalar("idx") ?? 0);
  }
  get name(): string {
    const tx = child(chartNode(this), "tx");
    if (!tx) return "";
    const xml = chartNodeBinding(this).read();
    const direct = child(tx, "v");
    if (direct) return xml.text(direct) ?? "";
    const ref = child(tx, "strRef"),
      cache = ref && child(ref, "strCache"),
      pt = cache && child(cache, "pt"),
      v = pt && child(pt, "v");
    return v ? (xml.text(v) ?? "") : "";
  }
}
export class Series extends BaseSeries {
  get values(): readonly (number | null)[] {
    const binding = chartNodeBinding(this),
      xml = binding.read(),
      node = binding.locate(xml);
    return cacheValues(xml, node, child(node, "yVal") ? "yVal" : "val");
  }
  get points(): ChartSequence<Point> {
    const binding = chartNodeBinding(this);
    return new ChartSequence(() => this.values.map((_, index) => new Point(binding, index)), false);
  }
}
export class CategorySeries extends Series {
  get data_labels(): DataLabels {
    return new DataLabels(chartDescendant(this, "dLbls", true));
  }
}
export class AreaSeries extends CategorySeries {}
export class PieSeries extends CategorySeries {}
export class BarSeries extends CategorySeries {
  get invert_if_negative(): boolean {
    return readBoolean(child(chartNode(this), "invertIfNegative"), true);
  }
  set invert_if_negative(value: boolean) {
    booleanValue(value);
    this.setScalar("invertIfNegative", value);
  }
}
export class RadarSeries extends CategorySeries {
  get marker() {
    return new Marker(chartNodeBinding(this));
  }
}
export class LineSeries extends RadarSeries {
  get smooth(): boolean {
    return readBoolean(child(chartNode(this), "smooth"), false);
  }
  set smooth(value: boolean) {
    booleanValue(value);
    this.setScalar("smooth", value);
  }
}
export class XySeries extends Series {
  get marker() {
    return new Marker(chartNodeBinding(this));
  }
  *iter_values() {
    yield* this.values;
  }
}
export class BubbleSeries extends XySeries {}
export function seriesFor(binding: ChartBinding, plotName: string): Series {
  const classes: Record<string, new (binding: ChartBinding) => Series> = {
    areaChart: AreaSeries,
    area3DChart: AreaSeries,
    barChart: BarSeries,
    bar3DChart: BarSeries,
    bubbleChart: BubbleSeries,
    doughnutChart: PieSeries,
    lineChart: LineSeries,
    line3DChart: LineSeries,
    pieChart: PieSeries,
    pie3DChart: PieSeries,
    ofPieChart: PieSeries,
    radarChart: RadarSeries,
    scatterChart: XySeries,
    stockChart: LineSeries,
    surfaceChart: Series,
    surface3DChart: Series
  };
  return new (classes[plotName] ?? Series)(binding);
}
export class SeriesCollection extends ChartSequence<Series> {}
export class Category {
  readonly idx: number;
  readonly label: string;
  constructor(idx: number, label: string) {
    this.idx = idx;
    this.label = label;
    Object.freeze(this);
  }
  toString() {
    return this.label;
  }
  equals(other: unknown) {
    return this.label === (other instanceof Category ? other.label : other);
  }
}
export class CategoryLevel extends ChartSequence<Category> {
  constructor(read: () => readonly Category[]) {
    super(read, true, (a, b) => a.equals(b));
  }
}
export class Categories extends ChartSequence<Category> {
  readonly #levels: () => readonly CategoryLevel[];
  constructor(levels: () => readonly CategoryLevel[]) {
    super(
      () => [...(levels()[0] ?? [])],
      true,
      (a, b) => a.equals(b)
    );
    this.#levels = levels;
  }
  get depth() {
    return this.#levels().length;
  }
  get levels() {
    return this.#levels();
  }
  get flattened_labels(): readonly (readonly string[])[] {
    const levels = this.#levels();
    if (!levels.length) return [];
    return Object.freeze(
      [...levels[0]!].map((leaf) =>
        Object.freeze(
          [...levels]
            .reverse()
            .map((level) => [...level].filter((item) => item.idx <= leaf.idx).at(-1)?.label ?? "")
        )
      )
    );
  }
}
export class BasePlot extends ChartNode {
  readonly #chart: Chart;
  constructor(binding: ChartBinding, chart: Chart) {
    super(binding);
    this.#chart = chart;
  }
  get chart(): Chart {
    void chartNode(this);
    return this.#chart;
  }
  get series(): SeriesCollection {
    const binding = chartNodeBinding(this);
    return new SeriesCollection(() => {
      const xml = binding.read(),
        node = binding.locate(xml);
      return node.children
        .filter((n) => n.name.namespace === node.name.namespace && n.name.localName === "ser")
        .map((original, index) =>
          seriesFor(
            {
              read: binding.read,
              write: binding.write,
              track: binding.track,
              locate: (doc) => {
                const parent = binding.locate(doc),
                  found = parent.children.filter(
                    (n) => n.name.namespace === parent.name.namespace && n.name.localName === "ser"
                  )[index];
                if (!found) throw new InvalidHandleError();
                const signature = (part: XmlPart, ser: XmlElement) =>
                  ["idx", "order", "cat", "val", "xVal", "yVal", "bubbleSize"].map((name) => {
                    const value = child(ser, name);
                    return value ? part.markup(value) : null;
                  });
                if (
                  JSON.stringify(signature(doc, found)) !== JSON.stringify(signature(xml, original))
                )
                  throw new InvalidHandleError();
                return found;
              }
            },
            node.name.localName
          )
        );
    });
  }
  get categories(): Categories {
    const binding = chartNodeBinding(this);
    return new Categories(() => {
      const xml = binding.read(),
        plot = binding.locate(xml),
        series = plot.children.find(
          (n) => n.name.namespace === plot.name.namespace && n.name.localName === "ser"
        ),
        cat = series && child(series, "cat");
      if (!cat) return [];
      const multi = child(cat, "multiLvlStrRef"),
        multiCache = multi && child(multi, "multiLvlStrCache");
      const ref = child(cat, "strRef") ?? child(cat, "numRef"),
        cache = ref
          ? (child(ref, "strCache") ?? child(ref, "numCache"))
          : (child(cat, "strLit") ?? child(cat, "numLit"));
      const levels = multiCache
        ? multiCache.children.filter(
            (n) => n.name.localName === "lvl" && n.name.namespace === cat.name.namespace
          )
        : cache
          ? [cache]
          : [];
      return Object.freeze(
        levels.map(
          (level) =>
            new CategoryLevel(() => {
              const indexes = new Set<number>();
              return level.children
                .filter((n) => n.name.localName === "pt" && n.name.namespace === cat.name.namespace)
                .map((pt) => {
                  const idx = Number(attr(pt, "idx")),
                    value = child(pt, "v");
                  if (!Number.isInteger(idx) || idx < 0 || !value || indexes.has(idx))
                    throw new ValueError("Invalid category cache index.");
                  indexes.add(idx);
                  return new Category(idx, xml.text(value) ?? "");
                });
            })
        )
      );
    });
  }
  get has_data_labels() {
    return !!child(chartNode(this), "dLbls");
  }
  set has_data_labels(value: boolean) {
    this.present("dLbls", value);
  }
  get data_labels(): DataLabels {
    if (!this.has_data_labels) throw new PropertyAccessError("Plot has no data labels.");
    return new DataLabels(chartDescendant(this, "dLbls"));
  }
  get vary_by_categories(): boolean {
    return readBoolean(child(chartNode(this), "varyColors"), true);
  }
  set vary_by_categories(value: boolean) {
    booleanValue(value);
    this.setScalar("varyColors", value);
  }
}
export class AreaPlot extends BasePlot {}
export class Area3DPlot extends BasePlot {}
export class LinePlot extends BasePlot {}
export class PiePlot extends BasePlot {}
export class DoughnutPlot extends BasePlot {}
export class RadarPlot extends BasePlot {}
export class XyPlot extends BasePlot {}
export class BarPlot extends BasePlot {
  get gap_width() {
    return Number(this.scalar("gapWidth") ?? 150);
  }
  set gap_width(value: number) {
    numberValue(value, 0, 500, true);
    this.setScalar("gapWidth", value);
  }
  get overlap() {
    return Number(this.scalar("overlap") ?? 0);
  }
  set overlap(value: number) {
    numberValue(value, -100, 100, true);
    this.setScalar("overlap", value === 0 ? null : value);
  }
}
export class BubblePlot extends BasePlot {
  get bubble_scale() {
    return Number(this.scalar("bubbleScale") ?? 100);
  }
  set bubble_scale(value: number | null) {
    if (value !== null) numberValue(value, 0, 300, true);
    this.setScalar("bubbleScale", value);
  }
}
export const plotNames = [
  "areaChart",
  "area3DChart",
  "barChart",
  "bar3DChart",
  "bubbleChart",
  "doughnutChart",
  "lineChart",
  "line3DChart",
  "ofPieChart",
  "pieChart",
  "pie3DChart",
  "radarChart",
  "scatterChart",
  "stockChart",
  "surfaceChart",
  "surface3DChart"
] as const;
export class Plots extends ChartSequence<BasePlot> {
  slice(start?: number, end?: number, step = 1): readonly BasePlot[] {
    return sequenceSlice([...this], start, end, step);
  }
}
export function plotFor(binding: ChartBinding, chart: Chart): BasePlot {
  const classes: Record<string, new (binding: ChartBinding, chart: Chart) => BasePlot> = {
    areaChart: AreaPlot,
    area3DChart: Area3DPlot,
    barChart: BarPlot,
    bar3DChart: BarPlot,
    bubbleChart: BubblePlot,
    doughnutChart: DoughnutPlot,
    lineChart: LinePlot,
    line3DChart: LinePlot,
    pieChart: PiePlot,
    pie3DChart: PiePlot,
    ofPieChart: PiePlot,
    radarChart: RadarPlot,
    scatterChart: XyPlot
  };
  return new (classes[binding.locate(binding.read()).name.localName] ?? BasePlot)(binding, chart);
}
