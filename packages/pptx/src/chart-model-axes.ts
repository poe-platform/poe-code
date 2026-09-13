import {
  chartNodeBinding,
  chartNode,
  chartDescendant,
  chartOptionalDescendant,
  chartPut
} from "./chart-model-core.js";
import {
  XL_AXIS_CROSSES,
  XL_CATEGORY_TYPE,
  XL_LEGEND_POSITION,
  XL_TICK_LABEL_POSITION,
  XL_TICK_MARK
} from "./chart-enums.js";
import {
  ChartFormat,
  ChartNode,
  booleanValue,
  numberValue,
  readBoolean,
  type ChartBinding
} from "./chart-model-core.js";
import { PropertyAccessError, TypeError as ModelTypeError } from "./errors.js";
import { attr, child } from "./masters.js";
import type { TextFrame } from "./text-frames.js";
class RichText extends ChartNode {
  get frame(): TextFrame {
    return this.textFrame("rich");
  }
}
export class ChartTitle extends ChartNode {
  get has_text_frame(): boolean {
    const tx = child(chartNode(this), "tx");
    return !!(tx && child(tx, "rich"));
  }
  set has_text_frame(value: boolean) {
    booleanValue(value);
    if (value) {
      void this.text_frame;
    } else chartPut(this, "tx", null);
  }
  get text_frame(): TextFrame {
    if (!this.has_text_frame) chartPut(this, "tx", "");
    return new RichText(chartDescendant(this, "tx")).frame;
  }
}
export class AxisTitle extends ChartTitle {}
export class Legend extends ChartNode {
  get font() {
    return this.textFrame().paragraphs[0]!.font;
  }
  get position(): XL_LEGEND_POSITION {
    const value = this.scalar("legendPos");
    return value === null ? XL_LEGEND_POSITION.RIGHT : XL_LEGEND_POSITION.from_xml(value);
  }
  set position(value: XL_LEGEND_POSITION) {
    this.setScalar("legendPos", XL_LEGEND_POSITION.to_xml(value));
  }
  get include_in_layout(): boolean {
    return readBoolean(child(chartNode(this), "overlay"), true);
  }
  set include_in_layout(value: boolean | null) {
    if (value !== null) booleanValue(value);
    this.setScalar("overlay", value);
  }
  get horz_offset(): number {
    const layout = child(chartNode(this), "layout"),
      manual = layout && child(layout, "manualLayout"),
      mode = manual && child(manual, "xMode"),
      x = manual && child(manual, "x");
    return x && (!mode || attr(mode, "val") === "factor") ? Number(attr(x, "val") ?? 0) : 0;
  }
  set horz_offset(value: number | null) {
    if (value !== null) numberValue(value, -1, 1);
    new Layout(chartDescendant(this, "layout", true)).offset = value;
  }
}
class Layout extends ChartNode {
  set offset(value: number | null) {
    new ManualLayout(chartDescendant(this, "manualLayout", true)).offset = value;
  }
}
class ManualLayout extends ChartNode {
  set offset(value: number | null) {
    this.setScalar("xMode", "factor");
    this.setScalar("x", value);
  }
}
export class TickLabels extends ChartNode {
  get font() {
    return this.textFrame().paragraphs[0]!.font;
  }
  get number_format(): string {
    const node = child(chartNode(this), "numFmt");
    return node ? (attr(node, "formatCode") ?? "General") : "General";
  }
  set number_format(value: string) {
    if (typeof value !== "string") throw new ModelTypeError();
    this.numberFormat(value, false);
  }
  get number_format_is_linked(): boolean {
    const node = child(chartNode(this), "numFmt");
    if (!node) return true;
    const value = attr(node, "sourceLinked");
    return value === undefined || value === "1" || value === "true";
  }
  set number_format_is_linked(value: boolean) {
    booleanValue(value);
    this.numberFormat(this.number_format, value);
  }
  private numberFormat(value: string, linked: boolean) {
    const binding = chartNodeBinding(this),
      xml = binding.read(),
      node = binding.locate(xml),
      existing = child(node, "numFmt");
    if (existing)
      binding.write(
        xml.merge(existing, {
          attributes: [
            { namespace: "", localName: "formatCode", value },
            { namespace: "", localName: "sourceLinked", value: linked ? "1" : "0" }
          ]
        })
      );
    else chartPut(this, "numFmt", "", { formatCode: value, sourceLinked: linked ? "1" : "0" });
  }
  get offset(): number {
    return Number(this.scalar("lblOffset") ?? 100);
  }
  set offset(value: number) {
    numberValue(value, 0, 1000, true);
    this.setScalar("lblOffset", value);
  }
}
export class MajorGridlines extends ChartNode {
  override get format(): ChartFormat {
    return new ChartFormat(chartOptionalDescendant(this, "majorGridlines"));
  }
}
class Scaling extends ChartNode {
  get min() {
    const value = this.scalar("min");
    return value === null ? null : Number(value);
  }
  set min(value: number | null) {
    if (value !== null) numberValue(value);
    this.setScalar("min", value);
  }
  get max() {
    const value = this.scalar("max");
    return value === null ? null : Number(value);
  }
  set max(value: number | null) {
    if (value !== null) numberValue(value);
    this.setScalar("max", value);
  }
  get reversed() {
    return this.scalar("orientation") === "maxMin";
  }
  set reversed(value: boolean) {
    booleanValue(value);
    this.setScalar("orientation", value ? "maxMin" : "minMax");
  }
}
export class BaseAxis extends ChartNode {
  get axis_title(): AxisTitle {
    return new AxisTitle(chartDescendant(this, "title", true));
  }
  get has_title() {
    return !!child(chartNode(this), "title");
  }
  set has_title(value: boolean) {
    this.present("title", value);
  }
  get has_major_gridlines() {
    return !!child(chartNode(this), "majorGridlines");
  }
  set has_major_gridlines(value: boolean) {
    this.present("majorGridlines", value);
  }
  get has_minor_gridlines() {
    return !!child(chartNode(this), "minorGridlines");
  }
  set has_minor_gridlines(value: boolean) {
    this.present("minorGridlines", value);
  }
  get major_gridlines(): MajorGridlines {
    return new MajorGridlines(chartNodeBinding(this));
  }
  get major_tick_mark(): XL_TICK_MARK {
    return XL_TICK_MARK.from_xml(this.scalar("majorTickMark") ?? "none");
  }
  set major_tick_mark(value: XL_TICK_MARK) {
    this.setScalar("majorTickMark", XL_TICK_MARK.to_xml(value));
  }
  get minor_tick_mark(): XL_TICK_MARK {
    return XL_TICK_MARK.from_xml(this.scalar("minorTickMark") ?? "none");
  }
  set minor_tick_mark(value: XL_TICK_MARK) {
    this.setScalar("minorTickMark", XL_TICK_MARK.to_xml(value));
  }
  get maximum_scale(): number | null {
    const scaling = child(chartNode(this), "scaling");
    return scaling ? new Scaling(chartDescendant(this, "scaling")).max : null;
  }
  set maximum_scale(value: number | null) {
    if (value !== null) numberValue(value);
    new Scaling(chartDescendant(this, "scaling", true)).max = value;
  }
  get minimum_scale(): number | null {
    const scaling = child(chartNode(this), "scaling");
    return scaling ? new Scaling(chartDescendant(this, "scaling")).min : null;
  }
  set minimum_scale(value: number | null) {
    if (value !== null) numberValue(value);
    new Scaling(chartDescendant(this, "scaling", true)).min = value;
  }
  get reverse_order(): boolean {
    return (
      !!child(chartNode(this), "scaling") && new Scaling(chartDescendant(this, "scaling")).reversed
    );
  }
  set reverse_order(value: boolean) {
    booleanValue(value);
    new Scaling(chartDescendant(this, "scaling", true)).reversed = value;
  }
  get tick_label_position(): XL_TICK_LABEL_POSITION {
    return XL_TICK_LABEL_POSITION.from_xml(this.scalar("tickLblPos") ?? "nextTo");
  }
  set tick_label_position(value: XL_TICK_LABEL_POSITION) {
    this.setScalar("tickLblPos", XL_TICK_LABEL_POSITION.to_xml(value));
  }
  get tick_labels(): TickLabels {
    return new TickLabels(chartNodeBinding(this));
  }
  get visible(): boolean {
    return !readBoolean(child(chartNode(this), "delete"), false);
  }
  set visible(value: boolean) {
    booleanValue(value);
    this.setScalar("delete", !value);
  }
}
export class CategoryAxis extends BaseAxis {
  get category_type(): XL_CATEGORY_TYPE {
    return XL_CATEGORY_TYPE.CATEGORY_SCALE;
  }
}
export class DateAxis extends BaseAxis {
  get category_type(): XL_CATEGORY_TYPE {
    return XL_CATEGORY_TYPE.TIME_SCALE;
  }
}
export class ValueAxis extends BaseAxis {
  #crossing(): Crossing {
    const id = this.scalar("crossAx"),
      binding = chartNodeBinding(this),
      namespace = chartNode(this).name.namespace;
    const locate = (xml: ReturnType<ChartBinding["read"]>) => {
      const visit = (node: typeof xml.root): typeof xml.root | undefined => {
        if (
          node.name.namespace === namespace &&
          ["catAx", "dateAx", "valAx"].includes(node.name.localName) &&
          attr(child(node, "axId") ?? node, "val") === id
        )
          return node;
        for (const c of node.children) {
          const found = visit(c);
          if (found) return found;
        }
        return undefined;
      };
      const found = visit(xml.root);
      if (!found) throw new PropertyAccessError("Crossed axis is unavailable.");
      return found;
    };
    return new Crossing({ read: binding.read, write: binding.write, track: binding.track, locate });
  }
  get crosses(): XL_AXIS_CROSSES {
    return this.#crossing().crosses;
  }
  set crosses(value: XL_AXIS_CROSSES) {
    this.#crossing().crosses = value;
  }
  get crosses_at(): number | null {
    return this.#crossing().crosses_at;
  }
  set crosses_at(value: number | null) {
    this.#crossing().crosses_at = value;
  }
  get major_unit(): number | null {
    const v = this.scalar("majorUnit");
    return v === null ? null : Number(v);
  }
  set major_unit(value: number | null) {
    if (value !== null) numberValue(value, Number.MIN_VALUE);
    this.setScalar("majorUnit", value);
  }
  get minor_unit(): number | null {
    const v = this.scalar("minorUnit");
    return v === null ? null : Number(v);
  }
  set minor_unit(value: number | null) {
    if (value !== null) numberValue(value, Number.MIN_VALUE);
    this.setScalar("minorUnit", value);
  }
}
class Crossing extends ChartNode {
  get crosses(): XL_AXIS_CROSSES {
    return child(chartNode(this), "crossesAt")
      ? XL_AXIS_CROSSES.CUSTOM
      : XL_AXIS_CROSSES.from_xml(this.scalar("crosses") ?? "autoZero");
  }
  set crosses(value: XL_AXIS_CROSSES) {
    if (value === XL_AXIS_CROSSES.CUSTOM) return;
    const token = XL_AXIS_CROSSES.to_xml(value);
    chartPut(this, "crossesAt", null);
    this.setScalar("crosses", token);
  }
  get crosses_at(): number | null {
    const value = this.scalar("crossesAt");
    return value === null ? null : Number(value);
  }
  set crosses_at(value: number | null) {
    if (value !== null) numberValue(value);
    chartPut(this, "crosses", null);
    this.setScalar("crossesAt", value);
  }
}
