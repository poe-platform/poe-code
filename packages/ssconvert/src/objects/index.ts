import { parseA1, type ImportedValue, type Range, type Sheet } from "../workbook.js";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { chartDataTypes, type ChartData } from "./data.js";
import { objectKinds, type ObjectKind } from "./registry.js";
export { chartPlugins, sheetObjectTypes, type ObjectKind, type ObjectType } from "./registry.js";
export { chartDataTypes, type ChartData } from "./data.js";

export interface ObjectNode {
  readonly name: string;
  readonly namespace: string;
  readonly text: string;
  readonly attributes: Readonly<Record<string, string>>;
  /** Qualified attributes stay separate from unqualified schema lookups. */
  readonly qualifiedAttributes: readonly { readonly name: string; readonly namespace: string; readonly value: string }[];
  readonly children: readonly ObjectNode[];
}
export interface ChartNode {
  readonly type: string;
  readonly role: string;
  readonly properties: readonly ObjectNode[];
  readonly data: readonly ChartData[];
  readonly children: readonly ChartNode[];
  readonly style?: ObjectStyle;
}
/** Persisted paint values; automatic defaults and font resolution belong to a renderer. */
export interface ObjectStyle {
  readonly type: string;
  readonly line?: Readonly<Record<string, string>>;
  readonly outline?: Readonly<Record<string, string>>;
  readonly fill?: {
    readonly attributes: Readonly<Record<string, string>>;
    readonly pattern?: Readonly<Record<string, string>>;
    readonly gradient?: Readonly<Record<string, string>>;
    readonly image?: Readonly<Record<string, string>>;
  };
  readonly marker?: Readonly<Record<string, string>>;
  readonly font?: Readonly<Record<string, string>>;
  readonly textLayout?: Readonly<Record<string, string>>;
}
export interface SheetObject {
  readonly kind: ObjectKind;
  readonly sourceType: string;
  readonly name: string;
  readonly zOrder: number;
  readonly anchor: { readonly range?: Range; readonly offsets: readonly number[]; readonly mode: string; readonly direction: string };
  readonly graph?: ChartNode;
  readonly style?: ObjectStyle;
  readonly text?: string;
  /** Passive metadata only: components and widget callbacks are never invoked. */
  readonly payload: ObjectNode;
}
/** Project the authoritative codec tree each time, so rewritten links cannot become stale. */
export function sheetObjects(sheet: Sheet, context: CapabilityContext): readonly SheetObject[] {
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  const charge = (amount = 1) => {
    context.signal.throwIfAborted();
    work += amount;
    if (work > maximum) throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
  const node = (value: ImportedValue | undefined, depth = 0): ObjectNode | undefined => {
    charge();
    if (depth > 128) throw new SsconvertError("resource-limit", "ssconvert object depth limit exceeded");
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Readonly<Record<string, ImportedValue>>;
    if (typeof record.name !== "string" || typeof record.namespace !== "string" || typeof record.text !== "string") return undefined;
    charge(record.name.length + record.namespace.length + record.text.length);
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
    const qualifiedAttributes: { name: string; namespace: string; value: string }[] = [];
    for (const item of Array.isArray(record.attributes) ? record.attributes : []) {
      charge();
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const attribute = item as Readonly<Record<string, ImportedValue>>;
      if (typeof attribute.name === "string" && typeof attribute.namespace === "string" && typeof attribute.value === "string") {
        charge(attribute.name.length + attribute.namespace.length + attribute.value.length);
        if (attribute.namespace === "") attributes[attribute.name] = attribute.value;
        else qualifiedAttributes.push({ name: attribute.name, namespace: attribute.namespace, value: attribute.value });
      }
    }
    const children: ObjectNode[] = [];
    for (const child of Array.isArray(record.children) ? record.children : []) {
      const parsed = node(child, depth + 1); if (parsed) children.push(parsed);
    }
    return { name: record.name, namespace: record.namespace, text: record.text, attributes, qualifiedAttributes, children };
  };
  const style = (value: ObjectNode | undefined): ObjectStyle | undefined => {
    if (!value || value.namespace !== "") return undefined;
    charge();
    const components: Record<string, ObjectNode> = Object.create(null) as Record<string, ObjectNode>;
    for (const child of value.children) { charge(); if (child.namespace === "") components[child.name] = child; }
    const fill = components.fill;
    const paints: Record<string, Readonly<Record<string, string>>> = Object.create(null) as Record<string, Readonly<Record<string, string>>>;
    for (const child of fill?.children ?? []) { charge(); if (child.namespace === "" && ["pattern", "gradient", "image"].includes(child.name)) paints[child.name] = child.attributes; }
    return { type: value.attributes.type ?? "",
      ...(components.line ? { line: components.line.attributes } : {}),
      ...(components.outline ? { outline: components.outline.attributes } : {}),
      ...(fill ? { fill: { attributes: fill.attributes, ...paints } } : {}),
      ...(components.marker ? { marker: components.marker.attributes } : {}),
      ...(components.font ? { font: components.font.attributes } : {}),
      ...(components.text_layout ? { textLayout: components.text_layout.attributes } : {}) };
  };
  const chart = (value: ObjectNode): ChartNode => {
    charge();
    const paint = style(value.children.find(child => child.namespace === "" && child.name === "property" && child.attributes.name === "style" && child.attributes.type === "GogStyle"));
    return { type: value.attributes.type ?? "", role: value.attributes.role ?? "",
      properties: value.children.filter(child => child.namespace === "" && child.name === "property"),
      data: value.children.filter(child => child.namespace === "" && child.name === "data").flatMap(child => child.children.filter(dimension => dimension.namespace === "" && dimension.name === "dimension").map(dimension => {
        const type = dimension.attributes.type ?? "";
        const storage = Object.hasOwn(chartDataTypes, type) ? chartDataTypes[type]!.storage : "unknown";
        return { id: dimension.attributes.id ?? "", type, serialized: dimension.text, storage,
          ...(storage === "expression" ? { expression: dimension.text } : {}) };
      })),
      children: value.children.filter(child => child.namespace === "" && child.name === "GogObject").map(chart),
      ...(paint ? { style: paint } : {}) };
  };
  const result: SheetObject[] = [];
  charge();
  for (const record of sheet.unsupportedRecords ?? []) {
    charge();
    if (record.source !== "Gnumeric_XmlIO:sax" || record.kind !== "Objects" || record.disposition !== "retained") continue;
    const root = node(record.data); if (!root || root.name !== "Objects") continue;
    for (const payload of root.children) {
      charge();
      const kind = Object.hasOwn(objectKinds, payload.name) ? objectKinds[payload.name] : undefined;
      if (!kind || payload.namespace !== root.namespace) continue;
      const bounds = (payload.attributes.ObjectBound ?? "").split(":");
      const start = bounds[0] ? parseA1(bounds[0]) : undefined;
      const end = start ? parseA1(bounds[1] ?? bounds[0]!) : undefined;
      const graph = kind === "graph" ? payload.children.find(child => child.namespace === "" && child.name === "GogObject") : undefined;
      const paint = style(payload.children.find(child => child.namespace === "" && child.name === "Style"));
      const text = kind === "comment" ? payload.attributes.Text : kind === "shape" || kind === "control" ? payload.attributes.Label : undefined;
      const offsets = (payload.attributes.ObjectOffset ?? "").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", " ").split(" ").filter(Boolean).map(Number);
      result.push({ kind, sourceType: payload.name, name: payload.attributes.Name ?? "", zOrder: result.length,
        anchor: { ...(start && end ? { range: { startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column } } : {}),
          offsets: offsets.length === 4 && offsets.every(Number.isFinite) ? offsets : [], mode: payload.attributes.AnchorMode ?? "0", direction: payload.attributes.Direction ?? "0" },
        ...(graph ? { graph: chart(graph) } : {}), ...(paint ? { style: paint } : {}), ...(text !== undefined ? { text } : {}), payload });
    }
  }
  return result;
}
