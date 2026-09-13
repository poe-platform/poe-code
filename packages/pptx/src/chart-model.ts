import { applyChartAppearance, readChartType } from "./chart-editing.js";
import { XL_CHART_TYPE } from "./chart-enums.js";
import { InvalidHandleError, TypeError as ModelTypeError, ValueError } from "./errors.js";
import { attr, child, required } from "./masters.js";
import { createXmlElementView, type XmlElementView } from "./xml-view.js";
import type { XmlPart } from "./xml.js";

export class Chart {
  readonly #read: () => XmlPart;
  readonly #write: (xml: XmlPart) => void;
  constructor(read: () => XmlPart, write: (xml: XmlPart) => void) {
    this.#read = read;
    this.#write = write;
  }
  get chart_type(): XL_CHART_TYPE {
    return XL_CHART_TYPE[readChartType(this.#read(), true)];
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
