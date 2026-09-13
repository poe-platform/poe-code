import { SaxesParser } from "saxes";
import { OfficeError } from "./errors.js";
import { attr, child } from "./masters.js";
import type { XmlElement, XmlPart } from "./xml.js";
export type ShapePathCommand =
  | { readonly type: "move"; readonly x: number; readonly y: number }
  | { readonly type: "line"; readonly x: number; readonly y: number }
  | {
      readonly type: "quadratic";
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "cubic";
      readonly cx1: number;
      readonly cy1: number;
      readonly cx2: number;
      readonly cy2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "close" };
export interface ShapePath {
  readonly unit: "emu";
  readonly width: number;
  readonly height: number;
  readonly commands: readonly ShapePathCommand[];
}
const coordinateLimit = 2147483647;
function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid bounded shape path.", "usage");
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Geometry requires an unsupported geometry engine.",
    "validate-intent"
  );
}
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => !descriptors[k] || !("value" in descriptors[k]!))
  )
    invalid();
}
function array(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > 4096 ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    invalid();
  for (let i = 0; i < value.length; i++)
    if (!("value" in (Object.getOwnPropertyDescriptor(value, String(i)) ?? {}))) invalid();
}
function coordinate(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Math.abs(value) > coordinateLimit
  )
    invalid();
}
export function validateShapePath(path: ShapePath): void {
  record(path, ["unit", "width", "height", "commands"]);
  if (path.unit !== "emu") invalid();
  coordinate(path.width);
  coordinate(path.height);
  if (path.width <= 0 || path.height <= 0) invalid();
  array(path.commands);
  if (path.commands.length < 2 || path.commands.length > 4096) invalid();
  let active = false,
    segments = 0;
  for (const command of path.commands) {
    if (!command || typeof command !== "object") invalid();
    const type = Object.getOwnPropertyDescriptor(command, "type");
    if (!type || !("value" in type)) invalid();
    const keys =
      type.value === "close"
        ? []
        : type.value === "move" || type.value === "line"
          ? ["x", "y"]
          : type.value === "quadratic"
            ? ["cx", "cy", "x", "y"]
            : type.value === "cubic"
              ? ["cx1", "cy1", "cx2", "cy2", "x", "y"]
              : null;
    if (keys === null) invalid();
    record(command, ["type", ...keys]);
    for (const key of keys) coordinate((command as unknown as Record<string, unknown>)[key]);
    if (command.type === "move") {
      if (active && !segments) invalid();
      active = true;
      segments = 0;
    } else if (!active) invalid();
    else if (command.type === "close") {
      if (!segments) invalid();
      active = false;
    } else segments++;
  }
  if (active && !segments) invalid();
}
export function pathFromVertices(vertices: unknown, close: boolean): ShapePath {
  array(vertices);
  if (typeof close !== "boolean" || vertices.length < 2 || vertices.length > 4095) invalid();
  const commands: ShapePathCommand[] = [];
  let width = 1,
    height = 1;
  const distinct = new Set<string>();
  for (const vertex of vertices) {
    let x: unknown, y: unknown;
    if (Array.isArray(vertex)) {
      array(vertex);
      if (vertex.length !== 2) invalid();
      [x, y] = vertex;
    } else {
      record(vertex, ["x", "y"]);
      x = vertex.x;
      y = vertex.y;
    }
    coordinate(x);
    coordinate(y);
    width = Math.max(width, x);
    height = Math.max(height, y);
    distinct.add(`${x},${y}`);
    commands.push({ type: commands.length ? "line" : "move", x, y });
  }
  if (close) {
    if (distinct.size < 3) invalid();
    commands.push({ type: "close" });
  }
  const path: ShapePath = { unit: "emu", width, height, commands };
  validateShapePath(path);
  return path;
}
function geometry(node: XmlElement) {
  const p = node.name.namespace;
  const a =
    p === "http://schemas.openxmlformats.org/presentationml/2006/main"
      ? "http://schemas.openxmlformats.org/drawingml/2006/main"
      : p === "http://purl.oclc.org/ooxml/presentationml/main"
        ? "http://purl.oclc.org/ooxml/drawingml/main"
        : "";
  if (!a || !["sp", "pic", "cxnSp"].includes(node.name.localName)) unsupported();
  const props = child(node, "spPr"),
    custom = props && child(props, "custGeom", a);
  return { a, props, custom };
}
function only(
  node: XmlElement,
  namespace: string,
  attrs: readonly string[],
  children: readonly string[]
) {
  if (
    node.name.namespace !== namespace ||
    node.attributes.some(
      (v) =>
        v.name.namespace !== "http://www.w3.org/2000/xmlns/" &&
        (v.name.namespace !== "" || !attrs.includes(v.name.localName))
    ) ||
    node.children.some(
      (v) => v.name.namespace !== namespace || !children.includes(v.name.localName)
    )
  )
    unsupported();
}
function literal(node: XmlElement, key: string) {
  const value = attr(node, key);
  if (
    value === undefined ||
    !value.length ||
    Array.from(value).some((c, i) => !"0123456789".includes(c) && !(i === 0 && c === "-"))
  )
    unsupported();
  const result = Number(value);
  coordinate(result);
  return result;
}
export function readShapePath(
  document: XmlPart,
  node: XmlElement
): { path: ShapePath | null; xml: string | null; unsupported: boolean } {
  const { a, custom } = geometry(node);
  if (!custom) return { path: null, xml: null, unsupported: false };
  const xml = document.markup(custom);
  if (node.name.localName !== "sp") return { path: null, xml, unsupported: true };
  try {
    const parser = new SaxesParser();
    parser.on("text", (text) => {
      if (text.trim()) unsupported();
    });
    parser.on("cdata", (text) => {
      if (text.trim()) unsupported();
    });
    parser.write(xml).close();
    only(custom, a, [], ["avLst", "gdLst", "ahLst", "cxnLst", "pathLst"]);
    for (const name of ["avLst", "gdLst", "ahLst", "cxnLst"]) {
      const list = custom.children.filter((v) => v.name.localName === name);
      if (list.length > 1) unsupported();
      for (const item of list) only(item, a, [], []);
    }
    const lists = custom.children.filter((v) => v.name.localName === "pathLst");
    if (lists.length !== 1) unsupported();
    const list = lists[0]!;
    only(list, a, [], ["path"]);
    if (list.children.length !== 1) unsupported();
    const path = list.children[0]!;
    only(path, a, ["w", "h"], ["moveTo", "lnTo", "quadBezTo", "cubicBezTo", "close"]);
    const commands: ShapePathCommand[] = [];
    for (const command of path.children) {
      only(command, a, [], ["pt"]);
      const expected = { moveTo: 1, lnTo: 1, quadBezTo: 2, cubicBezTo: 3, close: 0 }[
        command.name.localName
      ];
      if (command.children.length !== expected) unsupported();
      const points = command.children.map((pt) => {
        only(pt, a, ["x", "y"], []);
        return { x: literal(pt, "x"), y: literal(pt, "y") };
      });
      const p = points.at(-1)!;
      if (command.name.localName === "close") commands.push({ type: "close" });
      else if (command.name.localName === "quadBezTo")
        commands.push({ type: "quadratic", cx: points[0]!.x, cy: points[0]!.y, ...p });
      else if (command.name.localName === "cubicBezTo")
        commands.push({
          type: "cubic",
          cx1: points[0]!.x,
          cy1: points[0]!.y,
          cx2: points[1]!.x,
          cy2: points[1]!.y,
          ...p
        });
      else commands.push({ type: command.name.localName === "moveTo" ? "move" : "line", ...p });
    }
    const result: ShapePath = {
      unit: "emu",
      width: literal(path, "w"),
      height: literal(path, "h"),
      commands
    };
    validateShapePath(result);
    return { path: result, xml, unsupported: false };
  } catch (error) {
    if (!(error instanceof OfficeError)) throw error;
    return { path: null, xml, unsupported: true };
  }
}
export function shapePathXml(path: ShapePath, namespace: string): string {
  validateShapePath(path);
  if (
    ![
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "http://purl.oclc.org/ooxml/drawingml/main"
    ].includes(namespace)
  )
    invalid();
  const point = (x: number, y: number) => `<a:pt x="${x}" y="${y}"/>`;
  const commands = path.commands
    .map((c) =>
      c.type === "close"
        ? "<a:close/>"
        : c.type === "move"
          ? `<a:moveTo>${point(c.x, c.y)}</a:moveTo>`
          : c.type === "line"
            ? `<a:lnTo>${point(c.x, c.y)}</a:lnTo>`
            : c.type === "quadratic"
              ? `<a:quadBezTo>${point(c.cx, c.cy)}${point(c.x, c.y)}</a:quadBezTo>`
              : `<a:cubicBezTo>${point(c.cx1, c.cy1)}${point(c.cx2, c.cy2)}${point(c.x, c.y)}</a:cubicBezTo>`
    )
    .join("");
  return `<a:custGeom xmlns:a="${namespace}"><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:pathLst><a:path w="${path.width}" h="${path.height}">${commands}</a:path></a:pathLst></a:custGeom>`;
}
export function applyShapePath(document: XmlPart, node: XmlElement, path: ShapePath): XmlPart {
  validateShapePath(path);
  const { props, custom, a } = geometry(node);
  if (
    !props ||
    !custom ||
    !readShapePath(document, node).path ||
    props.children.filter(
      (v) => v.name.namespace === a && ["custGeom", "prstGeom"].includes(v.name.localName)
    ).length !== 1
  )
    unsupported();
  return document.spliceChildren(props, props.children.indexOf(custom), 1, [shapePathXml(path, a)]);
}
