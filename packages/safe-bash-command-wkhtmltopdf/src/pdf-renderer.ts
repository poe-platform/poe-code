import { Parser, type DefaultTreeAdapterMap } from "parse5";
import { drainCooperativeSteps } from "safe-bash-contracts/yield";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosString,
  decodePng,
  dictSet,
  type PdfCosDict,
  type PdfRgbColor,
} from "@poe-code/pdf-ast";
import {
  createWkhtmltopdfCommand,
  wkhtmltopdfCommands,
  wkhtmltopdfLimits,
  type RenderedDocument,
  type StaticRenderer,
  type WkhtmltopdfCommandOptions,
} from "./command.js";
import type { CommandDefinition } from "safe-bash-contracts/command";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { planPageSequence, type RendererProfile } from "./engine.js";
import type { GlobalSettings, Length, PageSettings } from "./settings.js";

export const pdfAstRendererProfile: RendererProfile = Object.freeze({
  id: "pdf-ast-static",
  features: Object.freeze([
    "html5",
    "computed-css",
    "selectors",
    "css-units",
    "block-inline",
    "font-shaping",
    "lists",
    "images",
    "table-spans",
    "pagination",
    "break-rules",
    "widows-orphans",
    "positioning",
    "page-furniture",
    "flex",
    "grid",
  ] as const),
});

const PAGE_SIZES_PT: Record<string, [number, number]> = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  B4: [708.66, 1000.63],
  B5: [498.9, 708.66],
  Letter: [612, 792],
  Legal: [612, 1008],
  Executive: [522, 756],
  Tabloid: [792, 1224],
  Ledger: [792, 1224],
};

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = alphabet.indexOf(clean[i] ?? "A");
    const c1 = alphabet.indexOf(clean[i + 1] ?? "A");
    const c2 = clean[i + 2] === "=" ? -1 : alphabet.indexOf(clean[i + 2] ?? "A");
    const c3 = clean[i + 3] === "=" ? -1 : alphabet.indexOf(clean[i + 3] ?? "A");
    const triple = (Math.max(0, c0) << 18) | (Math.max(0, c1) << 12) | (Math.max(0, c2) << 6) | Math.max(0, c3);
    out.push((triple >> 16) & 0xff);
    if (c2 !== -1) out.push((triple >> 8) & 0xff);
    if (c3 !== -1) out.push(triple & 0xff);
  }
  return new Uint8Array(out);
}

function lengthToPoints(length: Length, dpi: number, fallbackPt: number): number {
  if (!Number.isFinite(length.value) || length.value < 0) return fallbackPt;
  switch (length.unit) {
    case "pt":
      return length.value;
    case "in":
      return length.value * 72;
    case "mm":
      return length.value * (72 / 25.4);
    case "px":
      return length.value * (72 / Math.max(1, dpi || 96));
    case "pc":
      return length.value * 12;
    case "didot":
      return length.value * 1.07;
    case "cicero":
      return length.value * 12.84;
    default:
      return fallbackPt;
  }
}

function resolvePageBox(global: GlobalSettings): {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
} {
  const base = PAGE_SIZES_PT[global.pageSize] ?? PAGE_SIZES_PT.A4!;
  let width = global.pageWidth.value > 0 ? lengthToPoints(global.pageWidth, global.dpi, base[0]) : base[0];
  let height = global.pageHeight.value > 0 ? lengthToPoints(global.pageHeight, global.dpi, base[1]) : base[1];
  if (global.orientation === "Landscape") {
    const tmp = width;
    width = height;
    height = tmp;
  }
  const marginTop = lengthToPoints(global.marginTop, global.dpi, 36);
  const marginBottom = lengthToPoints(global.marginBottom, global.dpi, 36);
  const marginLeft = lengthToPoints(global.marginLeft, global.dpi, 28.35);
  const marginRight = lengthToPoints(global.marginRight, global.dpi, 28.35);
  return { width, height, marginTop, marginBottom, marginLeft, marginRight };
}

interface SvgPrimitive {
  kind: "rect" | "line" | "text";
  x: number;
  y: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  text?: string;
}

interface HtmlBlock {
  kind: "heading" | "paragraph" | "blockquote" | "code" | "list" | "table" | "hr" | "image" | "svg" | "pagebreak";
  level?: number;
  text?: string;
  items?: string[];
  ordered?: boolean;
  start?: number;
  depth?: number;
  continuation?: boolean;
  rows?: { cells: { text: string; colspan: number }[]; header: boolean }[];
  links?: { text: string; href: string }[];
  pngBytes?: Uint8Array;
  displayWidth?: number;
  displayHeight?: number;
  svgPrimitives?: SvgPrimitive[];
}

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

function children(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function attribute(node: HtmlElement, name: string): string {
  return node.attrs.find(attr => attr.name === name)?.value ?? "";
}

const hiddenTags = new Set(["head", "script", "style", "template"]);
const blockTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "pre", "ul", "ol", "dl", "table", "svg", "hr", "img", "blockquote", "div", "section", "article", "li", "dt", "dd", "tr"]);

function nodeText(node: HtmlNode): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
  if (hiddenTags.has(node.nodeName)) return "";
  if (node.nodeName === "br") return "\n";
  const text = children(node).map(nodeText).join("");
  if (node.nodeName === "td" || node.nodeName === "th") return text + "\t";
  return blockTags.has(node.nodeName) ? "\n" + text + "\n" : text;
}

function extractLinks(nodes: HtmlNode[]): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const pending = [...nodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (hiddenTags.has(node.nodeName)) continue;
    if ("tagName" in node && node.tagName === "a") {
      const href = attribute(node, "href").trim();
      const text = nodeText(node).trim();
      if (href && text) links.push({ text, href });
    }
    pending.push(...children(node).slice().reverse());
  }
  return links;
}

function* parseHtmlDocumentSteps(rawHtml: string, replacements: readonly [string, string][], signal: AbortSignal): Generator<void, { title: string; blocks: HtmlBlock[] }, void> {
  let html = rawHtml;
  for (const [key, value] of replacements) {
    if (key) html = html.split(key).join(value);
  }
  // Feed the HTML5 parser incrementally so large documents remain cancellable.
  const parser = new Parser<DefaultTreeAdapterMap>();
  for (let offset = 0; offset < html.length; offset += 16384) {
    signal.throwIfAborted();
    parser.tokenizer.write(html.slice(offset, offset + 16384), false);
    yield;
  }
  parser.tokenizer.write("", true);
  let title = "";
  const pending: HtmlNode[] = [parser.document];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === "title") { title = nodeText(node).trim(); break; }
    pending.push(...children(node).slice().reverse());
  }
  const blocks: HtmlBlock[] = [];

  function* visit(nodes: HtmlNode[], depth = 0): Generator<void> {
    let inline: HtmlNode[] = [];
    const flush = () => {
      const text = inline.map(nodeText).join("").trim();
      if (text) blocks.push({ kind: "paragraph", text, links: extractLinks(inline) });
      inline = [];
    };
    for (const node of nodes) {
      signal.throwIfAborted();
      yield;
      if (hiddenTags.has(node.nodeName) || node.nodeName === "#comment") continue;
      if (!("tagName" in node)) { inline.push(node); continue; }
      const tag = node.tagName;
      if (!blockTags.has(tag)) {
        // Walk wrappers too: an unknown/custom element can contain block content.
        if (children(node).some(child => blockTags.has(child.nodeName))) {
          flush();
          yield* visit(children(node), depth);
        } else inline.push(node);
        continue;
      }
      flush();
      const style = new Map(attribute(node, "style").toLowerCase().split(";").map(declaration => {
        const colon = declaration.indexOf(":");
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
      }));
      if (style.get("page-break-before") === "always" || attribute(node, "class").split(/\s+/).includes("page-break")) blocks.push({ kind: "pagebreak" });
      if (tag === "hr") blocks.push({ kind: "hr" });
      else if (tag === "img") {
        const src = attribute(node, "src");
        if (src.startsWith("data:image/png;base64,")) {
          try {
            const pngBytes = decodeBase64(src.slice("data:image/png;base64,".length));
            const bitmap = decodePng(pngBytes);
            blocks.push({ kind: "image", pngBytes,
              displayWidth: Number(attribute(node, "width")) || Math.min(240, bitmap.width),
              displayHeight: Number(attribute(node, "height")) || Math.min(180, bitmap.height) });
          } catch { /* Ignore malformed data URL images. */ }
        }
      } else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
        const text = nodeText(node).trim();
        if (text) blocks.push({ kind: "heading", level: Number(tag[1]), text, links: extractLinks(children(node)) });
      } else if (tag === "pre" || tag === "blockquote") {
        const text = nodeText(node).trim();
        if (text) blocks.push({ kind: tag === "pre" ? "code" : "blockquote", text, links: extractLinks(children(node)) });
      } else if (tag === "ul" || tag === "ol") {
        let ordinal = 0;
        for (const item of children(node)) {
          if (item.nodeName !== "li") continue;
          ordinal++;
          let marked = false;
          let fragment: HtmlNode[] = [];
          const flushItem = () => {
            const itemText = fragment.map(nodeText).join("").trim();
            if (itemText || !marked) {
              blocks.push({ kind: "list", items: [itemText], ordered: tag === "ol", start: ordinal, depth, continuation: marked });
              marked = true;
            }
            fragment = [];
          };
          for (const child of children(item)) {
            if (child.nodeName === "ul" || child.nodeName === "ol" || child.nodeName === "table") {
              flushItem();
              yield* visit([child], depth + 1);
            } else fragment.push(child);
          }
          if (fragment.length || !marked) flushItem();
        }
      } else if (tag === "dl") {
        const items: string[] = [];
        let term = "";
        for (const child of children(node)) {
          if (child.nodeName === "dt") term = nodeText(child).trim();
          else if (child.nodeName === "dd") {
            items.push((term ? term + ": " : "") + nodeText(child).trim());
            term = "";
          }
        }
        if (items.length) blocks.push({ kind: "list", items, depth });
      } else if (tag === "table") {
        const rows: NonNullable<HtmlBlock["rows"]> = [];
        const queue = [...children(node)].reverse();
        while (queue.length) {
          yield;
          const row = queue.pop()!;
          if (row.nodeName === "tr") {
            const cells = children(row).filter((cell): cell is HtmlElement => "tagName" in cell && (cell.tagName === "td" || cell.tagName === "th"));
            rows.push({ header: cells.some(cell => cell.tagName === "th"), cells: cells.map(cell => ({
              text: nodeText(cell).split("\n").map(line => line.trim()).filter(Boolean).join("\n"), colspan: Math.max(1, Number(attribute(cell, "colspan")) || 1),
            })) });
          } else if (row.nodeName !== "table") queue.push(...children(row).slice().reverse());
        }
        if (rows.length) blocks.push({ kind: "table", rows });
      } else if (tag === "svg") {
        const svgPrimitives: SvgPrimitive[] = [];
        const queue = [...children(node)].reverse();
        while (queue.length) {
          const child = queue.pop()!;
          if (!("tagName" in child)) continue;
          if (child.tagName === "rect") svgPrimitives.push({ kind: "rect", x: Number(attribute(child, "x")), y: Number(attribute(child, "y")), w: Number(attribute(child, "width")) || 40, h: Number(attribute(child, "height")) || 20 });
          else if (child.tagName === "text") svgPrimitives.push({ kind: "text", x: Number(attribute(child, "x")) || 8, y: Number(attribute(child, "y")) || 16, text: nodeText(child).trim() });
          queue.push(...children(child).slice().reverse());
        }
        blocks.push({ kind: "svg", displayWidth: Number(attribute(node, "width")) || 200, displayHeight: Number(attribute(node, "height")) || 100, svgPrimitives });
      } else yield* visit(children(node), depth);
      if (style.get("page-break-after") === "always") blocks.push({ kind: "pagebreak" });
    }
    flush();
  }
  const htmlNode = children(parser.document).find(node => node.nodeName === "html");
  const body = htmlNode && children(htmlNode).find(node => node.nodeName === "body");
  if (body) yield* visit(children(body));
  return { title, blocks };
}

function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

type DrawAction = (page: ReturnType<PdfDocument["addPage"]>, doc: PdfDocument, grayscale: boolean) => void;

interface LaidOutPageSpec {
  readonly actions: DrawAction[];
  readonly headings?: readonly { title: string; level: number }[];
}

function rgbColor(r: number, g: number, b: number, grayscale: boolean): PdfRgbColor {
  if (!grayscale) return { r, g, b };
  const lum = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * 1000) / 1000;
  return { r: lum, g: lum, b: lum };
}

function* layoutObjectPagesSteps(blocks: readonly HtmlBlock[], box: ReturnType<typeof resolvePageBox>, settings: PageSettings, signal: AbortSignal): Generator<void, LaidOutPageSpec[], void> {
    let cooperativeWork = 0;
    const pages: LaidOutPageSpec[] = [];
    let currentActions: DrawAction[] = [];
    let currentHeadings: { title: string; level: number }[] = [];
    const headerReserve = settings.header.left || settings.header.center || settings.header.right ? 24 : 0;
    const footerReserve = settings.footer.left || settings.footer.center || settings.footer.right ? 24 : 0;
    const topY = box.height - box.marginTop - headerReserve;
    const bottomY = box.marginBottom + footerReserve;
    const contentWidth = Math.max(72, box.width - box.marginLeft - box.marginRight);
    let cursorY = topY;
    const flushPage = () => {
        pages.push({ actions: currentActions, headings: currentHeadings });
        currentActions = [];
        currentHeadings = [];
        cursorY = topY;
    };
    const ensureHeight = (needed: number) => {
        if (cursorY - needed < bottomY && currentActions.length > 0) {
            flushPage();
        }
    };
    let work = 0;
    for (const block of blocks) {
        if (++cooperativeWork % 64 === 0)
            yield;
        signal.throwIfAborted();
        if (++work % 64 === 0)
            signal.throwIfAborted();
        if (block.kind === "pagebreak") {
            flushPage();
            continue;
        }
        if (block.kind === "heading") {
            const level = block.level ?? 1;
            const fontSize = level === 1 ? 20 : level === 2 ? 16 : level === 3 ? 14 : 12;
            const lineHeight = fontSize * 1.35;
            const maxChars = Math.max(15, Math.floor(contentWidth / (fontSize * 0.55)));
            const lines = wrapTextLines(block.text ?? "", maxChars);
            ensureHeight(lines.length * lineHeight + 10);
            if (block.text) {
                currentHeadings.push({ title: block.text, level });
            }
            cursorY -= 4;
            const blockTopY = cursorY;
            for (const line of lines) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const drawY = cursorY - fontSize;
                const x = box.marginLeft;
                currentActions.push((page, _doc, grayscale) => {
                    page.drawText(line, {
                        x,
                        y: drawY,
                        size: fontSize,
                        font: "Helvetica-Bold",
                        color: rgbColor(0.1, 0.12, 0.18, grayscale),
                    });
                });
                cursorY -= lineHeight;
            }
            if (block.links && block.links.length > 0 && settings.useExternalLinks) {
                const rectBottom = cursorY;
                const rectTop = blockTopY;
                for (const link of block.links) {
                    if (++cooperativeWork % 64 === 0)
                        yield;
                    currentActions.push((page) => {
                        page.addLinkAnnotation({
                            rect: [box.marginLeft, rectBottom, box.marginLeft + Math.min(contentWidth, 220), rectTop],
                            uri: link.href,
                        });
                    });
                }
            }
            cursorY -= 6;
            continue;
        }
        if (block.kind === "paragraph") {
            const fontSize = 11;
            const lineHeight = 15;
            const maxChars = Math.max(20, Math.floor(contentWidth / (fontSize * 0.52)));
            const lines = wrapTextLines(block.text ?? "", maxChars);
            ensureHeight(lines.length * lineHeight + 6);
            const blockTopY = cursorY;
            for (const line of lines) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const drawY = cursorY - fontSize;
                const x = box.marginLeft;
                const hasLink = (block.links?.length ?? 0) > 0;
                currentActions.push((page, _doc, grayscale) => {
                    page.drawText(line, {
                        x,
                        y: drawY,
                        size: fontSize,
                        font: "Helvetica",
                        color: hasLink ? rgbColor(0.05, 0.28, 0.72, grayscale) : rgbColor(0.12, 0.12, 0.12, grayscale),
                    });
                });
                cursorY -= lineHeight;
            }
            if (block.links && block.links.length > 0 && settings.useExternalLinks) {
                const rectBottom = cursorY;
                const rectTop = blockTopY;
                for (const link of block.links) {
                    if (++cooperativeWork % 64 === 0)
                        yield;
                    currentActions.push((page) => {
                        page.addLinkAnnotation({
                            rect: [box.marginLeft, rectBottom, box.marginLeft + Math.min(contentWidth, 220), rectTop],
                            uri: link.href,
                        });
                    });
                }
            }
            cursorY -= 6;
            continue;
        }
        if (block.kind === "code") {
            const fontSize = 9.5;
            const lineHeight = 13;
            const rawLines = (block.text ?? "").split("\n");
            const totalHeight = rawLines.length * lineHeight + 12;
            ensureHeight(totalHeight);
            const boxTop = cursorY;
            const boxHeight = totalHeight - 4;
            currentActions.push((page, _doc, grayscale) => {
                page.drawRect({
                    x: box.marginLeft,
                    y: boxTop - boxHeight,
                    width: contentWidth,
                    height: boxHeight,
                    fill: rgbColor(0.95, 0.96, 0.97, grayscale),
                    stroke: rgbColor(0.82, 0.84, 0.87, grayscale),
                    strokeWidth: 0.5,
                });
            });
            cursorY -= 6;
            for (const rawLine of rawLines) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const drawY = cursorY - fontSize;
                const x = box.marginLeft + 6;
                currentActions.push((page, _doc, grayscale) => {
                    page.drawText(rawLine, {
                        x,
                        y: drawY,
                        size: fontSize,
                        font: "Courier",
                        color: rgbColor(0.15, 0.15, 0.2, grayscale),
                    });
                });
                cursorY -= lineHeight;
            }
            cursorY -= 8;
            continue;
        }
        if (block.kind === "list") {
            const fontSize = 11;
            const lineHeight = 15;
            const items = block.items ?? [];
            for (let idx = 0; idx < items.length; idx++) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const prefix = block.continuation ? "" : block.ordered ? `${idx + (block.start ?? 1)}. ` : "• ";
                const indent = (block.depth ?? 0) * 18;
                const lines = wrapTextLines(prefix + items[idx]!, Math.max(20, Math.floor((contentWidth - 14 - indent) / 5.8)));
                ensureHeight(lines.length * lineHeight + 2);
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    if (++cooperativeWork % 64 === 0)
                        yield;
                    const drawY = cursorY - fontSize;
                    const x = box.marginLeft + indent + (lineIdx === 0 ? 10 : 22);
                    const lineText = lines[lineIdx]!;
                    currentActions.push((page, _doc, grayscale) => {
                        page.drawText(lineText, {
                            x,
                            y: drawY,
                            size: fontSize,
                            font: "Helvetica",
                            color: rgbColor(0.12, 0.12, 0.12, grayscale),
                        });
                    });
                    cursorY -= lineHeight;
                }
            }
            cursorY -= 4;
            continue;
        }
        if (block.kind === "blockquote") {
            const fontSize = 10.5;
            const lineHeight = 14.5;
            const maxChars = Math.max(20, Math.floor((contentWidth - 18) / (fontSize * 0.52)));
            const lines = wrapTextLines(block.text ?? "", maxChars);
            const totalH = lines.length * lineHeight + 6;
            ensureHeight(totalH);
            const barTop = cursorY - 2;
            const barBottom = cursorY - totalH + 4;
            currentActions.push((page, _doc, grayscale) => {
                page.drawLine({
                    x1: box.marginLeft + 4,
                    y1: barTop,
                    x2: box.marginLeft + 4,
                    y2: barBottom,
                    stroke: rgbColor(0.45, 0.5, 0.6, grayscale),
                    strokeWidth: 2.2,
                });
            });
            for (const line of lines) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const drawY = cursorY - fontSize;
                const x = box.marginLeft + 14;
                currentActions.push((page, _doc, grayscale) => {
                    page.drawText(line, {
                        x,
                        y: drawY,
                        size: fontSize,
                        font: "Helvetica-Oblique",
                        color: rgbColor(0.25, 0.27, 0.32, grayscale),
                    });
                });
                cursorY -= lineHeight;
            }
            cursorY -= 6;
            continue;
        }
        if (block.kind === "svg") {
            const h = block.displayHeight ?? 100;
            ensureHeight(h + 8);
            const topBoxY = cursorY;
            const prims = block.svgPrimitives ?? [];
            currentActions.push((page, _doc, grayscale) => {
                for (const p of prims) {
                    if (p.kind === "rect") {
                        const rw = p.w ?? 40;
                        const rh = p.h ?? 20;
                        page.drawRect({
                            x: box.marginLeft + p.x,
                            y: topBoxY - p.y - rh,
                            width: rw,
                            height: rh,
                            fill: rgbColor(0.92, 0.94, 0.98, grayscale),
                            stroke: rgbColor(0.3, 0.4, 0.6, grayscale),
                            strokeWidth: 0.8,
                        });
                    }
                    else if (p.kind === "text" && p.text) {
                        page.drawText(p.text, {
                            x: box.marginLeft + p.x,
                            y: topBoxY - p.y,
                            size: 10,
                            font: "Helvetica",
                            color: rgbColor(0.1, 0.12, 0.18, grayscale),
                        });
                    }
                }
            });
            cursorY -= h + 8;
            continue;
        }
        if (block.kind === "table") {
            const rows = block.rows ?? [];
            const colCount = Math.max(1, ...rows.map((r) => r.cells.reduce((sum, c) => sum + c.colspan, 0)));
            const colWidth = contentWidth / colCount;

            for (const row of rows) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const rowHeight = Math.max(20, ...row.cells.map(cell => cell.text.split("\n").length * 13 + 7));
                ensureHeight(rowHeight);
                const rowBottom = cursorY - rowHeight;
                let colCursor = 0;
                for (const cell of row.cells) {
                    if (++cooperativeWork % 64 === 0)
                        yield;
                    if (colCursor >= colCount)
                        break;
                    const span = Math.min(cell.colspan, colCount - colCursor);
                    const cellX = box.marginLeft + colCursor * colWidth;
                    const cellW = span * colWidth;
                    const cellText = cell.text;
                    const isHeader = row.header;
                    currentActions.push((page, _doc, grayscale) => {
                        page.drawRect({
                            x: cellX,
                            y: rowBottom,
                            width: cellW,
                            height: rowHeight,
                            ...(isHeader ? { fill: rgbColor(0.91, 0.93, 0.96, grayscale) } : {}),
                            stroke: rgbColor(0.7, 0.73, 0.78, grayscale),
                            strokeWidth: 0.6,
                        });
                        for (const [lineIndex, line] of cellText.split("\n").entries()) {
                          page.drawText(line.replaceAll("\t", "   "), {
                            x: cellX + 5,
                            y: rowBottom + rowHeight - 14 - lineIndex * 13,
                            size: 9.5,
                            font: isHeader ? "Helvetica-Bold" : "Helvetica",
                            color: rgbColor(0.1, 0.1, 0.12, grayscale),
                          });
                        }
                    });
                    colCursor += span;
                }
                cursorY -= rowHeight;
            }
            cursorY -= 8;
            continue;
        }
        if (block.kind === "hr") {
            ensureHeight(12);
            const lineY = cursorY - 6;
            currentActions.push((page, _doc, grayscale) => {
                page.drawLine({
                    x1: box.marginLeft,
                    y1: lineY,
                    x2: box.marginLeft + contentWidth,
                    y2: lineY,
                    stroke: rgbColor(0.75, 0.75, 0.78, grayscale),
                    strokeWidth: 0.75,
                });
            });
            cursorY -= 12;
            continue;
        }
        if (block.kind === "image" && block.pngBytes) {
            const w = block.displayWidth ?? 120;
            const h = block.displayHeight ?? 90;
            ensureHeight(h + 8);
            const drawY = cursorY - h;
            const pngBytes = block.pngBytes;
            currentActions.push((page, doc) => {
                const imgRef = doc.embedPng(pngBytes);
                page.drawImage(imgRef, {
                    x: box.marginLeft,
                    y: drawY,
                    width: w,
                    height: h,
                });
            });
            cursorY -= h + 8;
        }
    }
    if (currentActions.length > 0 || pages.length === 0) {
        flushPage();
    }
    return pages;
}

function substituteFurnitureTokens(
  template: string,
  tokens: { page: number; topage: number; webpage: string; title: string; section?: string; subsection?: string },
  replacements: readonly [string, string][] = []
): string {
  const isoDate = new Date().toISOString().slice(0, 10);
  let out = template
    .replace(/\[page\]/g, String(tokens.page))
    .replace(/\[topage\]/g, String(tokens.topage))
    .replace(/\[toPage\]/g, String(tokens.topage))
    .replace(/\[webpage\]/g, tokens.webpage)
    .replace(/\[title\]/g, tokens.title)
    .replace(/\[section\]/g, tokens.section ?? tokens.title)
    .replace(/\[subsection\]/g, tokens.subsection ?? "")
    .replace(/\[isodate\]/g, isoDate)
    .replace(/\[date\]/g, isoDate);
  for (const [rk, rv] of replacements) {
    if (rk) out = out.split(`[${rk}]`).join(rv);
  }
  return out;
}

function* renderPdfAstSteps(request: Parameters<StaticRenderer["open"]>[0]): Generator<void, Uint8Array, void> {
    let cooperativeWork = 0;
    request.signal.throwIfAborted();
    const { job, inputs, signal, limits } = request;
    const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
    const box = resolvePageBox(job.global);
    const grayscale = job.global.colorMode === "grayscale";
    const laidOutPerObject: LaidOutPageSpec[][] = [];
    const objectMeta: {
        title: string;
        webpage: string;
        settings: PageSettings;
    }[] = [];
    let inferredDocumentTitle = job.global.documentTitle;
    for (let i = 0; i < job.objects.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        signal.throwIfAborted();
        const obj = job.objects[i]!;
        const htmlBytes = inputs[i] ?? new Uint8Array(0);
        const htmlText = decoder.decode(htmlBytes);
        const parsed = (yield* parseHtmlDocumentSteps(htmlText, obj.settings.replacements, signal));
        if (!inferredDocumentTitle && parsed.title) {
            inferredDocumentTitle = parsed.title;
        }
        const pages = (yield* layoutObjectPagesSteps(parsed.blocks, box, obj.settings, signal));
        laidOutPerObject.push(pages);
        objectMeta.push({
            title: job.global.documentTitle || parsed.title || inferredDocumentTitle || "Document",
            webpage: obj.input ?? "-",
            settings: obj.settings,
        });
    }
    const sequence = planPageSequence(laidOutPerObject.map((pages, idx) => ({
        physicalPages: pages.length,
        pagesCount: job.objects[idx]!.settings.pagesCount,
    })), {
        copies: job.global.copies,
        collate: job.global.collate,
        pageOffset: job.global.pageOffset,
        limits: {
            maxObjects: limits.parse.maxObjects,
            maxPhysicalPages: limits.maxPages ?? Infinity,
            maxWork: limits.resources.maxWork,
        },
        signal,
    });
    const doc = PdfDocument.create();
    doc.setMetadata({
        title: inferredDocumentTitle || "Document",
        creator: "wkhtmltopdf (pdf-ast-static)",
        producer: "@poe-code/pdf-ast",
    });
    const outlineEntries: { title: string; level: number; pageRef: ReturnType<PdfDocument["addPage"]>["ref"] }[] = [];
    for (const outPage of sequence.pages) {
        yield;
        signal.throwIfAborted();
        const spec = laidOutPerObject[outPage.objectIndex]![outPage.pageIndex]!;
        const meta = objectMeta[outPage.objectIndex]!;
        const page = doc.addPage({ width: box.width, height: box.height });
        if (job.global.outline && job.global.outlineDepth > 0 && outPage.copyIndex === 0 && meta.settings.includeInOutline) {
            for (const h of spec.headings ?? []) {
                if (h.level <= job.global.outlineDepth) {
                    outlineEntries.push({ title: h.title, level: h.level, pageRef: page.ref });
                }
            }
        }
        const tokens = {
            page: outPage.logicalPage,
            topage: sequence.logicalTotal + job.global.pageOffset,
            webpage: meta.webpage,
            title: meta.title,
        };
        const repl = meta.settings.replacements;
        const header = meta.settings.header;
        const footer = meta.settings.footer;
        const headerY = box.height - Math.max(18, box.marginTop * 0.6);
        if (header.left) {
            page.drawText(substituteFurnitureTokens(header.left, tokens, repl), {
                x: box.marginLeft,
                y: headerY,
                size: Math.min(10, header.fontSize || 9),
                font: "Helvetica",
                color: rgbColor(0.35, 0.35, 0.38, grayscale),
            });
        }
        if (header.center) {
            const text = substituteFurnitureTokens(header.center, tokens, repl);
            page.drawText(text, {
                x: Math.max(box.marginLeft, (box.width - text.length * 4.5) / 2),
                y: headerY,
                size: Math.min(10, header.fontSize || 9),
                font: "Helvetica",
                color: rgbColor(0.35, 0.35, 0.38, grayscale),
            });
        }
        if (header.right) {
            const text = substituteFurnitureTokens(header.right, tokens, repl);
            page.drawText(text, {
                x: Math.max(box.marginLeft, box.width - box.marginRight - text.length * 4.8),
                y: headerY,
                size: Math.min(10, header.fontSize || 9),
                font: "Helvetica",
                color: rgbColor(0.35, 0.35, 0.38, grayscale),
            });
        }
        if (header.line) {
            page.drawLine({
                x1: box.marginLeft,
                y1: headerY - 4,
                x2: box.width - box.marginRight,
                y2: headerY - 4,
                stroke: rgbColor(0.7, 0.7, 0.74, grayscale),
                strokeWidth: 0.5,
            });
        }
        for (const action of spec.actions) {
            if (++cooperativeWork % 64 === 0)
                yield;
            action(page, doc, grayscale);
        }
        const footerY = Math.max(12, box.marginBottom * 0.5);
        if (footer.left) {
            page.drawText(substituteFurnitureTokens(footer.left, tokens, repl), {
                x: box.marginLeft,
                y: footerY,
                size: Math.min(10, footer.fontSize || 9),
                font: "Helvetica",
                color: rgbColor(0.35, 0.35, 0.38, grayscale),
            });
        }
        if (footer.center) {
            const text = substituteFurnitureTokens(footer.center, tokens, repl);
            page.drawText(text, {
                x: Math.max(box.marginLeft, (box.width - text.length * 4.5) / 2),
                y: footerY,
                size: Math.min(10, footer.fontSize || 9),
                font: "Helvetica",
                color: rgbColor(0.35, 0.35, 0.38, grayscale),
            });
        }
        if (footer.right) {
            const text = substituteFurnitureTokens(footer.right, tokens, repl);
            page.drawText(text, {
                x: Math.max(box.marginLeft, box.width - box.marginRight - text.length * 4.8),
                y: footerY,
                size: Math.min(10, footer.fontSize || 9),
                font: "Helvetica",
                color: rgbColor(0.35, 0.35, 0.38, grayscale),
            });
        }
        if (footer.line) {
            page.drawLine({
                x1: box.marginLeft,
                y1: footerY + 11,
                x2: box.width - box.marginRight,
                y2: footerY + 11,
                stroke: rgbColor(0.7, 0.7, 0.74, grayscale),
                strokeWidth: 0.5,
            });
        }
    }
    if (outlineEntries.length > 0 && doc.cos.rootRef) {
        const catalog = doc.cos.resolveDict(doc.cos.rootRef);
        if (catalog) {
            const outlinesDict = cosDict({ Type: cosName("Outlines") });
            const outlinesRef = doc.cos.allocateObject(outlinesDict);
            dictSet(catalog, "Outlines", outlinesRef);
            interface OutlineParentState {
                ref: ReturnType<typeof doc.cos.allocateObject>;
                dict: PdfCosDict;
                children: Array<{ ref: ReturnType<typeof doc.cos.allocateObject>; dict: PdfCosDict }>;
            }
            const stack: OutlineParentState[] = [{ ref: outlinesRef, dict: outlinesDict, children: [] }];
            for (const bm of outlineEntries) {
                const targetLevel = Math.max(1, bm.level);
                while (stack.length > targetLevel) {
                    stack.pop();
                }
                while (stack.length < targetLevel) {
                    const top = stack[stack.length - 1]!;
                    const lastChild = top.children[top.children.length - 1];
                    if (lastChild) {
                        stack.push({ ref: lastChild.ref, dict: lastChild.dict, children: [] });
                    } else {
                        break;
                    }
                }
                const parentState = stack[stack.length - 1]!;
                const itemDict = cosDict({
                    Title: cosString(bm.title),
                    Parent: parentState.ref,
                    Dest: cosArray([bm.pageRef, cosName("XYZ"), { kind: "null" }, { kind: "null" }, { kind: "null" }]),
                });
                const itemRef = doc.cos.allocateObject(itemDict);
                const prevSibling = parentState.children[parentState.children.length - 1];
                if (prevSibling) {
                    dictSet(prevSibling.dict, "Next", itemRef);
                    dictSet(itemDict, "Prev", prevSibling.ref);
                } else {
                    dictSet(parentState.dict, "First", itemRef);
                }
                dictSet(parentState.dict, "Last", itemRef);
                parentState.children.push({ ref: itemRef, dict: itemDict });
                dictSet(parentState.dict, "Count", cosNumber(parentState.children.length));
            }
        }
    }
    return doc.save();
}

export function createPdfAstRenderer(): StaticRenderer {
  return Object.freeze({
    profile: pdfAstRendererProfile,
    async open(request: Parameters<StaticRenderer["open"]>[0]): Promise<RenderedDocument> {
      const pdfBytes = await drainCooperativeSteps(renderPdfAstSteps(request), request.signal);
      return {
        success: true,
        errorCode: 0,
        chunks: [pdfBytes],
        async close() {},
      };
    },
  });
}

export const pdfAstRenderer: StaticRenderer = createPdfAstRenderer();

export function createPdfAstWkhtmltopdfCommand(
  options: Partial<WkhtmltopdfCommandOptions> = {}
): CommandDefinition {
  return createWkhtmltopdfCommand({
    limits: options.limits ?? wkhtmltopdfLimits,
    renderer: options.renderer ?? pdfAstRenderer,
    ...(options.replace === undefined ? {} : { replace: options.replace }),
  });
}

export const pdfAstWkhtmltopdfCommand: CommandDefinition = createPdfAstWkhtmltopdfCommand();

export function pdfAstWkhtmltopdfCommands(
  options: Partial<WkhtmltopdfCommandOptions> = {}
): VirtualShellPlugin {
  return wkhtmltopdfCommands({
    limits: options.limits ?? wkhtmltopdfLimits,
    renderer: options.renderer ?? pdfAstRenderer,
    ...(options.replace === undefined ? {} : { replace: options.replace }),
  });
}

export function renderPdfAstSync(request: Parameters<StaticRenderer["open"]>[0]): Uint8Array {
 const steps=renderPdfAstSteps(request); let next=steps.next(); while(!next.done) next=steps.next(); return next.value;
}
