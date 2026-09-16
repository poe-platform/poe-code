import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { readXmlCoordinate, readXmlInteger } from "./xml-scalars.js";
import { attr, child } from "./masters.js";
import type { XmlElement } from "./xml.js";

export interface ShapeGeometry {
  /** Coordinate space of the stored left/top/width/height values. */
  readonly coordinateSystem: "slide" | "group";
  readonly unit: "emu";
  readonly groupPath: readonly (string | null)[];
  /** Slide-space corners, in original top-left, top-right, bottom-right, bottom-left order. */
  readonly corners: readonly { readonly x: number; readonly y: number }[];
}

function invalid(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Explicit nonsingular geometry is required for coordinate projection.",
    "validate-intent"
  );
}
function transform(node: XmlElement) {
  const a =
    node.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main"
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const owner =
    node.name.localName === "graphicFrame"
      ? node
      : child(node, node.name.localName === "grpSp" ? "grpSpPr" : "spPr");
  const xfrm =
    owner && child(owner, "xfrm", node.name.localName === "graphicFrame" ? node.name.namespace : a);
  if (!xfrm) return null;
  const integer = (name: string, key: string): number | null => {
    const pair = child(xfrm, name, a),
      value = pair && attr(pair, key);
    if (value === undefined) return null;
    try {
      return name === "off" || name === "chOff" ? readXmlCoordinate(value) : readXmlInteger(value);
    } catch {
      invalid();
    }
  };
  const x = integer("off", "x"),
    y = integer("off", "y"),
    w = integer("ext", "cx"),
    h = integer("ext", "cy");
  if (x === null || y === null || w === null || h === null) return null;
  if (w < 0 || h < 0) invalid();
  const rawRotation = attr(xfrm, "rot");
  let rotation = 0;
  if (rawRotation !== undefined) {
    try {
      rotation = readXmlInteger(rawRotation);
    } catch {
      invalid();
    }
  }
  const flip = (key: string) => {
    const value = attr(xfrm, key);
    if (value !== undefined && !["true", "false", "1", "0"].includes(value)) invalid();
    return value === "true" || value === "1" ? -1 : 1;
  };
  const angle = ((rotation % 21600000) + 21600000) % 21600000;
  const quarter = angle / 5400000;
  const cos = Number.isInteger(quarter)
    ? [1, 0, -1, 0][quarter]!
    : Math.cos(((angle / 60000) * Math.PI) / 180);
  const sin = Number.isInteger(quarter)
    ? [0, 1, 0, -1][quarter]!
    : Math.sin(((angle / 60000) * Math.PI) / 180);
  const fx = flip("flipH"),
    fy = flip("flipV");
  return {
    x,
    y,
    w,
    h,
    integer,
    map(px: number, py: number) {
      const dx = (px - x - w / 2) * fx,
        dy = (py - y - h / 2) * fy;
      return { x: x + w / 2 + dx * cos - dy * sin, y: y + h / 2 + dx * sin + dy * cos };
    }
  };
}

export function readShapeGeometry(root: XmlElement, node: XmlElement): ShapeGeometry | null {
  const projection = prepareProjection(root, node);
  if (!projection) return null;
  const { own, groups } = projection;
  return {
    coordinateSystem: groups.length ? "group" : "slide",
    unit: "emu",
    groupPath: groups.map((group) => {
      const nv = child(group, "nvGrpSpPr"),
        cn = nv && child(nv, "cNvPr");
      return cn ? (attr(cn, "id") ?? null) : null;
    }),
    corners: projection.project([
      { x: own.x, y: own.y },
      { x: own.x + own.w, y: own.y },
      { x: own.x + own.w, y: own.y + own.h },
      { x: own.x, y: own.y + own.h }
    ])
  };
}

export function projectShapePoint(root: XmlElement, node: XmlElement, x: number, y: number) {
  const projection = prepareProjection(root, node);
  return projection?.project([{ x, y }])[0] ?? null;
}

function prepareProjection(root: XmlElement, node: XmlElement) {
  const pending = [{ node: root, groups: [] as XmlElement[] }];
  let groups: XmlElement[] | undefined;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.node === node) {
      groups = current.groups;
      break;
    }
    const ancestors =
      current.node.name.namespace === node.name.namespace && current.node.name.localName === "grpSp"
        ? [...current.groups, current.node]
        : current.groups;
    for (const next of current.node.children) pending.push({ node: next, groups: ancestors });
  }
  if (!groups)
    throw new OfficeError(
      "invalid-selection",
      "Shape does not belong to the supplied drawing.",
      "select"
    );
  const own = transform(node);
  if (!own) return null;
  const parents: {
    parent: NonNullable<ReturnType<typeof transform>>;
    cx: number;
    cy: number;
    cw: number;
    ch: number;
  }[] = [];
  for (const group of [...groups].reverse()) {
    const parent = transform(group);
    if (!parent) return null;
    const cx = parent.integer("chOff", "x"),
      cy = parent.integer("chOff", "y"),
      cw = parent.integer("chExt", "cx"),
      ch = parent.integer("chExt", "cy");
    if (cx === null || cy === null || cw === null || ch === null) return null;
    if (cw <= 0 || ch <= 0 || parent.w <= 0 || parent.h <= 0) invalid();
    parents.push({ parent, cx, cy, cw, ch });
  }
  return {
    own,
    groups,
    project(points: readonly { x: number; y: number }[]) {
      let projected = points.map((point) => own.map(point.x, point.y));
      for (const { parent, cx, cy, cw, ch } of parents)
        projected = projected.map((point) =>
          parent.map(
            parent.x + ((point.x - cx) * parent.w) / cw,
            parent.y + ((point.y - cy) * parent.h) / ch
          )
        );
      return projected.map((point) => ({ x: new Length(point.x).emu, y: new Length(point.y).emu }));
    }
  };
}
