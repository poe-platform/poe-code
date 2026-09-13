import type { BinaryInput, Scope } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, loadShared, required } from "./masters.js";
import { SelectionError, type SelectionContext, type SelectionRecord } from "./selectors.js";
import {
  applyShapeUpdate,
  createShapeXml,
  readShape,
  validateShapeOptions,
  type ShapeUpdate
} from "./shapes.js";
import type { XmlElement } from "./xml.js";
import { readShapeGeometry } from "./shape-transforms.js";

export interface ShapeSelection {
  readonly scope?: Scope;
  readonly slide?: number;
  readonly part?: string;
  readonly shape?: string;
  readonly select?: string;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
export function validateSelection(options: ShapeSelection, action: "read" | "add" | "set") {
  const allowed = [
    "scope",
    "slide",
    "part",
    "shape",
    "select",
    ...(action === "read" ? [] : ["update"]),
    ...(action === "set" ? ["all", "allowEmpty"] : [])
  ];
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some((key) => !allowed.includes(key))
  )
    throw new OfficeError("invalid-value", "Invalid shape selection options.", "usage");
  for (const key of ["part", "shape", "select"] as const)
    if (options[key] !== undefined && (typeof options[key] !== "string" || !options[key].length))
      throw new OfficeError("invalid-value", "Shape selectors require nonempty strings.", "usage");
  for (const key of ["all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      throw new OfficeError("invalid-value", "Selection controls require booleans.", "usage");
  if (options.slide !== undefined && (!Number.isSafeInteger(options.slide) || options.slide < 1))
    throw new OfficeError(
      "invalid-value",
      "Slide position requires a positive safe integer.",
      "usage"
    );
  if (
    options.scope !== undefined &&
    !["slides", "layouts", "masters", "shared"].includes(options.scope)
  )
    throw new OfficeError("invalid-value", "Unsupported shape scope.", "usage");
  if (
    (options.part && options.slide !== undefined) ||
    (options.select &&
      (options.slide !== undefined ||
        options.part !== undefined ||
        options.shape !== undefined ||
        options.all))
  )
    throw new SelectionError("invalid-selection");
}
export function selected(
  s: Awaited<ReturnType<typeof loadShared>>,
  options: ShapeSelection,
  adding = false
) {
  if (
    options.select &&
    (options.slide !== undefined ||
      options.part !== undefined ||
      options.shape !== undefined ||
      options.all)
  )
    throw new SelectionError("invalid-selection");
  if (options.part && options.slide !== undefined) throw new SelectionError("invalid-selection");
  if (options.slide !== undefined && (!Number.isSafeInteger(options.slide) || options.slide < 1))
    throw new SelectionError("invalid-selection");
  const scope = options.scope ?? "slides";
  if (!["slides", "layouts", "masters", "shared"].includes(scope))
    throw new SelectionError("invalid-selection");
  let records: readonly SelectionRecord[] = adding ? s.index.parts : s.index.objects;
  if (options.select) {
    const targets = s.index.select({ token: options.select });
    if (
      options.scope !== undefined &&
      options.scope !== "shared" &&
      targets.some((x) => x.scope !== options.scope)
    )
      throw new SelectionError("invalid-selection");
    if (targets.some((x) => !["slides", "layouts", "masters"].includes(x.scope)))
      throw new SelectionError("invalid-selection");
    records = records.filter((x) =>
      targets.some((t) =>
        adding
          ? t.part === x.part && t.kind !== "object"
          : t.part === x.part && (t.kind !== "object" || t.id === x.id)
      )
    );
  } else {
    if (scope === "shared" && !options.part) throw new SelectionError("invalid-selection");
    records = records.filter((x) =>
      scope === "shared" ? ["slides", "layouts", "masters"].includes(x.scope) : x.scope === scope
    );
    if (options.part) records = records.filter((x) => x.part === options.part);
    if (options.slide !== undefined) {
      const slide = s.index.inventory.slides.find((x) => x.position === options.slide);
      const part =
        scope === "masters" ? slide?.master : scope === "layouts" ? slide?.layout : slide?.part;
      records = records.filter((x) => x.part === part);
    }
    if (options.shape !== undefined) records = records.filter((x) => x.name === options.shape);
  }
  return records;
}
export function nodeFor(root: XmlElement, id: string): XmlElement {
  const pending = [root];
  while (pending.length) {
    const node = pending.shift()!;
    const nv =
      node.name.namespace === root.name.namespace &&
      ["sp", "pic", "graphicFrame", "cxnSp", "grpSp"].includes(node.name.localName)
        ? node.children.find(
            (x) =>
              x.name.namespace === root.name.namespace &&
              ["nvSpPr", "nvPicPr", "nvGraphicFramePr", "nvCxnSpPr", "nvGrpSpPr"].includes(
                x.name.localName
              )
          )
        : undefined;
    if (
      nv &&
      Number.isInteger(Number(id)) &&
      Number(id) >= 0 &&
      Number(attr(required(nv, "cNvPr"), "id")) === Number(id)
    )
      return node;
    pending.unshift(...node.children);
  }
  throw new SelectionError("missing-selection");
}
export async function readShapes(
  input: BinaryInput,
  options: ShapeSelection,
  context: SelectionContext
) {
  validateSelection(options, "read");
  const s = await loadShared(input, context, false);
  return selected(s, options).map((record) => {
    const root = s.doc(record.part).root;
    const node = nodeFor(root, record.id);
    return {
      ...readShape(node),
      geometry: readShapeGeometry(root, node),
      location: record.location,
      token: record.token,
      part: record.part
    };
  });
}
export async function mutateShapes(
  input: BinaryInput,
  options: ShapeSelection & { readonly update: ShapeUpdate },
  context: SelectionContext
) {
  validateSelection(options, "set");
  validateShapeOptions(options.update);
  const s = await loadShared(input, context);
  if (
    !options.select &&
    options.shape === undefined &&
    options.slide === undefined &&
    !options.part &&
    !options.all
  )
    throw new SelectionError("invalid-selection");
  const records = selected(s, options);
  if (!records.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      records.map((x) => x.location)
    );
  for (const record of records) {
    const doc = s.doc(record.part);
    s.save(record.part, applyShapeUpdate(doc, nodeFor(doc.root, record.id), options.update));
  }
  const result = await s.finish(
    records[0]?.part ?? s.main,
    s.index.inventory.slides
      .filter((x) => records.some((r) => [x.part, x.master, x.layout].includes(r.part)))
      .map((x) => x.position)
  );
  return { ...result, affected: records.length, records };
}
export async function addShape(
  input: BinaryInput,
  options: ShapeSelection & { readonly update: ShapeUpdate },
  context: SelectionContext
) {
  validateSelection(options, "add");
  validateShapeOptions(options.update, true);
  if (options.shape !== undefined || options.all || options.allowEmpty)
    throw new SelectionError("invalid-selection");
  const s = await loadShared(input, context);
  const targets = selected(s, options, true);
  if (targets.length !== 1)
    throw new SelectionError(
      targets.length ? "ambiguous-selection" : "missing-selection",
      targets.map((x) => x.location)
    );
  const target = targets[0]!;
  const doc = s.doc(target.part);
  const tree = required(required(doc.root, "cSld"), "spTree");
  let id = 1;
  const used = new Set<number>();
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.name.namespace === doc.root.name.namespace && node.name.localName === "cNvPr") {
      const value = Number(attr(node, "id"));
      used.add(value);
      id = Math.max(id, value + 1);
    }
    pending.push(...node.children);
  }
  if (id > 4294967295) {
    id = 1;
    while (used.has(id)) id++;
  }
  if (!Number.isSafeInteger(id) || id > 4294967295)
    throw new OfficeError("invalid-value", "No available shape identity.", "validate-intent");
  const extension = child(tree, "extLst");
  s.save(
    target.part,
    doc.spliceChildren(
      tree,
      extension ? tree.children.indexOf(extension) : tree.children.length,
      0,
      [createShapeXml(options.update.kind!, id, options.update, doc.root.name.namespace)]
    )
  );
  return {
    ...(await s.finish(
      target.part,
      s.index.inventory.slides
        .filter((x) => [x.part, x.master, x.layout].includes(target.part))
        .map((x) => x.position)
    )),
    affected: 1,
    records: [{ ...target, id: String(id) }]
  };
}
