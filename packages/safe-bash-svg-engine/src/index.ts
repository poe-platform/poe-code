import { parseXmlSteps, type XmlElement } from "@poe-code/xml-ast";
import { namedColors } from "./named-colors.js";
import { parseColor } from "@poe-code/image-ast";
import { PdfDocument, cosArray, cosNumber, renderDisplayListToPngSteps, type PdfContentNode, type PdfPathSegment } from "@poe-code/pdf-ast";
import { drainCooperativeSteps, yieldTurn } from "safe-bash-contracts/yield";

export interface SvgRenderOptions { readonly signal?: AbortSignal; readonly maxNodes?: number; readonly maxPixels?: number; readonly dpi?: number }

function tokens(source: string): (string | number)[] {
  const result: (string | number)[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (char.trim() === "" || char === ",") { i++; continue; }
    if (!"0123456789.+-".includes(char)) { result.push(char); i++; continue; }
    const start = i++;
    while (i < source.length && "0123456789.".includes(source[i]!)) i++;
    if (source[i] === "e" || source[i] === "E") {
      i++; if (source[i] === "+" || source[i] === "-") i++;
      while (i < source.length && "0123456789".includes(source[i]!)) i++;
    }
    const number = Number(source.slice(start, i));
    if (!Number.isFinite(number)) throw new SyntaxError("Invalid SVG number");
    result.push(number);
  }
  return result;
}

function numbers(source: string): number[] {
  return tokens(source).map(value => { if (typeof value !== "number") throw new SyntaxError("Expected SVG number"); return value; });
}

function path(source: string): PdfPathSegment[] {
  const input = tokens(source);
  if (input.length && input[0] !== "M" && input[0] !== "m") throw new SyntaxError("SVG path must begin with moveto");
  const output: PdfPathSegment[] = [];
  let i = 0; let command = ""; let x = 0; let y = 0; let startX = 0; let startY = 0;
  let controlX = 0; let controlY = 0; let previous = "";
  const number = () => { const value = input[i++]; if (typeof value !== "number") throw new SyntaxError("Invalid SVG path"); return value; };
  while (i < input.length) {
    if (typeof input[i] === "string") command = input[i++] as string;
    const upper = command.toUpperCase(); const relative = command !== upper;
    const px = () => number() + (relative ? x : 0); const py = () => number() + (relative ? y : 0);
    let segment: PdfPathSegment;
    if (upper === "Z") { segment = { kind: "close" }; x = startX; y = startY; command = ""; }
    else if (upper === "M" || upper === "L") {
      const nx = px(); const ny = py(); x = nx; y = ny;
      segment = { kind: upper === "M" ? "move" : "line", x, y };
      if (upper === "M") { startX = x; startY = y; command = relative ? "l" : "L"; }
    } else if (upper === "H") { x = px(); segment = { kind: "line", x, y }; }
    else if (upper === "V") { y = py(); segment = { kind: "line", x, y }; }
    else if (upper === "C" || upper === "S") {
      const x1 = upper === "C" ? px() : previous === "C" || previous === "S" ? 2 * x - controlX : x;
      const y1 = upper === "C" ? py() : previous === "C" || previous === "S" ? 2 * y - controlY : y;
      const x2 = px(); const y2 = py(); const nx = px(); const ny = py();
      segment = { kind: "cubic", x1, y1, x2, y2, x: nx, y: ny }; x = nx; y = ny; controlX = x2; controlY = y2;
    } else if (upper === "Q" || upper === "T") {
      const cx = upper === "Q" ? px() : previous === "Q" || previous === "T" ? 2 * x - controlX : x;
      const cy = upper === "Q" ? py() : previous === "Q" || previous === "T" ? 2 * y - controlY : y;
      const nx = px(); const ny = py();
      segment = { kind: "cubic", x1: x + (cx - x) * 2 / 3, y1: y + (cy - y) * 2 / 3, x2: nx + (cx - nx) * 2 / 3, y2: ny + (cy - ny) * 2 / 3, x: nx, y: ny };
      x = nx; y = ny; controlX = cx; controlY = cy;
    } else throw new SyntaxError(`Unsupported SVG path command ${command}`);
    output.push(segment); previous = upper;
  }
  return output;
}

function matrix(values: number[]): PdfContentNode {
  return { kind: "state-op", operator: "cm", operands: values.map(value => cosNumber(value)) };
}
function transforms(source: string): PdfContentNode[] {
  const result: PdfContentNode[] = []; let offset = 0;
  while (offset < source.length) {
    while (source[offset]?.trim() === "" || source[offset] === ",") offset++;
    if (offset === source.length) break;
    const open = source.indexOf("(", offset); const close = source.indexOf(")", open);
    if (open < 0 || close < 0) throw new SyntaxError("Invalid SVG transform");
    const name = source.slice(offset, open).trim(); const args = numbers(source.slice(open + 1, close));
    const a = args[0] ?? 0; const b = args[1] ?? 0;
    if (name === "matrix" && args.length === 6) result.push(matrix(args));
    else if (name === "translate" && args.length >= 1 && args.length <= 2) result.push(matrix([1, 0, 0, 1, a, b]));
    else if (name === "scale" && args.length >= 1 && args.length <= 2) result.push(matrix([a, 0, 0, args[1] ?? a, 0, 0]));
    else if (name === "rotate" && (args.length === 1 || args.length === 3)) {
      const c = Math.cos(a * Math.PI / 180); const s = Math.sin(a * Math.PI / 180); const cy = args[2] ?? 0;
      result.push(matrix([1, 0, 0, 1, b, cy]), matrix([c, s, -s, c, 0, 0]), matrix([1, 0, 0, 1, -b, -cy]));
    } else throw new SyntaxError(`Unsupported SVG transform ${name}`);
    offset = close + 1;
  }
  return result;
}

function length(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const units: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pc: 16 };
  const unit = value.slice(-2); const scale = units[unit];
  const number = Number(scale === undefined ? value : value.slice(0, -2));
  if (!Number.isFinite(number)) throw new SyntaxError(`Unsupported SVG length ${value}`);
  return number * (scale ?? 1);
}

/** Converts vector primitives without host fonts, network, or rasterizing PDF output. */
export async function renderSvgDocument(source: string, format: "pdf" | "png", options: SvgRenderOptions = {}): Promise<Uint8Array> {
  const signal = options.signal ?? new AbortController().signal;
  const parser = parseXmlSteps(source, { maxNodes: options.maxNodes ?? 10_000, maxDepth: 128, retainContent: true });
  let parsed = parser.next();
  while (!parsed.done) { await yieldTurn(signal); parsed = parser.next(); }
  const root = parsed.value;
  if (root.localName !== "svg") throw new SyntaxError("Expected SVG document");
  const attributes = (node: XmlElement) => Object.fromEntries(node.attributes.map(attribute => [attribute.localName, attribute.value]));
  const rootAttrs = attributes(root);
  if (rootAttrs.preserveAspectRatio && rootAttrs.preserveAspectRatio !== "xMidYMid meet" && rootAttrs.preserveAspectRatio !== "xMidYMid") throw new SyntaxError("Unsupported SVG preserveAspectRatio");
  const box = rootAttrs.viewBox ? numbers(rootAttrs.viewBox) : undefined;
  if (box && (box.length !== 4 || box[2]! <= 0 || box[3]! <= 0)) throw new SyntaxError("Invalid SVG viewBox");
  const width = length(rootAttrs.width, box?.[2] ?? 300); const height = length(rootAttrs.height, box?.[3] ?? 150);
  const dpi = options.dpi ?? 96;
  const pixels = Math.ceil(width * dpi / 96) * Math.ceil(height * dpi / 96);
  if (!(width > 0 && height > 0 && dpi > 0) || !Number.isFinite(pixels) || pixels > (options.maxPixels ?? 16_000_000)) throw new RangeError("SVG pixel limit exceeded");
  const doc = PdfDocument.create(); const page = doc.addPage([width * 0.75, height * 0.75]);
  const color = (value: string) => { const c = parseColor(Object.hasOwn(namedColors, value.trim().toLowerCase()) ? namedColors[value.trim().toLowerCase()]! : value); return { r: c.r / 255, g: c.g / 255, b: c.b / 255 }; };
  const visit = async (node: XmlElement, inherited: Record<string, string>): Promise<PdfContentNode[]> => {
    await yieldTurn(signal);
    const own = attributes(node); const a = { ...inherited, ...own };
    for (const declaration of (own.style ?? "").split(";")) {
      const colon = declaration.indexOf(":"); if (colon >= 0) a[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
    if (a.display === "none" || a.visibility === "hidden") return [];
    if (["defs", "title", "desc", "metadata"].includes(node.localName)) return [];
    for (const key of ["clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"]) {
      if (a[key] && a[key] !== "none") throw new SyntaxError(`Unsupported SVG ${key}`);
    }
    for (const key of ["opacity", "fill-opacity", "stroke-opacity"]) {
      if (a[key] !== undefined && Number(a[key]) !== 1) throw new SyntaxError(`Unsupported SVG ${key}`);
    }
    if (node !== root && node.localName === "svg") throw new SyntaxError("Unsupported nested SVG viewport");
    const ops: PdfContentNode[] = own.transform ? transforms(own.transform) : [];
    if (a["stroke-dasharray"] && a["stroke-dasharray"] !== "none") {
      let dash = numbers(a["stroke-dasharray"]);
      if (!dash.length || dash.some(value => value < 0)) throw new SyntaxError("Invalid SVG dash array");
      if (dash.length % 2) dash = [...dash, ...dash];
      ops.push({ kind: "state-op", operator: "d", operands: [cosArray(dash.map(value => cosNumber(value))), cosNumber(length(a["stroke-dashoffset"], 0))] });
    }
    for (const [attribute, operator, choices] of [["stroke-linecap", "J", ["butt", "round", "square"]], ["stroke-linejoin", "j", ["miter", "round", "bevel"]]] as const) {
      if (a[attribute]) {
        const value = choices.indexOf(a[attribute] as never);
        if (value < 0) throw new SyntaxError(`Invalid SVG ${attribute}`);
        ops.push({ kind: "state-op", operator, operands: [cosNumber(value)] });
      }
    }
    const n = (key: string, fallback = 0) => length(a[key], fallback);
    let segments: PdfPathSegment[] | undefined;
    switch (node.localName) {
      case "svg": case "g": case "a": break;
      case "rect": {
        const x = n("x"), y = n("y"), width = n("width"), height = n("height");
        let rx = n("rx", n("ry")), ry = n("ry", n("rx"));
        if (Math.min(width, height, rx, ry) < 0) throw new SyntaxError("Negative SVG rectangle size");
        if (!width || !height) break;
        rx = Math.min(rx, width / 2); ry = Math.min(ry, height / 2);
        if (!rx || !ry) segments = [{ kind: "rect", x, y, width, height }];
        else {
          const right = x + width, bottom = y + height, k = 0.5522847498;
          if (rx < 0 || ry < 0) throw new SyntaxError("Negative SVG radius");
        if (!rx || !ry) break;
        segments = [{ kind: "move", x: x + rx, y }, { kind: "line", x: right - rx, y },
            { kind: "cubic", x1: right - rx + rx * k, y1: y, x2: right, y2: y + ry - ry * k, x: right, y: y + ry },
            { kind: "line", x: right, y: bottom - ry },
            { kind: "cubic", x1: right, y1: bottom - ry + ry * k, x2: right - rx + rx * k, y2: bottom, x: right - rx, y: bottom },
            { kind: "line", x: x + rx, y: bottom },
            { kind: "cubic", x1: x + rx - rx * k, y1: bottom, x2: x, y2: bottom - ry + ry * k, x, y: bottom - ry },
            { kind: "line", x, y: y + ry },
            { kind: "cubic", x1: x, y1: y + ry - ry * k, x2: x + rx - rx * k, y2: y, x: x + rx, y }, { kind: "close" }];
        }
        break;
      }
      case "line": segments = [{ kind: "move", x: n("x1"), y: n("y1") }, { kind: "line", x: n("x2"), y: n("y2") }]; break;
      case "path": segments = path(a.d ?? ""); break;
      case "polygon": case "polyline": {
        const points = numbers(a.points ?? ""); if (points.length % 2) throw new SyntaxError("Invalid SVG points");
        segments = []; for (let i = 0; i < points.length; i += 2) segments.push({ kind: i ? "line" : "move", x: points[i]!, y: points[i + 1]! });
        if (node.localName === "polygon") segments.push({ kind: "close" }); break;
      }
      case "ellipse": case "circle": {
        const x = n("cx"); const y = n("cy"); const rx = n(node.localName === "circle" ? "r" : "rx"); const ry = n(node.localName === "circle" ? "r" : "ry"); const k = 0.5522847498;
        if (rx < 0 || ry < 0) throw new SyntaxError("Negative SVG radius");
        if (!rx || !ry) break;
        segments = [{ kind: "move", x: x + rx, y },
          { kind: "cubic", x1: x + rx, y1: y + ry * k, x2: x + rx * k, y2: y + ry, x, y: y + ry },
          { kind: "cubic", x1: x - rx * k, y1: y + ry, x2: x - rx, y2: y + ry * k, x: x - rx, y },
          { kind: "cubic", x1: x - rx, y1: y - ry * k, x2: x - rx * k, y2: y - ry, x, y: y - ry },
          { kind: "cubic", x1: x + rx * k, y1: y - ry, x2: x + rx, y2: y - ry * k, x: x + rx, y }, { kind: "close" }]; break;
      }
      case "text": {
        if (node.children.length) throw new SyntaxError("Unsupported SVG text children");
        if (a.fill === "none") break;
        if (a.stroke && a.stroke !== "none") throw new SyntaxError("Unsupported SVG text stroke");
        const size = n("font-size", 16); const font = doc.embedStandardFont("Helvetica");
        const anchor = a["text-anchor"]; const advance = font.widthOfTextAtSize(node.text, size);
        const x = n("x") - (anchor === "middle" ? advance / 2 : anchor === "end" ? advance : 0);
        page.setContentAst([]); page.drawText(node.text, { x, y: -n("y"), size, font, color: color(a.fill ?? "black") });
        ops.push({ kind: "graphics-group", ops: [matrix([1, 0, 0, -1, 0, 0]), ...page.getContentAst()] });
        break;
      }
      default: throw new SyntaxError(`Unsupported SVG element ${node.localName}`);
    }
    if (segments) {
      const fill = a.fill === "none" || node.localName === "line" ? undefined : color(a.fill ?? "black");
      const stroke = !a.stroke || a.stroke === "none" ? undefined : color(a.stroke);
      if (fill || stroke) {
        page.setContentAst([]); page.drawPath(segments, { fill, stroke, strokeWidth: n("stroke-width", 1), fillRule: a["fill-rule"] === "evenodd" ? "evenodd" : "nonzero" });
        ops.push(...page.getContentAst());
      }
    }
    const styles: Record<string, string> = {};
    for (const key of ["fill", "stroke", "stroke-width", "fill-rule", "font-size", "text-anchor", "visibility", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin"]) if (a[key] !== undefined) styles[key] = a[key]!;
    if (node.localName !== "text") for (const child of node.children) ops.push(...await visit(child, styles));
    return [{ kind: "graphics-group", ops }];
  };
  const ops = await visit(root, {});
  const view: PdfContentNode[] = [];
  if (box) {
    const scale = Math.min(width / box[2]!, height / box[3]!);
    view.push(matrix([scale, 0, 0, scale, (width - box[2]! * scale) / 2 - box[0]! * scale, (height - box[3]! * scale) / 2 - box[1]! * scale]));
  }
  page.setContentAst([{ kind: "graphics-group", ops: [matrix([0.75, 0, 0, -0.75, 0, height * 0.75]), ...view, ...ops] }]);
  signal.throwIfAborted();
  if (format === "pdf") return doc.save();
  return drainCooperativeSteps(renderDisplayListToPngSteps(page.evaluateDisplayList(), { scale: dpi / 72 }), signal);
}
