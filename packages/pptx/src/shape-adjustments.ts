import {
  IndexError,
  InvalidHandleError,
  OfficeError,
  TypeError as ModelTypeError,
  ValueError
} from "./errors.js";
import { attr, child } from "./masters.js";
import { shapePresets } from "./shape-presets.js";
import { shapeAdjustmentDefaults } from "./shape-adjustment-defaults.js";
import type { XmlPart } from "./xml.js";

function raw(value: number): number {
  if (typeof value !== "number") throw new ModelTypeError("Adjustment value must be numeric.");
  const result = Math.trunc(value * 100000);
  if (!Number.isSafeInteger(result))
    throw new ValueError("Adjustment value exceeds the safe numeric range.");
  return result;
}
export function validateAdjustmentValues(values: unknown): asserts values is readonly number[] {
  if (!Array.isArray(values)) throw new ModelTypeError("Adjustment values require an array.");
  if (values.length > 4096)
    throw new OfficeError("resource-limit", "Adjustment value limit exceeded.", "usage");
  for (let index = 0; index < values.length; index++) {
    if (!Object.hasOwn(values, index))
      throw new ValueError("Adjustment arrays must contain every position.");
    raw(values[index]);
  }
}
export class Adjustment {
  #actual: number | null;
  constructor(
    private readonly name: string,
    private readonly defaultValue: number,
    actual: number | null = null
  ) {
    if (typeof name !== "string") throw new ModelTypeError();
    if (!Number.isSafeInteger(defaultValue) || (actual !== null && !Number.isSafeInteger(actual)))
      throw new ValueError();
    this.#actual = actual;
  }
  get effective_value(): number {
    return this.val / 100000;
  }
  set effective_value(value: number) {
    this.#actual = raw(value);
  }
  get val(): number {
    return this.#actual ?? this.defaultValue;
  }
}
function geometry(xml: XmlPart) {
  const props = child(xml.root, "spPr");
  const preset = props?.children.find(
    (n) =>
      n.name.localName === "prstGeom" &&
      [
        "http://schemas.openxmlformats.org/drawingml/2006/main",
        "http://purl.oclc.org/ooxml/drawingml/main"
      ].includes(n.name.namespace)
  );
  return preset;
}
export class AdjustmentCollection implements Iterable<number> {
  [index: number]: number;
  #preset: string | undefined;
  readonly #read: () => XmlPart;
  readonly #writeXml: (xml: XmlPart) => void;
  constructor(read: () => XmlPart, write: (xml: XmlPart) => void) {
    this.#read = read;
    this.#writeXml = write;
    const node = geometry(read());
    this.#preset = node && attr(node, "prst");
    return new Proxy(this, {
      get(target, key) {
        if (typeof key === "string" && key !== "" && String(Number(key)) === key)
          return target.#value(Number(key));
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, key, value) {
        if (typeof key === "string" && key !== "" && String(Number(key)) === key) {
          target.#set(Number(key), value);
          return true;
        }
        throw new ValueError("Adjustment collection members are read-only.");
      },
      defineProperty() {
        throw new ValueError("Adjustment collection properties cannot be redefined.");
      },
      deleteProperty() {
        throw new ValueError("Adjustment collection entries cannot be deleted.");
      }
    });
  }
  #values(): readonly (readonly [string, number])[] {
    const xml = this.#read(),
      node = geometry(xml);
    if ((node && attr(node, "prst")) !== this.#preset) throw new InvalidHandleError();
    if (!node) return [];
    const key = Object.keys(shapePresets).find(
      (key) => shapePresets[key as keyof typeof shapePresets] === this.#preset
    );
    if (!key)
      throw new OfficeError(
        "unsupported-edit",
        "Unknown preset adjustment defaults.",
        "validate-intent"
      );
    const values = (shapeAdjustmentDefaults[key] ?? []).map(([name, value]): [string, number] => [
      name,
      value
    ]);
    const guides = child(node, "avLst", node.name.namespace);
    for (const guide of guides?.children ?? []) {
      if (guide.name.localName !== "gd" || guide.name.namespace !== node.name.namespace) continue;
      const target = values.find(([name]) => name === attr(guide, "name"));
      if (!target) continue;
      const formula = attr(guide, "fmla");
      const token = formula?.startsWith("val ") ? formula.slice(4) : "";
      if (
        !token.length ||
        [...token].some((c, i) => !"0123456789".includes(c) && !(i === 0 && c === "-")) ||
        !Number.isSafeInteger(Number(token))
      )
        throw new OfficeError(
          "unsupported-edit",
          "Adjustment requires a literal integer guide.",
          "validate-intent"
        );
      target[1] = Number(token);
    }
    return values;
  }
  #value(index: number): number {
    const values = this.#values();
    if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) throw new IndexError();
    return values[index]![1] / 100000;
  }
  #set(index: number, value: number): void {
    const values = this.#values();
    if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) throw new IndexError();
    const actual = raw(value);
    this.#write(
      values.map(([name, current], position) => [name, position === index ? actual : current])
    );
  }
  get length(): number {
    return this.#values().length;
  }
  at(index: number): number {
    if (!Number.isSafeInteger(index)) throw new IndexError();
    return this.#value(index < 0 ? this.length + index : index);
  }
  *[Symbol.iterator](): IterableIterator<number> {
    for (const [, value] of this.#values()) yield value / 100000;
  }
  replace(values: readonly number[]): void {
    validateAdjustmentValues(values);
    const current = this.#values();
    if (values.length !== current.length)
      throw new ValueError("Adjustment count must match the preset.");
    const actuals = values.map(raw);
    this.#write(current.map(([name], index) => [name, actuals[index]!]));
  }
  #write(current: readonly (readonly [string, number])[]): void {
    const xml = this.#read(),
      node = geometry(xml);
    if (!node) {
      if (current.length) throw new ValueError();
      return;
    }
    const namespace = node.name.namespace;
    const guides = `<a:avLst xmlns:a="${namespace}">${current.map(([name, value]) => `<a:gd name="${name}" fmla="val ${value}"/>`).join("")}</a:avLst>`;
    const existing = child(node, "avLst", namespace);
    this.#writeXml(
      xml.spliceChildren(node, existing ? node.children.indexOf(existing) : 0, existing ? 1 : 0, [
        guides
      ])
    );
  }
}
