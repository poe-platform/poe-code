import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { attr, child, loadShared, required } from "./masters.js";
import { nodeFor, selected, validateSelection, type ShapeSelection } from "./shape-operations.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import type { XmlElement, XmlPart } from "./xml.js";

export interface GroupShapesOptions extends Omit<ShapeSelection, "all" | "allowEmpty"> {
  readonly shapes: readonly Location[];
  readonly tolerance: Length;
}
export interface UngroupShapeOptions extends Omit<ShapeSelection, "all" | "allowEmpty"> {
  readonly tolerance: Length;
}
type Point = { x: number; y: number };
const shapeKinds = ["sp", "pic", "cxnSp", "graphicFrame", "grpSp"];
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function descendants(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [],
    pending = [root];
  while (pending.length) {
    const next = pending.pop()!;
    result.push(next);
    pending.push(...next.children);
  }
  return result;
}
const parentIndexes = new WeakMap<XmlElement, ReadonlyMap<XmlElement, XmlElement>>();
function parentOf(root: XmlElement, node: XmlElement): XmlElement {
  let index = parentIndexes.get(root);
  if (!index) {
    const owners = new Map<XmlElement, XmlElement>();
    for (const parent of descendants(root))
      for (const child of parent.children) owners.set(child, parent);
    index = owners;
    parentIndexes.set(root, index);
  }
  const parent = index.get(node);
  if (!parent) throw new SelectionError("invalid-selection");
  return parent;
}
function geometry(node: XmlElement) {
  const p = node.name.namespace;
  const a =
    p === "http://purl.oclc.org/ooxml/presentationml/main"
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const owner =
    node.name.localName === "graphicFrame"
      ? node
      : required(node, node.name.localName === "grpSp" ? "grpSpPr" : "spPr");
  const xfrm = child(owner, "xfrm", node.name.localName === "graphicFrame" ? p : a);
  if (!xfrm) unsupported("Explicit geometry is required for grouping.");
  const integer = (value: string | undefined, fallback?: number) => {
    if (value === undefined && fallback !== undefined) return fallback;
    const digits = value?.startsWith("-") || value?.startsWith("+") ? value.slice(1) : value;
    if (
      !digits?.length ||
      [...digits].some((c) => c < "0" || c > "9") ||
      !Number.isSafeInteger(Number(value)) ||
      Math.abs(Number(value)) > 27273042316900
    )
      unsupported("Geometry requires bounded integer coordinates.");
    return Number(value);
  };
  const pair = (name: string, key: string) =>
    integer(attr(child(xfrm, name, a) ?? unsupported("Missing transform coordinate."), key));
  const x = pair("off", "x"),
    y = pair("off", "y"),
    w = pair("ext", "cx"),
    h = pair("ext", "cy");
  if (w < 0 || h < 0 || (node.name.localName !== "cxnSp" && (w === 0 || h === 0)))
    unsupported("Geometry requires positive extents except for connector axes.");
  const angle = ((integer(attr(xfrm, "rot"), 0) % 21600000) + 21600000) % 21600000;
  const q = angle / 5400000;
  const c = Number.isInteger(q) ? [1, 0, -1, 0][q]! : Math.cos((angle * Math.PI) / 10800000);
  const s = Number.isInteger(q) ? [0, 1, 0, -1][q]! : Math.sin((angle * Math.PI) / 10800000);
  const flip = (key: string) => {
    const value = attr(xfrm, key);
    if (value !== undefined && !["0", "1", "true", "false"].includes(value))
      unsupported("Invalid geometry reflection.");
    return value === "1" || value === "true" ? -1 : 1;
  };
  const fx = flip("flipH"),
    fy = flip("flipV");
  const map = (point: Point): Point => {
    if (angle === 0 && fx === 1 && fy === 1) return point;
    const dx = (point.x - x - w / 2) * fx,
      dy = (point.y - y - h / 2) * fy;
    return { x: x + w / 2 + dx * c - dy * s, y: y + h / 2 + dx * s + dy * c };
  };
  let cx = 0,
    cy = 0,
    cw = 1,
    ch = 1;
  if (node.name.localName === "grpSp") {
    cx = pair("chOff", "x");
    cy = pair("chOff", "y");
    cw = pair("chExt", "cx");
    ch = pair("chExt", "cy");
    if (cw <= 0 || ch <= 0) unsupported("Group child extents must be nonsingular.");
  }
  const identityMapping =
    x === cx && y === cy && w === cw && h === ch && angle === 0 && fx === 1 && fy === 1;
  return {
    x,
    y,
    w,
    h,
    xfrm,
    a,
    map,
    identityMapping,
    angle,
    fx,
    fy,
    cx,
    cy,
    cw,
    ch,
    childMap: (point: Point) =>
      identityMapping
        ? point
        : map({ x: x + ((point.x - cx) * w) / cw, y: y + ((point.y - cy) * h) / ch })
  };
}
function corners(root: XmlElement, node: XmlElement): Point[] {
  const g = geometry(node);
  let points = [
    { x: g.x, y: g.y },
    { x: g.x + g.w, y: g.y },
    { x: g.x + g.w, y: g.y + g.h },
    { x: g.x, y: g.y + g.h }
  ].map(g.map);
  let current = node;
  while (current !== root) {
    current = parentOf(root, current);
    if (current.name.localName === "grpSp" && current.name.namespace === node.name.namespace)
      points = points.map(geometry(current).childMap);
  }
  if (
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Math.abs(point.x) > 27273042316900 ||
        Math.abs(point.y) > 27273042316900
    )
  )
    unsupported("World geometry exceeds coordinate bounds.");
  return points;
}
function identity(node: XmlElement): string {
  const nv = node.children.find(
    (n) =>
      n.name.namespace === node.name.namespace &&
      ["nvSpPr", "nvGrpSpPr", "nvPicPr", "nvCxnSpPr", "nvGraphicFramePr"].includes(n.name.localName)
  );
  const value = nv && attr(required(nv, "cNvPr"), "id");
  if (!value) unsupported("Shape identity is required.");
  return value;
}
function validateTolerance(tolerance: number) {
  if (!Number.isSafeInteger(tolerance) || tolerance < 0)
    throw new OfficeError(
      "invalid-value",
      "Explicit nonnegative integer EMU tolerance is required.",
      "usage"
    );
}
function drawingShapes(root: XmlElement) {
  return descendants(root).filter(
    (n) => n.name.namespace === root.name.namespace && shapeKinds.includes(n.name.localName)
  );
}
type Fraction = { n: bigint; d: bigint };
function fraction(n: bigint, d = 1n): Fraction {
  let a = n < 0n ? -n : n,
    b = d;
  while (b) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  return { n: n / a, d: d / a };
}
function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}
function negate(a: Fraction): Fraction {
  return { n: -a.n, d: a.d };
}
function multiply(a: Fraction, n: number, d = 1): Fraction {
  return fraction(a.n * BigInt(n), a.d * BigInt(d));
}
function exactCorners(root: XmlElement, node: XmlElement): { x: Fraction; y: Fraction }[] {
  const own = geometry(node),
    f = (n: number) => fraction(BigInt(n));
  let points = [
    { x: f(own.x), y: f(own.y) },
    { x: f(own.x + own.w), y: f(own.y) },
    { x: f(own.x + own.w), y: f(own.y + own.h) },
    { x: f(own.x), y: f(own.y + own.h) }
  ];
  const apply = (target: XmlElement, childSpace: boolean) => {
    const g = geometry(target),
      q = g.angle / 5400000;
    if (!Number.isInteger(q))
      unsupported(
        "Nonidentity ungroup requires quarter-turn geometry for an exact tolerance proof."
      );
    const centerX = add(f(g.x), multiply(f(g.w), 1, 2)),
      centerY = add(f(g.y), multiply(f(g.h), 1, 2));
    points = points.map((point) => {
      const px = childSpace
        ? add(f(g.x), multiply(add(point.x, negate(f(g.cx))), g.w, g.cw))
        : point.x;
      const py = childSpace
        ? add(f(g.y), multiply(add(point.y, negate(f(g.cy))), g.h, g.ch))
        : point.y;
      const dx = multiply(add(px, negate(centerX)), g.fx),
        dy = multiply(add(py, negate(centerY)), g.fy);
      const rx = [dx, negate(dy), negate(dx), dy][q]!,
        ry = [dy, dx, negate(dy), negate(dx)][q]!;
      return { x: add(centerX, rx), y: add(centerY, ry) };
    });
  };
  apply(node, false);
  let current = node;
  while (current !== root) {
    current = parentOf(root, current);
    if (current.name.namespace === node.name.namespace && current.name.localName === "grpSp")
      apply(current, true);
  }
  for (const point of points)
    for (const value of [point.x, point.y])
      if ((value.n < 0n ? -value.n : value.n) > 27273042316900n * value.d)
        unsupported("World geometry exceeds coordinate bounds.");
  return points;
}
function certify(before: XmlPart, after: XmlPart, nodes: readonly XmlElement[], tolerance: number) {
  for (const node of nodes) {
    const original = exactCorners(before.root, node),
      changed = exactCorners(after.root, nodeFor(after.root, identity(node)));
    for (let i = 0; i < 4; i++)
      for (const axis of ["x", "y"] as const) {
        const difference = add(original[i]![axis], negate(changed[i]![axis]));
        if ((difference.n < 0n ? -difference.n : difference.n) > BigInt(tolerance) * difference.d)
          unsupported("Serialized geometry exceeds the explicit tolerance.");
      }
  }
}
function bounded(node: XmlElement) {
  const transform = geometry(node);
  const xfrm = transform.xfrm;
  if (
    xfrm.attributes.some(
      (a) => a.name.namespace !== "" || !["rot", "flipH", "flipV"].includes(a.name.localName)
    ) ||
    xfrm.children.some(
      (n) =>
        n.name.namespace !== transform.a ||
        !["off", "ext", "chOff", "chExt"].includes(n.name.localName) ||
        n.children.length ||
        n.attributes.length !== 2 ||
        n.attributes.some(
          (a) =>
            a.name.namespace !== "" ||
            !(
              n.name.localName.endsWith("Off") || n.name.localName === "off"
                ? ["x", "y"]
                : ["cx", "cy"]
            ).includes(a.name.localName)
        )
    )
  )
    unsupported("Unknown transform metadata cannot be bounded.");
  if (node.name.localName === "grpSp") {
    const nv = required(node, "nvGrpSpPr");
    if (
      node.attributes.length ||
      nv.attributes.length ||
      nv.children.length !== 3 ||
      nv.children.some(
        (n) =>
          n.name.namespace !== node.name.namespace ||
          !["cNvPr", "cNvGrpSpPr", "nvPr"].includes(n.name.localName) ||
          n.children.length ||
          n.attributes.some(
            (a) =>
              n.name.localName !== "cNvPr" ||
              a.name.namespace !== "" ||
              !["id", "name"].includes(a.name.localName)
          )
      )
    )
      unsupported("Group actions or metadata cannot be removed.");
    const props = required(node, "grpSpPr");
    if (
      props.attributes.length ||
      props.children.some((n) => n.name.localName !== "xfrm" || n.name.namespace !== transform.a)
    )
      unsupported("Group effects or inherited formatting cannot be removed.");
    return;
  }
  if (node.name.localName !== "sp")
    unsupported("Ungroup currently requires plain rectangular shapes or nested groups.");
  const props = required(node, "spPr"),
    preset = child(props, "prstGeom", geometry(node).a);
  if (
    !preset ||
    attr(preset, "prst") !== "rect" ||
    preset.children.some(
      (n) =>
        n.name.namespace !== transform.a ||
        n.name.localName !== "avLst" ||
        n.children.length ||
        n.attributes.length
    )
  )
    unsupported("Unsupported vertex geometry for ungroup.");
  if (
    node.attributes.length ||
    props.attributes.length ||
    node.children.some(
      (n) =>
        n.name.namespace !== node.name.namespace || !["nvSpPr", "spPr"].includes(n.name.localName)
    ) ||
    props.children.some(
      (n) =>
        n.name.namespace !== transform.a ||
        !["xfrm", "prstGeom", "solidFill", "noFill", "ln"].includes(n.name.localName)
    )
  )
    unsupported("Text, styles, or effects cannot be bounded for ungroup.");
  const line = child(props, "ln", geometry(node).a);
  if (
    !line ||
    line.children.length !== 1 ||
    line.children[0]!.name.localName !== "noFill" ||
    line.children[0]!.name.namespace !== transform.a ||
    line.children[0]!.attributes.length ||
    line.children[0]!.children.length ||
    line.attributes.length
  )
    unsupported("Ungroup requires an explicit absent stroke.");
}
export function applyShapeGroup(doc: XmlPart, ids: readonly string[], tolerance: number): XmlPart {
  validateTolerance(tolerance);
  if (ids.length < 2 || new Set(ids).size !== ids.length)
    throw new SelectionError("invalid-selection");
  const nodes = ids.map((id) => nodeFor(doc.root, id)),
    parent = parentOf(doc.root, nodes[0]!);
  if (
    !["spTree", "grpSp"].includes(parent.name.localName) ||
    nodes.some((n) => parentOf(doc.root, n) !== parent)
  )
    throw new SelectionError("invalid-selection");
  const positions = nodes.map((n) => parent.children.indexOf(n)).sort((a, b) => a - b);
  if (positions.at(-1)! - positions[0]! + 1 !== nodes.length)
    unsupported("Grouping requires contiguous siblings to preserve z-order.");
  const ordered = parent.children.slice(positions[0]!, positions.at(-1)! + 1);
  const affected = ordered.flatMap(drawingShapes);
  for (const node of affected) corners(doc.root, node);
  const transforms = ordered.map(geometry);
  const x = transforms.reduce((n, g) => Math.min(n, g.x), Infinity),
    y = transforms.reduce((n, g) => Math.min(n, g.y), Infinity);
  const w = transforms.reduce((n, g) => Math.max(n, g.x + g.w), -Infinity) - x,
    h = transforms.reduce((n, g) => Math.max(n, g.y + g.h), -Infinity) - y;
  if (w <= 0 || h <= 0) unsupported("Group union requires positive nonsingular extents.");
  if (w > 27273042316900 || h > 27273042316900)
    unsupported("Group union exceeds coordinate bounds.");
  const used = new Set(
    descendants(doc.root)
      .filter((n) => n.name.localName === "cNvPr" && n.name.namespace === doc.root.name.namespace)
      .map((n) => Number(attr(n, "id")))
  );
  let id = 1;
  for (const usedId of used) id = Math.max(id, usedId + 1);
  if (id > 4294967295) {
    id = 1;
    while (used.has(id)) id++;
  }
  if (!Number.isSafeInteger(id) || id > 4294967295) unsupported("No available group identity.");
  const p = doc.root.name.namespace,
    a = transforms[0]!.a;
  const xml = `<p:grpSp xmlns:p="${p}" xmlns:a="${a}"><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/><a:chOff x="${x}" y="${y}"/><a:chExt cx="${w}" cy="${h}"/></a:xfrm></p:grpSpPr>${ordered.map((n) => doc.markup(n, true)).join("")}</p:grpSp>`;
  const result = doc.spliceChildren(parent, positions[0]!, nodes.length, [xml]);
  return result;
}
export function applyShapeUngroup(doc: XmlPart, id: string, tolerance: number): XmlPart {
  validateTolerance(tolerance);
  const group = nodeFor(doc.root, id);
  if (group.name.localName !== "grpSp") throw new SelectionError("invalid-selection");
  const affected = drawingShapes(group).filter((n) => n !== group);
  const nodes = group.children.filter(
    (n) => n.name.namespace === group.name.namespace && shapeKinds.includes(n.name.localName)
  );
  if (!nodes.length) unsupported("Ungroup requires explicit child geometry.");
  const outer = geometry(group);
  bounded(group);
  for (const node of affected) {
    if (outer.identityMapping) corners(doc.root, node);
    else bounded(node);
  }
  if (
    group.children.some(
      (n) =>
        n.name.namespace !== group.name.namespace ||
        !["nvGrpSpPr", "grpSpPr", ...shapeKinds].includes(n.name.localName)
    )
  )
    unsupported("Unknown group metadata cannot be removed.");
  const affectedIds = new Set(affected.map(identity));
  for (const node of descendants(doc.root)) {
    if (["timing", "extLst"].includes(node.name.localName) && node.children.length)
      unsupported("Opaque timing or extension references cannot be remapped safely.");
    if (
      !outer.identityMapping &&
      node.attributes.some(
        (a) => ["spid", "spId", "shapeId"].includes(a.name.localName) && affectedIds.has(a.value)
      )
    )
      unsupported("Affected timing references cannot be remapped safely.");
    if (
      (["stCxn", "endCxn"].includes(node.name.localName) && attr(node, "id") === id) ||
      node.attributes.some(
        (a) => ["spid", "spId", "shapeId"].includes(a.name.localName) && a.value === id
      )
    )
      unsupported("Removed group has connector or timing references.");
  }
  let changed = doc;
  for (const original of outer.identityMapping ? [] : nodes) {
    const childNode = nodeFor(changed.root, identity(original)),
      g = geometry(childNode);
    const local = [
      { x: g.x, y: g.y },
      { x: g.x + g.w, y: g.y },
      { x: g.x, y: g.y + g.h }
    ]
      .map(g.map)
      .map(outer.childMap);
    const u = { x: local[1]!.x - local[0]!.x, y: local[1]!.y - local[0]!.y },
      v = { x: local[2]!.x - local[0]!.x, y: local[2]!.y - local[0]!.y };
    const width = Math.hypot(u.x, u.y),
      height = Math.hypot(v.x, v.y);
    if (Math.abs(u.x * v.x + u.y * v.y) > Number.EPSILON * width * height * 8)
      unsupported("Ungroup would require unsupported shear.");
    const angle = (Math.atan2(u.y, u.x) * 10800000) / Math.PI;
    const rotation = ((new Length(angle).emu % 21600000) + 21600000) % 21600000;
    const roundedWidth = new Length(width).emu,
      roundedHeight = new Length(height).emu;
    const x = new Length(local[0]!.x + (u.x + v.x) / 2 - roundedWidth / 2).emu,
      y = new Length(local[0]!.y + (u.y + v.y) / 2 - roundedHeight / 2).emu;
    if (roundedWidth <= 0 || roundedHeight <= 0)
      unsupported("Rounding produces zero visible extents.");
    changed = changed.merge(g.xfrm, {
      attributes: [
        { namespace: "", localName: "rot", value: String(rotation) },
        { namespace: "", localName: "flipH", value: "0" },
        { namespace: "", localName: "flipV", value: u.x * v.y - u.y * v.x < 0 ? "1" : "0" }
      ],
      children: {
        sequence: ["off", "ext", "chOff", "chExt"].map((localName) => ({
          namespace: g.a,
          localName
        })),
        upsert: [
          {
            name: { namespace: g.a, localName: "off" },
            merge: {
              attributes: [
                { namespace: "", localName: "x", value: String(x) },
                { namespace: "", localName: "y", value: String(y) }
              ]
            }
          },
          {
            name: { namespace: g.a, localName: "ext" },
            merge: {
              attributes: [
                { namespace: "", localName: "cx", value: String(roundedWidth) },
                { namespace: "", localName: "cy", value: String(roundedHeight) }
              ]
            }
          }
        ]
      }
    });
  }
  const current = nodeFor(changed.root, id),
    parent = parentOf(changed.root, current);
  const result = changed.spliceChildren(
    parent,
    parent.children.indexOf(current),
    1,
    nodes.map((n) => changed.markup(nodeFor(changed.root, identity(n)), true))
  );
  if (!outer.identityMapping) certify(doc, result, affected, tolerance);
  return result;
}
export function validateGroupOptions(
  options: UngroupShapeOptions | GroupShapesOptions,
  grouping: boolean
) {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    )
  )
    throw new OfficeError("invalid-value", "Invalid group options.", "usage");
  if (!(options.tolerance instanceof Length))
    throw new OfficeError("invalid-value", "Explicit tolerance Length is required.", "usage");
  if (!("value" in (Object.getOwnPropertyDescriptor(options.tolerance, "emu") ?? {})))
    throw new OfficeError("invalid-value", "Tolerance requires a stored EMU value.", "usage");
  validateTolerance(options.tolerance.emu);
  if (["update", "all", "allowEmpty"].some((key) => Object.hasOwn(options, key)))
    throw new OfficeError("invalid-value", "Unexpected group option.", "usage");
  if (grouping) {
    const shapes = (options as GroupShapesOptions).shapes;
    if (!Array.isArray(shapes) || shapes.length < 2) throw new SelectionError("invalid-selection");
    for (const location of shapes) {
      const keys = ["fingerprint", "scope", "owner", "objectId", "coordinateSystem"];
      if (
        !location ||
        typeof location !== "object" ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(location)) ||
        Reflect.ownKeys(location).some(
          (key) =>
            typeof key !== "string" ||
            !keys.includes(key) ||
            !("value" in Object.getOwnPropertyDescriptor(location, key)!)
        ) ||
        keys.some(
          (key) =>
            !Object.hasOwn(location, key) ||
            typeof location[key as keyof Location] !== "string" ||
            !location[key as keyof Location].length
        ) ||
        location.coordinateSystem !== "identity"
      )
        throw new OfficeError(
          "invalid-value",
          "Locations require exact identity data fields.",
          "usage"
        );
    }
  }
  const { tolerance: ignoredTolerance, ...rest } = options;
  const { shapes: ignoredShapes, ...selection } = rest as Omit<GroupShapesOptions, "tolerance">;
  if (!grouping && Object.hasOwn(options, "shapes"))
    throw new OfficeError("invalid-value", "Unexpected shapes option.", "usage");
  validateSelection(selection, "set");
  if (
    !grouping &&
    !selection.select &&
    selection.shape === undefined &&
    selection.slide === undefined &&
    !selection.part
  )
    throw new SelectionError("invalid-selection");
  return selection;
}
export async function groupShapes(
  input: BinaryInput,
  options: GroupShapesOptions,
  context: SelectionContext
) {
  const selection = validateGroupOptions(options, true),
    s = await loadShared(input, context);
  if (!Array.isArray(options.shapes) || options.shapes.length < 2)
    throw new SelectionError("invalid-selection");
  const allowed = selected(s, selection);
  const records = options.shapes.map((location) => {
    if (!location || location.fingerprint !== s.index.fingerprint)
      throw new SelectionError("stale-selection");
    const record = allowed.find(
      (r) =>
        r.location.owner === location.owner &&
        r.location.objectId === location.objectId &&
        r.location.scope === location.scope &&
        location.coordinateSystem === "identity"
    );
    if (!record) throw new SelectionError("invalid-selection");
    return record;
  });
  const part = records[0]!.part;
  if (records.some((r) => r.part !== part)) throw new SelectionError("invalid-selection");
  s.save(
    part,
    applyShapeGroup(
      s.doc(part),
      records.map((r) => r.id),
      options.tolerance.emu
    )
  );
  return {
    ...(await s.finish(
      part,
      s.index.inventory.slides
        .filter((x) => [x.part, x.master, x.layout].includes(part))
        .map((x) => x.position)
    )),
    affected: records.length,
    records
  };
}
export async function ungroupShape(
  input: BinaryInput,
  options: UngroupShapeOptions,
  context: SelectionContext
) {
  const selection = validateGroupOptions(options, false),
    s = await loadShared(input, context),
    records = selected(s, selection);
  if (records.length !== 1)
    throw new SelectionError(
      records.length ? "ambiguous-selection" : "missing-selection",
      records.map((r) => r.location)
    );
  const record = records[0]!;
  const source = s.doc(record.part);
  const childIds = new Set(
    nodeFor(source.root, record.id)
      .children.filter(
        (n) =>
          n.name.namespace === source.root.name.namespace && shapeKinds.includes(n.name.localName)
      )
      .map(identity)
  );
  const retained = s.index.objects.filter((r) => r.part === record.part && childIds.has(r.id));
  s.save(record.part, applyShapeUngroup(source, record.id, options.tolerance.emu));
  return {
    ...(await s.finish(
      record.part,
      s.index.inventory.slides
        .filter((x) => [x.part, x.master, x.layout].includes(record.part))
        .map((x) => x.position)
    )),
    affected: 1,
    records: retained
  };
}
