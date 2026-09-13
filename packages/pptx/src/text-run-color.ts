import { OfficeError } from "./errors.js";
import { themeColorSlots, validateColor } from "./themes.js";
import type { XmlElement, XmlMerge } from "./xml.js";

export type RunColor =
  | string
  | { readonly rgb: string; readonly brightness?: number }
  | { readonly theme: string; readonly brightness?: number };
const kinds = {
  hslClr: "HSL",
  prstClr: "PRESET",
  schemeClr: "SCHEME",
  scrgbClr: "SCRGB",
  srgbClr: "RGB",
  sysClr: "SYSTEM"
} as const;
const slots: readonly string[] = [...themeColorSlots, "tx1", "tx2", "bg1", "bg2", "phClr"];
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function brightness(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1)
    invalid("Brightness must be between -1 and 1.");
}
export function validateRunColor(value: unknown): asserts value is RunColor {
  if (typeof value === "string") {
    validateColor(value);
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Color must be hexadecimal RGB or an explicit color object.");
  const data = value as Record<string, unknown>;
  const key = Object.hasOwn(data, "rgb") ? "rgb" : "theme";
  if (Object.keys(data).some((k) => k !== key && k !== "brightness") || !Object.hasOwn(data, key))
    invalid("Color requires exactly one RGB or theme value.");
  if (key === "rgb") validateColor(data.rgb);
  else if (typeof data.theme !== "string" || !slots.includes(data.theme))
    invalid("Unknown theme color slot.");
  if (data.brightness !== undefined) brightness(data.brightness);
}
export function colorBrightnessMerge(value: number, namespace: string): XmlMerge {
  brightness(value);
  const name = (localName: string) => ({ namespace, localName });
  const entries =
    value > 0
      ? ([
          ["lumMod", Math.round((1 - value) * 100000)],
          ["lumOff", Math.round(value * 100000)]
        ] as const)
      : value < 0
        ? ([["lumMod", Math.round((1 + value) * 100000)]] as const)
        : [];
  return {
    children: {
      sequence: [name("lumMod"), name("lumOff")],
      remove: ["lumMod", "lumOff"].filter((k) => !entries.some(([local]) => local === k)).map(name),
      upsert: entries.map(([localName, amount]) => ({
        name: name(localName),
        merge: { attributes: [{ namespace: "", localName: "val", value: String(amount) }] }
      }))
    }
  };
}
export function colorMerge(value: RunColor, namespace: string): XmlMerge {
  validateRunColor(value);
  const rgb = typeof value === "string" ? value : "rgb" in value ? value.rgb : undefined;
  const kind = rgb === undefined ? "schemeClr" : "srgbClr";
  const token = rgb?.toUpperCase() ?? (value as { theme: string }).theme;
  const adjustment = typeof value === "string" ? undefined : value.brightness;
  const merge: XmlMerge = {
    attributes: [{ namespace: "", localName: "val", value: token }],
    ...(adjustment === undefined ? {} : colorBrightnessMerge(adjustment, namespace))
  };
  return {
    children: {
      sequence: Object.keys(kinds).map((localName) => ({ namespace, localName })),
      remove: Object.keys(kinds)
        .filter((localName) => localName !== kind)
        .map((localName) => ({ namespace, localName })),
      upsert: [{ name: { namespace, localName: kind }, merge }]
    }
  };
}
export interface RunColorRecord {
  readonly type: (typeof kinds)[keyof typeof kinds];
  readonly rgb: string | null;
  readonly theme: string | null;
  readonly brightness: number;
}
export function readRunColor(parent: XmlElement): RunColorRecord | null {
  const nodes = parent.children.filter(
    (n) => n.name.namespace === parent.name.namespace && Object.hasOwn(kinds, n.name.localName)
  );
  if (nodes.length > 1) throw new OfficeError("invalid-xml", "Multiple color choices.", "index");
  const node = nodes[0];
  if (!node) return null;
  const attr = (n: XmlElement, key: string) =>
    n.attributes.find((a) => a.name.namespace === "" && a.name.localName === key)?.value;
  const transform = (localName: string) => {
    const children = node.children.filter(
      (n) => n.name.namespace === node.name.namespace && n.name.localName === localName
    );
    if (children.length > 1)
      throw new OfficeError("invalid-xml", "Multiple brightness transforms.", "index");
    return children[0] ? Number(attr(children[0], "val")) / 100000 : undefined;
  };
  const off = transform("lumOff"),
    mod = transform("lumMod");
  return {
    type: kinds[node.name.localName as keyof typeof kinds],
    rgb: node.name.localName === "srgbClr" ? (attr(node, "val") ?? null) : null,
    theme: node.name.localName === "schemeClr" ? (attr(node, "val") ?? null) : null,
    brightness: off ?? (mod === undefined ? 0 : mod - 1)
  };
}
export class RGBColor implements Iterable<number> {
  readonly length = 3;
  readonly 0: number;
  readonly 1: number;
  readonly 2: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  constructor(red: number, green: number, blue: number) {
    if ([red, green, blue].some((v) => !Number.isInteger(v) || v < 0 || v > 255))
      invalid("RGB channels must be integers between 0 and 255.");
    this[0] = red;
    this[1] = green;
    this[2] = blue;
    this.red = red;
    this.green = green;
    this.blue = blue;
    Object.freeze(this);
  }
  at(index: number): number {
    if (!Number.isInteger(index) || index < -3 || index > 2)
      invalid("RGB channel index is out of range.");
    return [this.red, this.green, this.blue][index < 0 ? index + 3 : index]!;
  }
  slice(start?: number, end?: number, step = 1): readonly number[] {
    if (
      !Number.isSafeInteger(step) ||
      step === 0 ||
      [start, end].some((v) => v !== undefined && !Number.isSafeInteger(v))
    )
      invalid("Invalid RGB slice bounds.");
    const normalize = (value: number) =>
      Math.max(step > 0 ? 0 : -1, Math.min(step > 0 ? 3 : 2, value < 0 ? value + 3 : value));
    const first = start === undefined ? (step > 0 ? 0 : 2) : normalize(start);
    const last = end === undefined ? (step > 0 ? 3 : -1) : normalize(end);
    const output: number[] = [];
    for (let i = first; step > 0 ? i < last : i > last; i += step) output.push(this.at(i));
    return Object.freeze(output);
  }
  equals(other: RGBColor): boolean {
    return (
      other instanceof RGBColor &&
      this.red === other.red &&
      this.green === other.green &&
      this.blue === other.blue
    );
  }
  static from_string(value: string): RGBColor {
    validateColor(value);
    return new RGBColor(
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16)
    );
  }
  *[Symbol.iterator](): Iterator<number> {
    yield this.red;
    yield this.green;
    yield this.blue;
  }
  toString(): string {
    return [this.red, this.green, this.blue]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
}

export class ColorPropertyAccessError extends Error {
  override readonly name = "PropertyAccessError";
  readonly code = "property-unavailable";
}

/** A synchronous color view over an explicitly supplied bounded XML part. */
export class ColorFormat {
  #xml: import("./xml.js").XmlPart;
  constructor(xml: import("./xml.js").XmlPart) {
    if (
      !["solidFill", "highlight"].includes(xml.root.name.localName) ||
      ![
        "http://schemas.openxmlformats.org/drawingml/2006/main",
        "http://purl.oclc.org/ooxml/drawingml/main"
      ].includes(xml.root.name.namespace)
    )
      invalid("Color view requires a DrawingML color container.");
    readRunColor(xml.root);
    this.#xml = xml;
  }
  get xml(): import("./xml.js").XmlPart {
    return this.#xml;
  }
  get type(): RunColorRecord["type"] | null {
    return readRunColor(this.#xml.root)?.type ?? null;
  }
  get rgb(): RGBColor {
    const value = readRunColor(this.#xml.root)?.rgb;
    if (value == null) throw new ColorPropertyAccessError("RGB color is unavailable.");
    return RGBColor.from_string(value);
  }
  set rgb(value: RGBColor) {
    if (!(value instanceof RGBColor)) invalid("RGB assignment requires an RGBColor value.");
    this.#xml = this.#xml.merge(
      this.#xml.root,
      colorMerge(value.toString(), this.#xml.root.name.namespace)
    );
  }
  get theme_color(): string {
    const value = readRunColor(this.#xml.root);
    if (value === null) throw new ColorPropertyAccessError("Theme color is unavailable.");
    return value.theme ?? "NOT_THEME_COLOR";
  }
  set theme_color(value: string) {
    this.#xml = this.#xml.merge(
      this.#xml.root,
      colorMerge({ theme: value }, this.#xml.root.name.namespace)
    );
  }
  get brightness(): number {
    return readRunColor(this.#xml.root)?.brightness ?? 0;
  }
  set brightness(value: number) {
    brightness(value);
    const color = this.#xml.root.children.find(
      (n) =>
        n.name.namespace === this.#xml.root.name.namespace && Object.hasOwn(kinds, n.name.localName)
    );
    if (!color) invalid("Brightness requires an explicit color.");
    this.#xml = this.#xml.merge(color, colorBrightnessMerge(value, color.name.namespace));
  }
}
