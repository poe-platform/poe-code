import { chartNode, chartDescendant } from "./chart-model-core.js";
import {
  toChartData,
  type CategoryChartData,
  type XyChartData,
  type BubbleChartData
} from "./chart-data-model.js";
import type { ChartData as ChartDataInput } from "./chart-editing.js";
import type { PartView } from "./package-view.js";
import { applyChartAppearance } from "./chart-editing.js";
import { XL_CHART_TYPE } from "./chart-enums.js";
import {
  PropertyAccessError,
  InvalidHandleError,
  TypeError as ModelTypeError,
  ValueError
} from "./errors.js";
import { attr, child, required } from "./masters.js";
import { createXmlElementView, type XmlElementView } from "./xml-view.js";
import type { XmlPart } from "./xml.js";

import { ChartNode, chartBinding, type ChartBinding } from "./chart-model-core.js";
import { ChartTitle, CategoryAxis, DateAxis, ValueAxis, Legend } from "./chart-model-axes.js";
import { Plots, SeriesCollection, plotFor, plotNames } from "./chart-model-series.js";
class ChartRoot extends ChartNode {
  get title() {
    return new ChartTitle(chartDescendant(this, "title", true));
  }
  get hasTitle() {
    return !!child(chartNode(this), "title");
  }
  set hasTitle(value: boolean) {
    this.present("title", value);
  }
  get legend() {
    return child(chartNode(this), "legend") ? new Legend(chartDescendant(this, "legend")) : null;
  }
}
class ChartSpace extends ChartNode {
  get font() {
    return this.textFrame().paragraphs[0]!.font;
  }
}
import { readModelChartType } from "./chart-type-model.js";
export class Chart {
  readonly #owner: ChartBinding;
  readonly #options: { replaceData?: (data: ChartDataInput) => void; part?: () => PartView };
  readonly #read: () => XmlPart;
  readonly #write: (xml: XmlPart) => void;
  constructor(
    read: () => XmlPart,
    write: (xml: XmlPart) => void,
    options: { replaceData?: (data: ChartDataInput) => void; part?: () => PartView } = {}
  ) {
    this.#options = options;
    this.#owner = chartBinding(read, write);
    this.#read = this.#owner.read;
    this.#write = this.#owner.write;
  }
  get part(): PartView {
    this.#read();
    if (!this.#options.part) throw new PropertyAccessError("Chart package part is unavailable.");
    return this.#options.part();
  }
  replace_data(data: ChartDataInput | CategoryChartData | XyChartData | BubbleChartData): void {
    this.#read();
    const input = toChartData(data);
    if (!this.#options.replaceData)
      throw new PropertyAccessError("Chart workbook ownership is unavailable.");
    this.#options.replaceData(input);
    this.#read();
  }
  #binding(): ChartBinding {
    return this.#owner;
  }
  #chart(): ChartRoot {
    const binding = this.#binding();
    return new ChartRoot({ ...binding, locate: (xml) => required(xml.root, "chart") });
  }
  get has_title(): boolean {
    return this.#chart().hasTitle;
  }
  set has_title(value: boolean) {
    this.#chart().hasTitle = value;
  }
  get chart_title(): ChartTitle {
    return this.#chart().title;
  }
  get legend(): Legend | null {
    return this.#chart().legend;
  }
  get font() {
    return new ChartSpace(this.#binding()).font;
  }
  #axis(names: readonly string[], index = 0): ChartBinding {
    const binding = this.#binding();
    const locate = (xml: XmlPart) => {
      const area = required(required(xml.root, "chart"), "plotArea");
      const found = area.children.filter(
        (n) => n.name.namespace === area.name.namespace && names.includes(n.name.localName)
      )[index];
      if (!found) throw new PropertyAccessError("Chart axis is unavailable.");
      return found;
    };
    locate(this.#read());
    return { ...binding, locate };
  }
  get category_axis(): CategoryAxis | DateAxis | ValueAxis {
    try {
      const binding = this.#axis(["catAx", "dateAx"]);
      return binding.locate(this.#read()).name.localName === "dateAx"
        ? new DateAxis(binding)
        : new CategoryAxis(binding);
    } catch (error) {
      if (!(error instanceof PropertyAccessError)) throw error;
      return new ValueAxis(this.#axis(["valAx"]));
    }
  }
  get value_axis(): ValueAxis {
    const area = required(required(this.#read().root, "chart"), "plotArea");
    const hasCategories = area.children.some(
      (n) =>
        n.name.namespace === area.name.namespace && ["catAx", "dateAx"].includes(n.name.localName)
    );
    return new ValueAxis(this.#axis(["valAx"], hasCategories ? 0 : 1));
  }
  get plots(): Plots {
    const binding = this.#binding();
    return new Plots(() => {
      const area = required(required(this.#read().root, "chart"), "plotArea");
      return area.children
        .filter(
          (n) =>
            n.name.namespace === area.name.namespace &&
            (plotNames as readonly string[]).includes(n.name.localName)
        )
        .map((_, index) =>
          plotFor(
            {
              ...binding,
              locate: (xml) => {
                const parent = required(required(xml.root, "chart"), "plotArea"),
                  found = parent.children.filter(
                    (n) =>
                      n.name.namespace === parent.name.namespace &&
                      (plotNames as readonly string[]).includes(n.name.localName)
                  )[index];
                if (!found) throw new InvalidHandleError();
                return found;
              }
            },
            this
          )
        );
    });
  }
  get series(): SeriesCollection {
    return new SeriesCollection(() => [...this.plots].flatMap((plot) => [...plot.series]));
  }
  get chart_type(): XL_CHART_TYPE {
    return readModelChartType(this.#read());
  }
  get chart_style(): number | null {
    const node = child(this.#read().root, "style");
    if (!node) return null;
    const value = Number(attr(node, "val"));
    if (!Number.isInteger(value) || value < 1 || value > 48)
      throw new ValueError("Invalid chart style.");
    return value;
  }
  set chart_style(value: number | null) {
    if (value !== null && typeof value !== "number") throw new ModelTypeError();
    this.#write(applyChartAppearance(this.#read(), { style: value }));
  }
  get has_legend(): boolean {
    return !!child(required(this.#read().root, "chart"), "legend");
  }
  set has_legend(value: boolean) {
    if (typeof value !== "boolean") throw new ModelTypeError();
    this.#write(applyChartAppearance(this.#read(), { legend: value }));
  }
  get element(): XmlElementView {
    return createXmlElementView({
      read: this.#read,
      commit: (expected, next) => {
        if (this.#read() !== expected) throw new InvalidHandleError();
        this.#write(next);
      }
    });
  }
}
