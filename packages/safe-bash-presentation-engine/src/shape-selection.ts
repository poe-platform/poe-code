import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { attr, child, loadShared, required } from "./masters.js";
import { nodeFor, selected, validateSelection, type ShapeSelection } from "./shape-operations.js";
import { readSelectionIndex, SelectionError, type SelectionContext } from "./selectors.js";
import { applyShapeUpdate, readShape } from "./shapes.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";

export type ShapeOrder = "front" | "back" | "forward" | "backward";
export type ShapeAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type ShapeAxis = "horizontal" | "vertical";
export type ShapeSelectionAction =
  | { readonly action: "move"; readonly order?: ShapeOrder; readonly position?: number }
  | { readonly action: "align"; readonly alignment: ShapeAlignment }
  | { readonly action: "distribute"; readonly axis: ShapeAxis }
  | { readonly action: "duplicate"; readonly offsetX: Length; readonly offsetY: Length };
export type ShapeSelectionOptions = ShapeSelection &
  ShapeSelectionAction & {
    readonly shapes?: readonly Location[];
    readonly coordinateSystem: "slide" | "group";
  };
const kinds = ["sp", "pic", "cxnSp", "graphicFrame", "grpSp"];
const bound = 27273042316900;
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function data(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
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
    invalid("Expected exact stored selection data fields.");
}
function length(value: unknown) {
  if (
    !(value instanceof Length) ||
    !("value" in (Object.getOwnPropertyDescriptor(value, "emu") ?? {})) ||
    !Number.isSafeInteger(value.emu) ||
    Math.abs(value.emu) > bound
  )
    invalid("An explicit bounded offset Length is required.");
}
export function validateShapeSelectionOptions(options: ShapeSelectionOptions): void {
  data(options, [
    "action",
    "coordinateSystem",
    "shapes",
    "scope",
    "slide",
    "part",
    "shape",
    "select",
    "all",
    "allowEmpty",
    "order",
    "position",
    "alignment",
    "axis",
    "offsetX",
    "offsetY"
  ]);
  if (!["slide", "group"].includes(options.coordinateSystem))
    invalid("Explicit slide or group coordinate space is required.");
  const actionKeys = {
    move: ["order", "position"],
    align: ["alignment"],
    distribute: ["axis"],
    duplicate: ["offsetX", "offsetY"]
  };
  if (!Object.hasOwn(actionKeys, options.action)) invalid("Unknown selection action.");
  const allowed = actionKeys[options.action];
  for (const key of ["order", "position", "alignment", "axis", "offsetX", "offsetY"])
    if (Object.hasOwn(options, key) && !allowed.includes(key))
      invalid("Unexpected selection action option.");
  if (options.action === "move") {
    if ((options.order === undefined) === (options.position === undefined))
      invalid("Exactly one order or position is required.");
    if (
      options.order !== undefined &&
      !["front", "back", "forward", "backward"].includes(options.order)
    )
      invalid("Invalid sibling order.");
    if (
      options.position !== undefined &&
      (!Number.isSafeInteger(options.position) || options.position < 1)
    )
      invalid("Position requires a positive one-based integer.");
  } else if (options.action === "align") {
    if (!["left", "center", "right", "top", "middle", "bottom"].includes(options.alignment))
      invalid("Invalid alignment.");
  } else if (options.action === "distribute") {
    if (!["horizontal", "vertical"].includes(options.axis)) invalid("Invalid distribution axis.");
  } else {
    length(options.offsetX);
    length(options.offsetY);
  }
  if (options.shapes !== undefined) {
    if (!Array.isArray(options.shapes) || !options.shapes.length)
      throw new SelectionError("invalid-selection");
    const descriptors = Object.getOwnPropertyDescriptors(options.shapes);
    const arrayKeys = Reflect.ownKeys(descriptors);
    if (
      arrayKeys.length !== options.shapes.length + 1 ||
      arrayKeys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (!Number.isSafeInteger(Number(key)) ||
              Number(key) < 0 ||
              String(Number(key)) !== key ||
              Number(key) >= options.shapes!.length)) ||
          !("value" in descriptors[key as string]!)
      )
    )
      invalid("Identity arrays require dense stored entries.");
    for (const location of options.shapes) {
      const keys = ["fingerprint", "scope", "owner", "objectId", "coordinateSystem"];
      data(location, keys);
      if (
        keys.some(
          (key) => typeof location[key] !== "string" || !(location[key] as string).length
        ) ||
        location.coordinateSystem !== "identity"
      )
        invalid("Invalid identity location.");
    }
    if (
      ["slide", "part", "shape", "select", "all", "allowEmpty"].some((key) =>
        Object.hasOwn(options, key)
      )
    )
      throw new SelectionError("invalid-selection");
  }
  const selection = Object.fromEntries(
    Object.entries(options).filter(([key]) =>
      ["scope", "slide", "part", "shape", "select", "all", "allowEmpty"].includes(key)
    )
  );
  validateSelection(selection, "set");
}
function walk(root: XmlElement): XmlElement[] {
  const nodes: XmlElement[] = [],
    pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    nodes.push(node);
    pending.push(...[...node.children].reverse());
  }
  return nodes;
}
function identity(node: XmlElement) {
  const nv = node.children.find(
    (n) =>
      n.name.namespace === node.name.namespace &&
      ["nvSpPr", "nvPicPr", "nvCxnSpPr", "nvGraphicFramePr", "nvGrpSpPr"].includes(n.name.localName)
  );
  return (
    attr(required(nv ?? unsupported("Missing shape identity."), "cNvPr"), "id") ??
    unsupported("Missing shape identity.")
  );
}
function admitted(doc: XmlPart, ids: readonly string[], options: ShapeSelectionOptions) {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new SelectionError("invalid-selection");
  const nodes = ids.map((id) => nodeFor(doc.root, id)),
    all = walk(doc.root);
  const parents = new Map<XmlElement, XmlElement>();
  for (const node of all) for (const child of node.children) parents.set(child, node);
  const parent = parents.get(nodes[0]!)!;
  if (
    !parent ||
    !["spTree", "grpSp"].includes(parent.name.localName) ||
    nodes.some((node) => parents.get(node) !== parent) ||
    (parent.name.localName === "grpSp" ? "group" : "slide") !== options.coordinateSystem
  )
    throw new SelectionError("invalid-selection");
  const selectedNodes = new Set(nodes);
  const ordered = parent.children.filter((n) => selectedNodes.has(n));
  for (const root of ordered) {
    const affected = walk(root);
    let ancestor = parents.get(root);
    while (ancestor) {
      if (ancestor.name.localName === "grpSp")
        affected.push(
          ...ancestor.children.filter((n) => n.name.localName === "nvGrpSpPr").flatMap(walk)
        );
      ancestor = parents.get(ancestor);
    }
    for (const n of affected)
      if (
        [
          "http://schemas.openxmlformats.org/drawingml/2006/main",
          "http://purl.oclc.org/ooxml/drawingml/main"
        ].includes(n.name.namespace) &&
        ["spLocks", "picLocks", "cxnSpLocks", "graphicFrameLocks", "grpSpLocks"].includes(
          n.name.localName
        ) &&
        n.attributes.some(
          (a) =>
            a.name.namespace === "" &&
            ["noSelect", options.action === "duplicate" ? "noCopy" : "noMove"].includes(
              a.name.localName
            ) &&
            ["1", "true"].includes(a.value)
        )
      )
        unsupported("The selection contains locked objects.");
  }
  return { parent, ordered, all };
}
function box(node: XmlElement) {
  const shape = readShape(node);
  const values = [shape.left, shape.top, shape.width, shape.height];
  if (
    values.some((v) => v === null || !Number.isSafeInteger(v) || Math.abs(v) > bound) ||
    shape.width! <= 0 ||
    shape.height! <= 0
  )
    unsupported("Selection operations require explicit bounded geometry.");
  return { id: identity(node), x: shape.left!, y: shape.top!, w: shape.width!, h: shape.height! };
}
function round(n: bigint, d = 1n) {
  const sign = n < 0n ? -1n : 1n,
    abs = n * sign;
  const result = Number(sign * ((abs + d / 2n) / d));
  if (!Number.isSafeInteger(result) || Math.abs(result) > bound)
    invalid("Selection coordinates exceed the admitted bounds.");
  return result;
}
export function applyShapeSelection(
  doc: XmlPart,
  ids: readonly string[],
  options: ShapeSelectionOptions
): { doc: XmlPart; ids: readonly string[] } {
  validateShapeSelectionOptions(options);
  const { parent, ordered, all } = admitted(doc, ids, options),
    originalIds = ordered.map(identity);
  if (options.action === "move") {
    const siblings = parent.children.filter(
        (n) => n.name.namespace === parent.name.namespace && kinds.includes(n.name.localName)
      ),
      chosen = new Set(ordered);
    let next = [...siblings];
    if (options.order === "front" || options.order === "back" || options.position !== undefined) {
      next = siblings.filter((n) => !chosen.has(n));
      const index =
        options.position !== undefined
          ? options.position - 1
          : options.order === "back"
            ? 0
            : next.length;
      if (index > next.length) invalid("Sibling position exceeds the available insertion range.");
      next.splice(index, 0, ...ordered);
    } else if (options.order === "forward") {
      for (let i = next.length - 2; i >= 0; i--)
        if (chosen.has(next[i]!) && !chosen.has(next[i + 1]!))
          [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
    } else {
      for (let i = 1; i < next.length; i++)
        if (chosen.has(next[i]!) && !chosen.has(next[i - 1]!))
          [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    }
    let index = 0;
    return {
      doc: doc.reorderChildren(
        parent,
        parent.children.map((n) => (siblings.includes(n) ? next[index++]! : n))
      ),
      ids: originalIds
    };
  }
  if (options.action === "duplicate") {
    const used = new Set<number>();
    for (const n of all.filter(
      (n) => n.name.namespace === doc.root.name.namespace && n.name.localName === "cNvPr"
    )) {
      const value = attr(n, "id");
      if (
        !value?.length ||
        [...value].some((c) => c < "0" || c > "9") ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) > 4294967295 ||
        used.has(Number(value))
      )
        unsupported("Invalid or duplicate shape identity.");
      used.add(Number(value));
    }
    let next = 1;
    for (const id of used) next = Math.max(next, id + 1);
    const drawing =
      doc.root.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main"
        ? "http://purl.oclc.org/ooxml/drawingml/main"
        : "http://schemas.openxmlformats.org/drawingml/2006/main";
    const relationships =
      doc.root.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main"
        ? "http://purl.oclc.org/ooxml/officeDocument/relationships"
        : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const mapping = new Map<string, string>();
    for (const node of ordered.flatMap(walk)) {
      if (
        ![doc.root.name.namespace, drawing].includes(node.name.namespace) ||
        node.attributes.some(
          (a) =>
            ![
              "",
              relationships,
              "http://www.w3.org/XML/1998/namespace",
              "http://www.w3.org/2000/xmlns/"
            ].includes(a.name.namespace)
        )
      )
        unsupported("Opaque copied namespaces or attributes cannot be duplicated safely.");
      if (node.name.localName === "extLst" && node.children.length)
        unsupported("Opaque duplicate-local extensions cannot be remapped safely.");
      if (node.name.namespace === doc.root.name.namespace && kinds.includes(node.name.localName)) {
        if (next > 4294967295) {
          next = 1;
          while (used.has(next)) next++;
        }
        if (next > 4294967295) unsupported("No available shape identity.");
        mapping.set(String(Number(identity(node))), String(next));
        used.add(next++);
      }
      if (node.attributes.some((a) => ["spid", "spId", "shapeId"].includes(a.name.localName)))
        unsupported("Duplicate-local timing references are unsupported.");
    }
    const copies: string[] = [];
    for (const original of ordered) {
      let copy = parseXmlPart(new TextEncoder().encode(doc.markup(original, true)), {
        maxBytes: doc.bytes().length * 2 + 1024,
        maxNodes: doc.nodeCount + 1,
        maxDepth: doc.nodeCount + 1
      });
      const originalNodes = walk(copy.root);
      for (let i = 0; i < originalNodes.length; i++) {
        const node = walk(copy.root)[i]!;
        if (node.name.localName === "cNvPr" && node.name.namespace === doc.root.name.namespace)
          copy = copy.merge(node, {
            attributes: [
              {
                namespace: "",
                localName: "id",
                value: mapping.get(String(Number(attr(node, "id"))))!
              }
            ]
          });
        else if (
          ["stCxn", "endCxn"].includes(node.name.localName) &&
          node.name.namespace === drawing &&
          mapping.has(String(Number(attr(node, "id"))))
        )
          copy = copy.merge(node, {
            attributes: [
              {
                namespace: "",
                localName: "id",
                value: mapping.get(String(Number(attr(node, "id"))))!
              }
            ]
          });
      }
      const g = box(copy.root);
      const owner =
        copy.root.name.localName === "graphicFrame"
          ? copy.root
          : required(copy.root, copy.root.name.localName === "grpSp" ? "grpSpPr" : "spPr");
      const transform = child(
        owner,
        "xfrm",
        copy.root.name.localName === "graphicFrame" ? copy.root.name.namespace : drawing
      )!;
      const off = child(transform, "off", drawing)!;
      copy = copy.merge(off, {
        attributes: [
          {
            namespace: "",
            localName: "x",
            value: String(round(BigInt(g.x) + BigInt(options.offsetX.emu)))
          },
          {
            namespace: "",
            localName: "y",
            value: String(round(BigInt(g.y) + BigInt(options.offsetY.emu)))
          }
        ]
      });
      copies.push(copy.markup(copy.root, true));
    }
    const last = parent.children.reduce(
      (index, n, i) =>
        n.name.namespace === parent.name.namespace && kinds.includes(n.name.localName) ? i : index,
      -1
    );
    return {
      doc: doc.spliceChildren(parent, last + 1, 0, copies),
      ids: originalIds.map((id) => mapping.get(String(Number(id)))!)
    };
  }
  const boxes = ordered.map(box);
  if (boxes.length < (options.action === "align" ? 2 : 3))
    throw new SelectionError("invalid-selection");
  const horizontal =
    options.action === "align"
      ? ["left", "center", "right"].includes(options.alignment)
      : options.axis === "horizontal";
  const start = (b: (typeof boxes)[number]) => BigInt(horizontal ? b.x : b.y),
    size = (b: (typeof boxes)[number]) => BigInt(horizontal ? b.w : b.h);
  const positions = new Map<string, number>();
  if (options.action === "align") {
    const lo = boxes.reduce((v, b) => (start(b) < v ? start(b) : v), start(boxes[0]!)),
      hi = boxes.reduce(
        (v, b) => (start(b) + size(b) > v ? start(b) + size(b) : v),
        start(boxes[0]!) + size(boxes[0]!)
      );
    for (const b of boxes)
      positions.set(
        b.id,
        ["left", "top"].includes(options.alignment)
          ? round(lo)
          : ["right", "bottom"].includes(options.alignment)
            ? round(hi - size(b))
            : round(lo + hi - size(b), 2n)
      );
  } else {
    const sorted = [...boxes].sort((a, b) => Number(start(a) - start(b))),
      first = sorted[0]!,
      last = sorted.at(-1)!,
      count = BigInt(sorted.length - 1);
    const total = sorted.reduce((n, b) => n + size(b), 0n),
      gap = start(last) + size(last) - start(first) - total;
    let widths = 0n;
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!;
      positions.set(
        b.id,
        i === sorted.length - 1
          ? Number(start(last))
          : round((start(first) + widths) * count + BigInt(i) * gap, count)
      );
      widths += size(b);
    }
  }
  let changed = doc;
  for (const b of boxes)
    changed = applyShapeUpdate(
      changed,
      nodeFor(changed.root, b.id),
      horizontal
        ? { left: new Length(positions.get(b.id)!) }
        : { top: new Length(positions.get(b.id)!) }
    );
  return { doc: changed, ids: originalIds };
}
export async function mutateShapeSelection(
  input: BinaryInput,
  options: ShapeSelectionOptions,
  context: SelectionContext
) {
  validateShapeSelectionOptions(options);
  if (
    !options.shapes &&
    !options.select &&
    options.shape === undefined &&
    options.slide === undefined &&
    !options.part &&
    !options.all
  )
    throw new SelectionError("invalid-selection");
  const s = await loadShared(input, context),
    allowed = selected(s, options);
  const records = options.shapes
    ? options.shapes.map((location) => {
        if (location.fingerprint !== s.index.fingerprint)
          throw new SelectionError("stale-selection");
        const record = allowed.find(
          (r) =>
            r.location.scope === location.scope &&
            r.location.owner === location.owner &&
            r.location.objectId === location.objectId
        );
        if (!record) throw new SelectionError("invalid-selection");
        return record;
      })
    : allowed;
  if (!records.length) {
    if (!options.allowEmpty) throw new SelectionError("missing-selection");
    return { bytes: s.source, part: s.main, affectedSlides: [], affected: 0, records: [] };
  }
  if (records.length > 1 && !options.shapes && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      records.map((r) => r.location)
    );
  const part = records[0]!.part;
  if (records.some((r) => r.part !== part)) throw new SelectionError("invalid-selection");
  const result = applyShapeSelection(
    s.doc(part),
    records.map((r) => r.id),
    options
  );
  s.save(part, result.doc);
  const finished = await s.finish(
    part,
    s.index.inventory.slides
      .filter((x) => [x.part, x.master, x.layout].includes(part))
      .map((x) => x.position)
  );
  const index = await readSelectionIndex(finished.bytes, context);
  return {
    ...finished,
    affected: records.length,
    records: result.ids.map((id) => index.objects.find((r) => r.part === part && r.id === id)!)
  };
}
