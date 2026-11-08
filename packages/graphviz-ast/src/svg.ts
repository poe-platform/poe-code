import type { Attributes } from "./dot.js";
import type { GraphLayout, LayoutNode, Point } from "./layout.js";
import { labelLines, numeric, recordFields, type RecordField } from "./metrics.js";
const f = (n: number) => String(Math.round(n * 1000) / 1000);
const escape = (s: string) =>
  s
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");
function style(a: Attributes, filled = false): string {
  const parts = [
    `fill="${escape(filled || a.style?.includes("filled") ? (a.fillcolor ?? "lightgrey") : "none")}"`,
    `stroke="${escape(a.color ?? "black")}"`
  ];
  if (a.penwidth) parts.push(`stroke-width="${f(numeric(a.penwidth, 1))}"`);
  if (a.style?.includes("dashed")) parts.push('stroke-dasharray="5,3"');
  if (a.style?.includes("dotted")) parts.push('stroke-dasharray="1,3"');
  return parts.join(" ");
}
function text(label: string, x: number, y: number, a: Attributes, id = ""): string {
  const size = numeric(a.fontsize, 14, 1);
  const lines = labelLines(label, id);
  return lines
    .map(
      (line, i) =>
        `<text text-anchor="middle" x="${f(x)}" y="${f(y + (i - (lines.length - 1) / 2) * size * 1.2 + size * 0.35)}" font-family="${escape(a.fontname ?? "Times,serif")}" font-size="${f(size)}" fill="${escape(a.fontcolor ?? "black")}">${escape(line)}</text>`
    )
    .join("");
}
function shape(node: LayoutNode): string {
  const { x, y, width: w, height: h, attributes: a } = node;
  const s = a.shape ?? "ellipse";
  const left = x - w / 2;
  const top = y - h / 2;
  const right = x + w / 2;
  const bottom = y + h / 2;
  const path = (d: string) => `<path ${style(a)} d="${d}"/>`;
  const polygon = (points: Point[]) =>
    `<polygon ${style(a)} points="${points.map((p) => `${f(p.x)},${f(p.y)}`).join(" ")}"/>`;
  const rect = (radius = 0) =>
    `<rect ${style(a)} x="${f(left)}" y="${f(top)}" width="${f(w)}" height="${f(h)}"${radius ? ` rx="${f(radius)}"` : ""}/>`;
  const ellipse = (rx: number, ry: number) =>
    `<ellipse ${style(a)} cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}"/>`;
  if (s === "plaintext" || s === "none") return "";
  if (s === "ellipse" || s === "oval" || s === "circle") return ellipse(w / 2, h / 2);
  if (s === "doublecircle")
    return ellipse(w / 2, h / 2) + ellipse(Math.max(1, w / 2 - 4), Math.max(1, h / 2 - 4));
  if (s === "diamond")
    return polygon([
      { x, y: top },
      { x: right, y },
      { x, y: bottom },
      { x: left, y }
    ]);
  if (s === "cylinder") {
    const arc = Math.min(10, h / 5);
    return (
      path(
        `M${f(left)},${f(top + arc)}C${f(left)},${f(top - arc / 3)} ${f(right)},${f(top - arc / 3)} ${f(right)},${f(top + arc)}L${f(right)},${f(bottom - arc)}C${f(right)},${f(bottom + arc / 3)} ${f(left)},${f(bottom + arc / 3)} ${f(left)},${f(bottom - arc)}Z`
      ) +
      path(
        `M${f(left)},${f(top + arc)}C${f(left)},${f(top + arc * 2)} ${f(right)},${f(top + arc * 2)} ${f(right)},${f(top + arc)}`
      )
    );
  }
  if (s === "folder" || s === "tab")
    return polygon([
      { x: left, y: top + 8 },
      { x: left, y: top },
      { x: left + w * 0.35, y: top },
      { x: left + w * 0.35 + 8, y: top + 8 },
      { x: right, y: top + 8 },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ]);
  if (s === "note")
    return (
      polygon([
        { x: left, y: top },
        { x: right - 10, y: top },
        { x: right, y: top + 10 },
        { x: right, y: bottom },
        { x: left, y: bottom }
      ]) +
      path(`M${f(right - 10)},${f(top)}L${f(right - 10)},${f(top + 10)}L${f(right)},${f(top + 10)}`)
    );
  if (s === "component")
    return (
      rect() +
      `<rect ${style(a)} x="${f(left - 4)}" y="${f(top + h * 0.2)}" width="8" height="${f(h * 0.2)}"/><rect ${style(a)} x="${f(left - 4)}" y="${f(top + h * 0.6)}" width="8" height="${f(h * 0.2)}"/>`
    );
  return rect(s === "Mrecord" || a.style?.includes("rounded") ? 8 : 0);
}
function record(node: LayoutNode): string {
  const walk = (
    fields: RecordField[],
    x: number,
    y: number,
    w: number,
    h: number,
    horizontal: boolean
  ): string =>
    fields
      .map((field, i) => {
        const width = horizontal ? w / fields.length : w;
        const height = horizontal ? h : h / fields.length;
        const left = x + (horizontal ? i * width : 0);
        const top = y + (horizontal ? 0 : i * height);
        const divider = i
          ? `<path fill="none" stroke="${escape(node.attributes.color ?? "black")}" d="M${f(left)},${f(top)}L${f(horizontal ? left : left + width)},${f(horizontal ? top + height : top)}"/>`
          : "";
        return (
          divider +
          (field.children
            ? walk(field.children, left, top, width, height, !horizontal)
            : text(field.label, left + width / 2, top + height / 2, node.attributes, node.id))
        );
      })
      .join("");
  return walk(
    recordFields(node.attributes.label ?? node.id),
    node.x - node.width / 2,
    node.y - node.height / 2,
    node.width,
    node.height,
    true
  );
}
function arrow(point: Point, previous: Point, attributes: Attributes): string {
  const size = numeric(attributes.arrowsize, 1) * 10;
  let dx = point.x - previous.x;
  let dy = point.y - previous.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const base = { x: point.x - size * dx, y: point.y - size * dy };
  return `<polygon fill="${escape(attributes.color ?? "black")}" stroke="${escape(attributes.color ?? "black")}" points="${f(point.x)},${f(point.y)} ${f(base.x + dy * size * 0.4)},${f(base.y - dx * size * 0.4)} ${f(base.x - dy * size * 0.4)},${f(base.y + dx * size * 0.4)}"/>`;
}
/** Render geometry without platform fonts, DOM or native Graphviz. */
export function renderSvg(layout: GraphLayout): string {
  const content: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(layout.width)}pt" height="${f(layout.height)}pt" viewBox="0 0 ${f(layout.width)} ${f(layout.height)}"><g class="graph"><title>${escape(layout.id ?? "G")}</title>`
  ];
  if (layout.attributes.bgcolor)
    content.push(
      `<rect x="0" y="0" width="${f(layout.width)}" height="${f(layout.height)}" fill="${escape(layout.attributes.bgcolor)}"/>`
    );
  for (const c of [...layout.clusters].reverse()) {
    content.push(
      `<g class="cluster"><title>${escape(c.id)}</title><rect ${style(c.attributes)} x="${f(c.x)}" y="${f(c.y)}" width="${f(c.width)}" height="${f(c.height)}"/>${c.attributes.label ? text(c.attributes.label, c.x + c.width / 2, c.y + 12, c.attributes) : ""}</g>`
    );
  }
  for (const e of layout.edges) {
    if (e.attributes.style?.includes("invis")) continue;
    content.push(
      `<g class="edge"><title>${escape(e.tail.id)}${layout.directed ? "-&gt;" : "--"}${escape(e.head.id)}</title>`
    );
    if (e.path) {
      content.push(`<path ${style({ ...e.attributes, fillcolor: "none" })} d="${e.path}"/>`);
      if (
        ((layout.directed && e.attributes.dir !== "none" && e.attributes.dir !== "back") ||
          e.attributes.dir === "both" ||
          e.attributes.dir === "forward") &&
        e.attributes.arrowhead !== "none"
      )
        content.push(arrow(e.points.at(-1)!, e.points.at(-2)!, e.attributes));
      if (
        (e.attributes.dir === "back" || e.attributes.dir === "both") &&
        e.attributes.arrowtail !== "none"
      )
        content.push(arrow(e.points[0]!, e.points[1]!, e.attributes));
    }
    if (e.attributes.label)
      content.push(text(e.attributes.label, e.label.x, e.label.y - 8, e.attributes));
    content.push("</g>");
  }
  for (const n of layout.nodes) {
    if (n.attributes.style?.includes("invis")) continue;
    content.push(
      `<g class="node"><title>${escape(n.id)}</title>${shape(n)}${n.attributes.shape === "record" || n.attributes.shape === "Mrecord" ? record(n) : text(n.attributes.label ?? n.id, n.x, n.y, n.attributes, n.id)}</g>`
    );
  }
  if (layout.attributes.label)
    content.push(
      text(layout.attributes.label, layout.width / 2, layout.height - 12, layout.attributes)
    );
  content.push("</g></svg>");
  return content.join("");
}
