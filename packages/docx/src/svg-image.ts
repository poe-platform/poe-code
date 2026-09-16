import { archiveSettings, type ArchiveContext } from "./archive.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { UnsupportedEditError } from "./xml-write.js";

const svg = "http://www.w3.org/2000/svg";
const xml = "http://www.w3.org/XML/1998/namespace";
const xlink = "http://www.w3.org/1999/xlink";
const elements = new Set("svg g defs symbol use rect circle ellipse line polyline polygon path title desc text tspan textPath linearGradient radialGradient stop clipPath mask pattern marker".split(" "));
const attributes = new Set("id version x y width height viewBox preserveAspectRatio transform cx cy r rx ry x1 y1 x2 y2 points d dx dy rotate textLength lengthAdjust fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color clip-rule clip-path mask marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits font-family font-size font-weight font-style text-anchor dominant-baseline visibility".split(" "));
const hrefElements = new Set(["use", "textPath", "linearGradient", "radialGradient", "pattern"]);
const paints = new Set(["fill", "stroke", "color", "stop-color"]);
const references = new Set(["clip-path", "mask", "marker-start", "marker-mid", "marker-end"]);
const whitespace = (char: string | undefined) => char !== undefined && " \t\r\n".includes(char);
const letter = (char: string | undefined) => char !== undefined && (char >= "a" && char <= "z" || char >= "A" && char <= "Z");
const digit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";
function reject(): never { throw new UnsupportedEditError("SVG input exceeds the admitted static XML profile."); }
function id(value: string): string {
  if (!(letter(value[0]) || value[0] === "_") || [...value].some(char => !letter(char) && !digit(char) && !"_-.:".includes(char))) reject();
  return value;
}
function resource(value: string): string {
  if (!value.startsWith("url(")) reject();
  let index = 4;
  while (whitespace(value[index])) index++;
  const quote = value[index] === "'" || value[index] === '"' ? value[index++] : undefined;
  if (value[index++] !== "#") reject();
  const start = index;
  while (index < value.length && !whitespace(value[index]) && value[index] !== ")" && value[index] !== quote) index++;
  const target = id(value.slice(start, index));
  if (quote && value[index++] !== quote) reject();
  while (whitespace(value[index])) index++;
  if (value[index++] !== ")" || index !== value.length) reject();
  return target;
}
function numeric(value: string): { value: number; percentage: boolean } {
  let index = 0;
  while (whitespace(value[index])) index++;
  const start = index;
  if (value[index] === "+" || value[index] === "-") index++;
  let digits = 0;
  while (digit(value[index])) { digits++; index++; }
  if (value[index] === ".") {
    index++;
    while (digit(value[index])) { digits++; index++; }
  }
  if (!digits) reject();
  if (value[index] === "e" || value[index] === "E") {
    index++;
    if (value[index] === "+" || value[index] === "-") index++;
    const start = index;
    while (digit(value[index])) index++;
    if (index === start) reject();
  }
  const result = Number(value.slice(start, index));
  const percentage = value[index] === "%";
  if (percentage) index++;
  while (whitespace(value[index])) index++;
  if (index !== value.length || !Number.isFinite(result)) reject();
  return { value: result, percentage };
}
function color(value: string): void {
  if (["none", "currentColor", "transparent"].includes(value) || value.length && [...value].every(letter)) return;
  if (value[0] === "#" && [4, 5, 7, 9].includes(value.length) && [...value.slice(1)].every(char => digit(char) || char >= "a" && char <= "f" || char >= "A" && char <= "F")) return;
  const name = value.slice(0, value.indexOf("("));
  if (!["rgb", "rgba", "hsl", "hsla"].includes(name) || !value.endsWith(")")) reject();
  const parts = value.slice(name.length + 1, -1).split(",");
  const alpha = name === "rgba" || name === "hsla";
  if (parts.length !== (alpha ? 4 : 3)) reject();
  const tokens = parts.map(numeric);
  const within = (token: { value: number; percentage: boolean }, maximum: number) => token.value >= 0 && token.value <= (token.percentage ? 100 : maximum);
  if (name.startsWith("rgb")) {
    if (tokens.slice(0, 3).some(token => token.percentage !== tokens[0]!.percentage || !within(token, 255))) reject();
  } else if (tokens[0]!.percentage || Math.abs(tokens[0]!.value) > Number.MAX_SAFE_INTEGER || tokens.slice(1, 3).some(token => !token.percentage || !within(token, 100))) reject();
  if (alpha && !within(tokens[3]!, 1)) reject();
}

/** Admits exact inert bytes under the bounded static SVG input policy. */
export function admitSvgImage(input: Uint8Array, context: ArchiveContext): void {
  const { budget, limits } = archiveSettings(context);
  budget.check("embeddedMediaBytes", input.length);
  if (input.length > limits.maxEntryBytes) reject();
  const root = parseDocumentXml(input, {}, budget).root;
  if (root.namespace !== svg || root.localName !== "svg") reject();
  const ids = new Map<string, XmlElement>();
  const edges = new Map<XmlElement, XmlElement[]>();
  const pending: { source: XmlElement; target: string }[] = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    budget.charge("work", node.attributes.length + node.children.length + 1);
    budget.charge("retainedBytes", 128 + node.children.length * 16);
    if (node.namespace !== svg || !elements.has(node.localName)) reject();
    for (const content of [node.content, node.prolog ?? [], node.epilog ?? []]) if (content.some(item => item.kind === "processing-instruction")) reject();
    edges.set(node, [...node.children]);
    let href = false;
    for (const attribute of node.attributes) {
      const { namespace, localName, value } = attribute;
      budget.charge("work", value.length + 1);
      if (namespace === "http://www.w3.org/2000/xmlns/") continue;
      if (namespace === xml && ["lang", "space"].includes(localName)) continue;
      let target: string | undefined;
      if ((namespace === "" || namespace === xlink) && localName === "href") {
        if (href || !hrefElements.has(node.localName) || value[0] !== "#") reject();
        href = true;
        target = id(value.slice(1));
      } else {
        if (namespace || !attributes.has(localName)) reject();
        if (localName === "id") {
          const name = id(value);
          if (ids.has(name)) reject();
          budget.charge("retainedBytes", value.length * 2 + 64);
          ids.set(name, node);
        } else if (paints.has(localName) || references.has(localName)) {
          if (value.includes("\\") || value.includes("%") && !["rgb(", "rgba(", "hsl(", "hsla("].some(prefix => value.startsWith(prefix))) reject();
          if (value.startsWith("url(")) target = resource(value);
          else if (references.has(localName)) { if (value !== "none") reject(); }
          else color(value);
        }
      }
      if (target !== undefined) {
        budget.charge("retainedBytes", target.length * 2 + 64);
        pending.push({ source: node, target });
      }
    }
    for (const child of node.children) stack.push(child);
  }
  for (const reference of pending) {
    budget.charge("work", 1);
    const target = ids.get(reference.target);
    if (!target) reject();
    edges.get(reference.source)!.push(target);
  }
  const state = new Map<XmlElement, "visiting" | "done">();
  const work: { node: XmlElement; exit: boolean }[] = [{ node: root, exit: false }];
  while (work.length) {
    budget.charge("work", 1);
    const { node, exit } = work.pop()!;
    if (exit) { state.set(node, "done"); continue; }
    if (state.get(node) === "visiting") reject();
    if (state.has(node)) continue;
    state.set(node, "visiting");
    budget.charge("retainedBytes", 64 + edges.get(node)!.length * 32);
    work.push({ node, exit: true });
    for (const child of edges.get(node)!) work.push({ node: child, exit: false });
  }
}
