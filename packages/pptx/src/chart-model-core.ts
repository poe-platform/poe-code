import { applyDrawingUpdate, validateDrawingUpdate, type DrawingUpdate } from "./drawing-format.js";
import {
  IndexError,
  InvalidHandleError,
  TypeError as ModelTypeError,
  ValueError
} from "./errors.js";
import { attr, child, escape } from "./masters.js";
import { FillFormat, LineFormat, ShadowFormat, type ShapeUpdate } from "./shapes.js";
import { TextFrame } from "./text-frames.js";
import { createXmlElementView } from "./xml-view.js";
import type { XmlElement, XmlPart } from "./xml.js";

export interface ChartBinding {
  read(): XmlPart;
  write(xml: XmlPart): void;
  locate(xml: XmlPart): XmlElement;
  prepare?: (() => void) | undefined;
  track?: ((locate: (xml: XmlPart) => XmlElement) => (xml: XmlPart) => XmlElement) | undefined;
}
export function chartBinding(read: () => XmlPart, write: (xml: XmlPart) => void): ChartBinding {
  const handles: { locate: (xml: XmlPart) => XmlElement; valid: boolean }[] = [];
  let previous = read();
  const synchronize = (next: XmlPart) => {
    if (previous === next) return;
    previous = next;
    for (const handle of handles) {
      if (!handle.valid) continue;
      try {
        handle.locate(next);
      } catch {
        handle.valid = false;
      }
    }
  };
  const trackedRead = () => {
    const next = read();
    synchronize(next);
    return next;
  };
  const trackedWrite = (xml: XmlPart) => {
    write(xml);
    synchronize(xml);
  };
  const track = (locate: (xml: XmlPart) => XmlElement) => {
    const state = { locate, valid: true };
    handles.push(state);
    return (xml: XmlPart) => {
      if (!state.valid) throw new InvalidHandleError();
      return locate(xml);
    };
  };
  return { read: trackedRead, write: trackedWrite, locate: (xml) => xml.root, track };
}
const order: Record<string, readonly string[]> = {
  chartSpace: [
    "date1904",
    "lang",
    "roundedCorners",
    "AlternateContent",
    "style",
    "clrMapOvr",
    "pivotSource",
    "protection",
    "chart",
    "spPr",
    "txPr",
    "externalData",
    "printSettings",
    "userShapes",
    "extLst"
  ],
  chart: [
    "title",
    "autoTitleDeleted",
    "pivotFmts",
    "view3D",
    "floor",
    "sideWall",
    "backWall",
    "plotArea",
    "legend",
    "plotVisOnly",
    "dispBlanksAs",
    "showDLblsOverMax",
    "extLst"
  ],
  title: ["tx", "layout", "overlay", "spPr", "txPr", "extLst"],
  legend: ["legendPos", "legendEntry", "layout", "overlay", "spPr", "txPr", "extLst"],
  catAx: [
    "axId",
    "scaling",
    "delete",
    "axPos",
    "majorGridlines",
    "minorGridlines",
    "title",
    "numFmt",
    "majorTickMark",
    "minorTickMark",
    "tickLblPos",
    "spPr",
    "txPr",
    "crossAx",
    "crosses",
    "crossesAt",
    "auto",
    "lblAlgn",
    "lblOffset",
    "tickLblSkip",
    "tickMarkSkip",
    "noMultiLvlLbl",
    "extLst"
  ],
  valAx: [
    "axId",
    "scaling",
    "delete",
    "axPos",
    "majorGridlines",
    "minorGridlines",
    "title",
    "numFmt",
    "majorTickMark",
    "minorTickMark",
    "tickLblPos",
    "spPr",
    "txPr",
    "crossAx",
    "crosses",
    "crossesAt",
    "crossBetween",
    "majorUnit",
    "minorUnit",
    "dispUnits",
    "extLst"
  ],
  dateAx: [
    "axId",
    "scaling",
    "delete",
    "axPos",
    "majorGridlines",
    "minorGridlines",
    "title",
    "numFmt",
    "majorTickMark",
    "minorTickMark",
    "tickLblPos",
    "spPr",
    "txPr",
    "crossAx",
    "crosses",
    "crossesAt",
    "auto",
    "lblOffset",
    "baseTimeUnit",
    "majorUnit",
    "majorTimeUnit",
    "minorUnit",
    "minorTimeUnit",
    "extLst"
  ],
  scaling: ["logBase", "orientation", "max", "min", "extLst"],
  marker: ["symbol", "size", "spPr", "extLst"],
  dPt: [
    "idx",
    "invertIfNegative",
    "marker",
    "bubble3D",
    "explosion",
    "spPr",
    "pictureOptions",
    "extLst"
  ],
  dLbl: [
    "idx",
    "layout",
    "tx",
    "numFmt",
    "spPr",
    "txPr",
    "dLblPos",
    "showLegendKey",
    "showVal",
    "showCatName",
    "showSerName",
    "showPercent",
    "showBubbleSize",
    "separator",
    "extLst"
  ],
  dLbls: [
    "dLbl",
    "delete",
    "numFmt",
    "spPr",
    "txPr",
    "dLblPos",
    "showLegendKey",
    "showVal",
    "showCatName",
    "showSerName",
    "showPercent",
    "showBubbleSize",
    "separator",
    "showLeaderLines",
    "leaderLines",
    "extLst"
  ],
  ser: [
    "idx",
    "order",
    "tx",
    "spPr",
    "invertIfNegative",
    "pictureOptions",
    "marker",
    "dPt",
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
  ],
  manualLayout: ["layoutTarget", "xMode", "yMode", "wMode", "hMode", "x", "y", "w", "h", "extLst"]
};
const plotOrder = [
  "barDir",
  "grouping",
  "scatterStyle",
  "radarStyle",
  "varyColors",
  "ser",
  "dLbls",
  "dropLines",
  "hiLowLines",
  "upDownBars",
  "marker",
  "smooth",
  "gapWidth",
  "gapDepth",
  "overlap",
  "serLines",
  "firstSliceAng",
  "holeSize",
  "ofPieType",
  "splitType",
  "splitPos",
  "custSplit",
  "secondPieSize",
  "bubbleScale",
  "showNegBubbles",
  "sizeRepresents",
  "bandFmts",
  "wireframe",
  "axId",
  "extLst"
];
export function numberValue(
  value: unknown,
  min = -Infinity,
  max = Infinity,
  integer = false
): asserts value is number {
  if (typeof value !== "number") throw new ModelTypeError();
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new ValueError();
}
export function booleanValue(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") throw new ModelTypeError();
}
export function readBoolean(node: XmlElement | undefined, defaultValue: boolean): boolean {
  if (!node) return defaultValue;
  const token = attr(node, "val");
  if (token === undefined || token === "1" || token === "true") return true;
  if (token === "0" || token === "false") return false;
  throw new ValueError("Invalid chart boolean.");
}
const chartBindings = new WeakMap<ChartNode, ChartBinding>();
export function chartNodeBinding(node: ChartNode): ChartBinding {
  const binding = chartBindings.get(node);
  if (!binding) throw new InvalidHandleError();
  binding.locate(binding.read());
  return binding;
}
export function chartNode(node: ChartNode): XmlElement {
  const binding = chartNodeBinding(node);
  return binding.locate(binding.read());
}
export function chartDescendant(self: ChartNode, name: string, create = false): ChartBinding {
  if (create && !child(chartNode(self), name)) chartPut(self, name, "");
  const parent = chartNodeBinding(self);
  return {
    read: parent.read,
    write: parent.write,
    track: parent.track,
    locate: (xml) => {
      const found = child(parent.locate(xml), name);
      if (!found) throw new InvalidHandleError();
      return found;
    }
  };
}
export function chartOptionalDescendant(self: ChartNode, name: string): ChartBinding {
  const parent = chartNodeBinding(self),
    virtual: XmlElement = {
      name: { namespace: chartNode(self).name.namespace, localName: name },
      attributes: [],
      children: []
    };
  let materialized = !!child(chartNode(self), name);
  return {
    read: parent.read,
    write: parent.write,
    track: parent.track,
    prepare: () => {
      parent.prepare?.();
      if (!child(chartNode(self), name)) chartPut(self, name, "");
    },
    locate: (xml) => {
      const found = child(parent.locate(xml), name);
      if (found) {
        materialized = true;
        return found;
      }
      if (materialized) throw new InvalidHandleError();
      return virtual;
    }
  };
}
export function chartPut(
  self: ChartNode,
  name: string,
  content: string | null,
  attributes: Readonly<Record<string, string>> = {}
): void {
  chartNodeBinding(self).prepare?.();
  const document = chartNodeBinding(self).read(),
    node = chartNodeBinding(self).locate(document),
    existing = child(node, name);
  if (content === null) {
    if (existing)
      chartNodeBinding(self).write(
        document.spliceChildren(node, node.children.indexOf(existing), 1, [])
      );
    return;
  }
  const sequence =
    order[node.name.localName] ??
    (node.name.localName.endsWith("Chart") ? plotOrder : [name, "extLst"]);
  const rank = sequence.indexOf(name);
  const next = node.children.findIndex(
    (n) => n.name.namespace === node.name.namespace && sequence.indexOf(n.name.localName) > rank
  );
  const index = existing ? node.children.indexOf(existing) : next < 0 ? node.children.length : next;
  const markup = `<c:${name} xmlns:c="${node.name.namespace}"${Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join("")}>${content}</c:${name}>`;
  chartNodeBinding(self).write(document.spliceChildren(node, index, existing ? 1 : 0, [markup]));
}
export class ChartNode {
  readonly #binding: ChartBinding;
  constructor(binding: ChartBinding) {
    this.#binding = { ...binding, locate: binding.track?.(binding.locate) ?? binding.locate };
    chartBindings.set(this, this.#binding);
  }
  protected scalar(name: string): string | null {
    const n = child(chartNode(this), name);
    return n ? (attr(n, "val") ?? null) : null;
  }
  protected setScalar(name: string, value: string | number | boolean | null): void {
    if (value === null) {
      chartPut(this, name, null);
      return;
    }
    const xml = this.#binding.read(),
      node = this.#binding.locate(xml),
      existing = child(node, name);
    const encoded = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    if (existing)
      this.#binding.write(
        xml.merge(existing, { attributes: [{ namespace: "", localName: "val", value: encoded }] })
      );
    else chartPut(this, name, "", { val: encoded });
  }
  protected present(name: string, value: boolean): void {
    booleanValue(value);
    if (value) {
      if (!child(chartNode(this), name)) chartPut(this, name, "");
    } else chartPut(this, name, null);
  }
  protected textFrame(name = "txPr"): TextFrame {
    if (!child(chartNode(this), name)) {
      const ans = chartNode(this).name.namespace.includes("purl.oclc.org")
        ? "http://purl.oclc.org/ooxml/drawingml/main"
        : "http://schemas.openxmlformats.org/drawingml/2006/main";
      chartPut(
        this,
        name,
        `<a:bodyPr xmlns:a="${ans}"/><a:lstStyle xmlns:a="${ans}"/><a:p xmlns:a="${ans}"/>`
      );
    }
    const binding = chartDescendant(this, name);
    let owner: XmlPart | undefined, cached: XmlPart | undefined;
    const read = () => {
      const xml = binding.read();
      if (owner !== xml) {
        cached = xml.subtree(binding.locate(xml));
        owner = xml;
      }
      return cached!;
    };
    return new TextFrame(read(), undefined, {
      read,
      write: (next) => {
        const xml = binding.read(),
          parent = this.#binding.locate(xml),
          node = binding.locate(xml);
        binding.write(
          xml.spliceChildren(parent, parent.children.indexOf(node), 1, [
            next.markup(next.root, true)
          ])
        );
      }
    });
  }
  get element() {
    this.#binding.prepare?.();
    const expected = this.#binding.read(),
      selected = this.#binding.locate(expected),
      subtree = expected.subtree(selected);
    return createXmlElementView({
      read: () => {
        if (this.#binding.read() !== expected) throw new InvalidHandleError();
        return subtree;
      },
      commit: (_old, next) => {
        if (this.#binding.read() !== expected) throw new InvalidHandleError();
        const findParent = (node: XmlElement): XmlElement | undefined =>
          node.children.includes(selected) ? node : node.children.map(findParent).find(Boolean);
        const parent = findParent(expected.root);
        if (!parent) throw new InvalidHandleError();
        this.#binding.write(
          expected.spliceChildren(parent, parent.children.indexOf(selected), 1, [
            next.markup(next.root, true)
          ])
        );
      }
    });
  }
  equals(other: unknown): boolean {
    return (
      other instanceof ChartNode &&
      this.#binding.read() === other.#binding.read() &&
      chartNode(this) === chartNode(other)
    );
  }
  get format(): ChartFormat {
    return new ChartFormat(chartNodeBinding(this));
  }
}
export class ChartFormat extends ChartNode {
  apply(update: DrawingUpdate): void {
    validateDrawingUpdate(update);
    if (!child(chartNode(this), "spPr")) chartPut(this, "spPr", "");
    const binding = chartNodeBinding(this);
    const xml = binding.read();
    binding.write(applyDrawingUpdate(xml, binding.locate(xml), update));
  }

  #drawing() {
    if (!child(chartNode(this), "spPr")) chartPut(this, "spPr", "");
    const binding = chartNodeBinding(this);
    let owner: XmlPart | undefined, cached: XmlPart | undefined;
    const read = () => {
      const xml = binding.read();
      if (owner !== xml) {
        cached = xml.subtree(binding.locate(xml));
        owner = xml;
      }
      return cached!;
    };
    const edit = (transform: (xml: XmlPart, node: XmlElement) => XmlPart) => {
      const xml = binding.read(),
        selected = binding.locate(xml),
        local = read();
      const next = transform(local, local.root);
      const parentOf = (node: XmlElement): XmlElement | undefined => {
        if (node.children.includes(selected)) return node;
        for (const c of node.children) {
          const found = parentOf(c);
          if (found) return found;
        }
        return undefined;
      };
      const parent = parentOf(xml.root);
      if (!parent) throw new InvalidHandleError();
      binding.write(
        xml.spliceChildren(parent, parent.children.indexOf(selected), 1, [
          next.markup(next.root, true)
        ])
      );
    };
    const update = (value: ShapeUpdate) =>
      edit((xml, node) =>
        applyDrawingUpdate(xml, node, {
          ...(value.fill === undefined
            ? {}
            : {
                fill:
                  value.fill === null
                    ? { kind: "none" as const }
                    : value.fill === "solid"
                      ? { kind: "solid" as const }
                      : { kind: "solid" as const, color: value.fill }
              }),
          ...(value.lineColor === undefined && value.lineWidth === undefined
            ? {}
            : {
                line: {
                  ...(value.lineColor === undefined
                    ? {}
                    : {
                        fill:
                          value.lineColor === null
                            ? { kind: "none" as const }
                            : value.lineColor === "solid"
                              ? { kind: "solid" as const }
                              : { kind: "solid" as const, color: value.lineColor }
                      }),
                  ...(value.lineWidth === undefined ? {} : { width: value.lineWidth })
                }
              })
        })
      );
    return { read, edit, update };
  }
  get fill(): FillFormat {
    const { read, edit, update } = this.#drawing();
    return new FillFormat(read, update, false, edit);
  }
  get line(): LineFormat {
    const { read, edit, update } = this.#drawing();
    return new LineFormat(read, update, edit);
  }
  get shadow(): ShadowFormat {
    const { read, edit } = this.#drawing();
    return new ShadowFormat(read, edit);
  }
}
interface SequenceState<T> {
  read: () => readonly T[];
  negative: boolean;
  equal: (a: T, b: T) => boolean;
}
const sequences = new WeakMap<object, SequenceState<unknown>>();
function state<T>(sequence: ChartSequence<T>): SequenceState<T> {
  return sequences.get(sequence)! as SequenceState<T>;
}
export class ChartSequence<T> implements Iterable<T> {
  readonly [index: number]: T;
  constructor(
    read: () => readonly T[],
    negative = true,
    equal: (a: T, b: T) => boolean = (a, b) => a === b || (a instanceof ChartNode && a.equals(b))
  ) {
    const data = { read, negative, equal };
    const numeric = (key: PropertyKey) =>
      typeof key === "string" && key !== "" && String(Number(key)) === key;
    const proxy = new Proxy(this, {
      get(target, key, receiver) {
        if (numeric(key)) return target.at(Number(key));
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        if (numeric(key)) throw new ValueError("Sequence entries cannot be replaced.");
        return Reflect.set(target, key, value, receiver);
      },
      defineProperty(target, key, descriptor) {
        if (numeric(key)) throw new ValueError("Sequence entries cannot be replaced.");
        return Reflect.defineProperty(target, key, descriptor);
      },
      deleteProperty(target, key) {
        if (numeric(key)) throw new ValueError("Sequence entries cannot be removed.");
        return Reflect.deleteProperty(target, key);
      }
    });
    sequences.set(this, data as SequenceState<unknown>);
    sequences.set(proxy, data as SequenceState<unknown>);
    return proxy;
  }
  get length() {
    return state(this).read().length;
  }
  at(index: number): T {
    if (typeof index !== "number") throw new ModelTypeError();
    const data = state(this),
      all = data.read();
    if (!Number.isInteger(index)) throw new IndexError();
    const offset = index < 0 && data.negative ? all.length + index : index;
    if (offset < 0 || offset >= all.length) throw new IndexError();
    return all[offset]!;
  }
  *[Symbol.iterator]() {
    yield* state(this).read();
  }
  includes(value: T): boolean {
    return this.count(value) > 0;
  }
  count(value: T): number {
    const data = state(this);
    return data.read().filter((item) => data.equal(item, value)).length;
  }
  index(value: T, start = 0, stop?: number): number {
    const data = state(this),
      all = data.read();
    for (const bound of [start, stop])
      if (bound !== undefined && !Number.isSafeInteger(bound))
        throw new ValueError("Invalid sequence search bound.");
    const normalize = (bound: number) =>
      Math.min(all.length, Math.max(0, bound < 0 ? all.length + bound : bound));
    const first = normalize(start),
      last = stop === undefined ? all.length : normalize(stop);
    for (let index = first; index < last; index++) if (data.equal(all[index]!, value)) return index;
    throw new ValueError();
  }
  *reversed() {
    yield* [...state(this).read()].reverse();
  }
}
