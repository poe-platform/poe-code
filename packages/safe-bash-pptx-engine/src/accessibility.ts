import { SaxesParser } from "saxes";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, loadShared, required } from "./masters.js";
import { nodeFor, selected, validateSelection, type ShapeSelection } from "./shape-operations.js";
import { validateShapeOptions } from "./shapes.js";
import {
  readSelectionIndex,
  SelectionError,
  type SelectionContext,
  type SelectionRecord
} from "./selectors.js";
import type { XmlElement, XmlPart } from "./xml.js";

export interface AccessibilityUpdate {
  readonly altText?: string;
  readonly title?: string;
  readonly decorative?: boolean;
}
export interface AccessibilityProvenance {
  readonly part: string;
  readonly shapeId: string;
  readonly inherited: boolean;
}
export interface AccessibilityObject {
  readonly id: string;
  readonly name: string;
  readonly part: string;
  readonly location: SelectionRecord["location"];
  readonly token: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly altText: string | null;
  readonly decorative: boolean | null;
  readonly structuralOrder: number;
  readonly inheritedBy: readonly number[];
  readonly provenance: {
    readonly title: AccessibilityProvenance | null;
    readonly description: AccessibilityProvenance | null;
    readonly decorative: AccessibilityProvenance | null;
  };
}
export interface AccessibilitySlideCheck {
  readonly slide: number;
  readonly part: string;
  readonly titles: readonly string[];
  readonly missingTitle: boolean;
  readonly duplicateTitle: boolean;
  readonly multipleTitles: boolean;
}
const decorativeNamespace = "http://schemas.microsoft.com/office/drawing/2017/decorative";
const decorativeExtension = "{C183D7F6-B498-43B3-948B-1728B52AA6E4}";
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function stored<T>(value: T, keys: readonly string[]): T {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !keys.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)!)
    )
  )
    invalid("Expected stored accessibility option fields.");
  return Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, descriptor]) => [
      key,
      descriptor.value
    ])
  ) as T;
}
function nonvisual(node: XmlElement) {
  const nv = node.children.find(
    (x) =>
      x.name.namespace === node.name.namespace &&
      ["nvSpPr", "nvPicPr", "nvGraphicFramePr", "nvGrpSpPr", "nvCxnSpPr"].includes(x.name.localName)
  );
  return required(nv ?? invalid("Object has no nonvisual properties."), "cNvPr");
}
function placeholder(node: XmlElement) {
  const nv = node.children.find(
    (x) =>
      x.name.namespace === node.name.namespace &&
      ["nvSpPr", "nvPicPr", "nvGraphicFramePr"].includes(x.name.localName)
  );
  const pr = nv && child(nv, "nvPr");
  return pr && child(pr, "ph");
}
function decoration(cn: XmlElement, drawing: string) {
  const list = child(cn, "extLst", drawing);
  const nodes = (list?.children ?? [])
    .filter(
      (x) =>
        x.name.namespace === drawing &&
        x.name.localName === "ext" &&
        attr(x, "uri") === decorativeExtension
    )
    .flatMap((x) =>
      x.children.filter(
        (y) => y.name.namespace === decorativeNamespace && y.name.localName === "decorative"
      )
    );
  if (nodes.length > 1)
    throw new OfficeError("unsupported-edit", "Ambiguous decorative metadata.", "validate-intent");
  const rawValue = nodes[0] && attr(nodes[0], "val");
  let start = 0,
    end = rawValue?.length ?? 0;
  while (
    rawValue !== undefined &&
    start < end &&
    [" ", "\t", "\n", "\r"].includes(rawValue[start]!)
  )
    start++;
  while (
    rawValue !== undefined &&
    end > start &&
    [" ", "\t", "\n", "\r"].includes(rawValue[end - 1]!)
  )
    end--;
  const value = rawValue?.slice(start, end);
  if (value !== undefined && !["0", "1", "false", "true"].includes(value))
    throw new OfficeError("invalid-xml", "Invalid decorative boolean.", "parse");
  return {
    list,
    node: nodes[0],
    value: value === undefined ? null : ["1", "true"].includes(value)
  };
}
function raw(s: Awaited<ReturnType<typeof loadShared>>, record: SelectionRecord) {
  const node = nodeFor(s.doc(record.part).root, record.id),
    cn = nonvisual(node);
  return {
    node,
    title: attr(cn, "title") ?? null,
    description: attr(cn, "descr") ?? null,
    decorative: decoration(cn, s.a).value,
    decorativePresent: decoration(cn, s.a).node !== undefined
  };
}
function layoutPlaceholder(
  s: Awaited<ReturnType<typeof loadShared>>,
  record: SelectionRecord,
  node: XmlElement
) {
  const ph = placeholder(node),
    slide = s.index.inventory.slides.find((x) => x.part === record.part);
  const candidates =
    ph && slide?.layout
      ? s.index.objects
          .filter((x) => x.part === slide.layout)
          .filter((x) => {
            const candidate = placeholder(nodeFor(s.doc(x.part).root, x.id));
            return candidate && (attr(candidate, "idx") ?? "0") === (attr(ph, "idx") ?? "0");
          })
      : [];
  if (candidates.length > 1)
    throw new SelectionError(
      "ambiguous-selection",
      candidates.map((x) => x.location)
    );
  return candidates[0];
}
function inspect(
  s: Awaited<ReturnType<typeof loadShared>>,
  records: readonly SelectionRecord[]
): AccessibilityObject[] {
  return records.map((record) => {
    const direct = raw(s, record);
    const layout = layoutPlaceholder(s, record, direct.node);
    const fallback = layout && raw(s, layout);
    const provenance: {
      title: AccessibilityProvenance | null;
      description: AccessibilityProvenance | null;
      decorative: AccessibilityProvenance | null;
    } = { title: null, description: null, decorative: null };
    const values = {
      title: direct.title,
      description: direct.description,
      decorative: direct.decorative
    };
    for (const key of ["title", "description", "decorative"] as const) {
      const source =
        direct[key] !== null || (key === "decorative" && direct.decorativePresent)
          ? record
          : fallback?.[key] !== null && fallback?.[key] !== undefined
            ? layout
            : undefined;
      if (source) {
        provenance[key] = { part: source.part, shapeId: source.id, inherited: source !== record };
        if (key === "decorative")
          values.decorative = source === record ? direct.decorative : fallback!.decorative;
        else values[key] = source === record ? direct[key] : fallback![key];
      }
    }
    return {
      id: record.id,
      name: record.name,
      part: record.part,
      location: record.location,
      token: record.token,
      ...values,
      altText: values.description,
      structuralOrder: record.position,
      inheritedBy: s.affected(record.part),
      provenance
    };
  });
}
export async function readAccessibility(
  input: BinaryInput,
  options: ShapeSelection,
  context: SelectionContext
) {
  options = stored(options, ["scope", "slide", "part", "shape", "select"]);
  validateSelection(options, "read");
  if (options.select !== undefined && options.scope !== undefined)
    throw new SelectionError("invalid-selection");
  const s = await loadShared(input, context, false);
  const records = selected(s, options);
  const titles = s.index.inventory.slides.map((slide) => {
    const values: string[] = [];
    for (const record of s.index.objects.filter((x) => x.part === slide.part)) {
      const doc = s.doc(record.part),
        node = nodeFor(doc.root, record.id),
        ph = placeholder(node);
      if (!ph) continue;
      const layout = layoutPlaceholder(s, record, node);
      const inheritedPh = layout && placeholder(nodeFor(s.doc(layout.part).root, layout.id));
      const type = attr(ph, "type") ?? (inheritedPh && attr(inheritedPh, "type")) ?? "obj";
      if (!["title", "ctrTitle"].includes(type)) continue;
      const body = child(node, "txBody");
      if (!body) continue;
      let text = "",
        inText = false;
      const parser = new SaxesParser({ xmlns: true });
      parser.on("opentag", (tag) => {
        if (tag.uri === s.a && tag.local === "t") inText = true;
      });
      parser.on("text", (value) => {
        if (inText) text += value;
      });
      parser.on("cdata", (value) => {
        if (inText) text += value;
      });
      parser.on("closetag", (tag) => {
        if (tag.uri === s.a && tag.local === "t") inText = false;
        if (tag.uri === s.a && ["p", "br"].includes(tag.local)) text += "\n";
      });
      parser.write(doc.markup(body, true)).close();
      if (text.trim()) values.push(text.trim());
    }
    return { slide: slide.position, part: slide.part, titles: values };
  });
  const owners = options.select
    ? s.index.select({ token: options.select }).map((x) => x.part)
    : null;
  const slides: AccessibilitySlideCheck[] = titles
    .filter(
      (x) =>
        (options.scope === undefined || options.scope === "slides" || options.scope === "shared") &&
        (options.slide === undefined || x.slide === options.slide) &&
        (!options.part || x.part === options.part) &&
        (!owners || owners.includes(x.part)) &&
        (options.shape === undefined || records.some((record) => record.part === x.part))
    )
    .map((x) => ({
      ...x,
      missingTitle: x.titles.length === 0,
      multipleTitles: x.titles.length > 1,
      duplicateTitle: x.titles.some((title) =>
        titles.some((other) => other.slide !== x.slide && other.titles.includes(title))
      )
    }));
  return {
    objects: inspect(s, records),
    slides,
    order: "structural" as const,
    limitations: [
      "Structural metadata checks do not certify accessibility, visual reading order, or contrast.",
      "Layout metadata fallback is an explicit structural policy for uniquely matched placeholder indices; renderer inheritance is not asserted."
    ]
  };
}
export function validateAccessibilityUpdate(update: AccessibilityUpdate): void {
  update = stored(update, ["altText", "title", "decorative"]);
  if (!Object.keys(update).some((key) => update[key as keyof AccessibilityUpdate] !== undefined))
    invalid("Provide accessibility metadata to set.");
  for (const key of ["altText", "title"] as const)
    if (update[key] !== undefined && typeof update[key] !== "string")
      invalid("Accessibility metadata requires strings.");
  if (update.decorative !== undefined && typeof update.decorative !== "boolean")
    invalid("Decorative requires a boolean.");
  validateShapeOptions({
    ...(update.altText === undefined ? {} : { altText: update.altText }),
    ...(update.title === undefined ? {} : { title: update.title })
  });
}
export async function mutateAccessibility(
  input: BinaryInput,
  options: ShapeSelection & { readonly update: AccessibilityUpdate },
  context: SelectionContext
) {
  options = stored(options, [
    "scope",
    "slide",
    "part",
    "shape",
    "select",
    "all",
    "allowEmpty",
    "update"
  ]);
  validateAccessibilityUpdate(options.update);
  const { update: suppliedUpdate, ...selection } = options;
  const update = stored(suppliedUpdate, ["altText", "title", "decorative"]);
  validateSelection(selection, "set");
  if (selection.select !== undefined && selection.scope !== undefined)
    throw new SelectionError("invalid-selection");
  if (
    !selection.select &&
    selection.shape === undefined &&
    selection.slide === undefined &&
    !selection.part &&
    !selection.all
  )
    throw new SelectionError("invalid-selection");
  const s = await loadShared(input, context),
    records = selected(s, selection);
  if (!records.length && !selection.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && !selection.all)
    throw new SelectionError(
      "ambiguous-selection",
      records.map((x) => x.location)
    );
  for (const record of records) {
    let doc: XmlPart = s.doc(record.part);
    let cn = nonvisual(nodeFor(doc.root, record.id));
    decoration(cn, s.a);
    doc = doc.merge(cn, {
      attributes: [
        ...(update.altText === undefined
          ? []
          : [{ namespace: "", localName: "descr", value: update.altText }]),
        ...(update.title === undefined
          ? []
          : [{ namespace: "", localName: "title", value: update.title }])
      ]
    });
    if (update.decorative !== undefined) {
      cn = nonvisual(nodeFor(doc.root, record.id));
      const existing = decoration(cn, s.a),
        value = update.decorative ? "1" : "0";
      if (existing.node)
        doc = doc.merge(existing.node, {
          attributes: [{ namespace: "", localName: "val", value }]
        });
      else {
        const xml = `<a:ext xmlns:a="${s.a}" uri="${decorativeExtension}"><adec:decorative xmlns:adec="${decorativeNamespace}" val="${value}"/></a:ext>`;
        doc = existing.list
          ? doc.spliceChildren(existing.list, existing.list.children.length, 0, [xml])
          : doc.spliceChildren(cn, cn.children.length, 0, [
              `<a:extLst xmlns:a="${s.a}">${xml}</a:extLst>`
            ]);
      }
    }
    s.save(record.part, doc);
  }
  const affectedSlides = s.index.inventory.slides
    .filter((x) => records.some((record) => [x.part, x.layout, x.master].includes(record.part)))
    .map((x) => x.position);
  const bytes = records.length
    ? (await s.finish(records[0]!.part, affectedSlides)).bytes
    : s.source;
  const nextIndex = records.length ? await readSelectionIndex(bytes, context) : s.index;
  return {
    bytes,
    affected: records.length,
    affectedSlides,
    records: records.map(
      (record) => nextIndex.objects.find((x) => x.part === record.part && x.id === record.id)!
    )
  };
}
