import { PdfDocument, decodePng, type PdfRgbColor } from "@poe-code/pdf-ast";
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
  rows?: { cells: { text: string; colspan: number }[]; header: boolean }[];
  links?: { text: string; href: string }[];
  pngBytes?: Uint8Array;
  displayWidth?: number;
  displayHeight?: number;
  svgPrimitives?: SvgPrimitive[];
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#x([0-9a-f]+)|#([0-9]+));/gi, (full, entity: string, hex?: string, dec?: string) => {
    if (hex !== undefined) {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "\uFFFD";
    }
    if (dec !== undefined) {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "\uFFFD";
    }
    switch (entity.toLowerCase()) {
      case "nbsp": return " ";
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return "\"";
      case "apos":
      case "#39": return "'";
      default: return full;
    }
  });
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
  ).trim();
}

function extractLinks(html: string): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const linkRegex = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    const text = stripTags(match[4] ?? "");
    if (href && text) {
      links.push({ text, href });
    }
  }
  return links;
}

function parseHtmlDocument(rawHtml: string, replacements: readonly [string, string][]): {
  title: string;
  blocks: HtmlBlock[];
} {
  let html = rawHtml;
  for (const [key, value] of replacements) {
    if (key) html = html.split(key).join(value);
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1] ?? "") : "";

  const bodyHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");

  const blocks: HtmlBlock[] = [];
  const tokenRegex =
    /<(h[1-6]|p|pre|ul|ol|dl|table|svg|hr|img|blockquote|div|section|article)\b([^>]*)>([\s\S]*?)<\/\1>|<(hr|img)\b([^>]*?)\/?>/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(bodyHtml)) !== null) {
    const leadingText = stripTags(bodyHtml.slice(lastIndex, match.index));
    if (leadingText) {
      blocks.push({ kind: "paragraph", text: leadingText, links: extractLinks(bodyHtml.slice(lastIndex, match.index)) });
    }
    lastIndex = tokenRegex.lastIndex;

    const tag = (match[1] ?? match[4] ?? "").toLowerCase();
    const attrs = match[2] ?? match[5] ?? "";
    const inner = match[3] ?? "";

    if (/page-break-before\s*:\s*always/i.test(attrs) || /class=["'][^"']*page-break/i.test(attrs)) {
      blocks.push({ kind: "pagebreak" });
    }

    if (tag === "hr") {
      blocks.push({ kind: "hr" });
    } else if (tag === "img") {
      const srcMatch = /src=(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? "") : "";
      if (src.startsWith("data:image/png;base64,")) {
        try {
          const b64 = src.slice("data:image/png;base64,".length).trim();
          const pngBytes = decodeBase64(b64);
          const bitmap = decodePng(pngBytes);
          const widthAttr = /width=["']?(\d+)/i.exec(attrs);
          const heightAttr = /height=["']?(\d+)/i.exec(attrs);
          blocks.push({
            kind: "image",
            pngBytes,
            displayWidth: widthAttr ? Number(widthAttr[1]) : Math.min(240, bitmap.width),
            displayHeight: heightAttr ? Number(heightAttr[1]) : Math.min(180, bitmap.height),
          });
        } catch {
          // Ignore malformed data URL image
        }
      }
    } else if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = stripTags(inner);
      if (text) {
        blocks.push({ kind: "heading", level, text, links: extractLinks(inner) });
      }
    } else if (tag === "pre") {
      const codeText = decodeHtmlEntities(inner.replace(/<[^>]+>/g, "")).replace(/\r\n/g, "\n").trim();
      if (codeText) {
        blocks.push({ kind: "code", text: codeText });
      }
    } else if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        const itemText = stripTags(liMatch[1] ?? "");
        if (itemText) items.push(itemText);
      }
      if (items.length > 0) {
        blocks.push({ kind: "list", ordered: tag === "ol", items });
      }
    } else if (tag === "dl") {
      const items: string[] = [];
      const dtDdRegex = /<(dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let m: RegExpExecArray | null;
      let currentTerm = "";
      while ((m = dtDdRegex.exec(inner)) !== null) {
        const t = m[1]!.toLowerCase();
        const txt = stripTags(m[2] ?? "");
        if (t === "dt") {
          currentTerm = txt;
        } else if (t === "dd") {
          items.push(currentTerm ? `${currentTerm}: ${txt}` : txt);
          currentTerm = "";
        }
      }
      if (items.length > 0) {
        blocks.push({ kind: "list", ordered: false, items });
      }
    } else if (tag === "svg") {
      const wMatch = /width=["']?(\d+)/i.exec(attrs);
      const hMatch = /height=["']?(\d+)/i.exec(attrs);
      const displayWidth = wMatch ? Number(wMatch[1]) : 200;
      const displayHeight = hMatch ? Number(hMatch[1]) : 100;
      const svgPrimitives: SvgPrimitive[] = [];
      const rectRe = /<rect\b([^>]*)\/?>/gi;
      let rm: RegExpExecArray | null;
      while ((rm = rectRe.exec(inner)) !== null) {
        const ra = rm[1] ?? "";
        const rx = Number(/\bx=["']?([\d.]+)/i.exec(ra)?.[1] ?? 0);
        const ry = Number(/\by=["']?([\d.]+)/i.exec(ra)?.[1] ?? 0);
        const rw = Number(/\bwidth=["']?([\d.]+)/i.exec(ra)?.[1] ?? 40);
        const rh = Number(/\bheight=["']?([\d.]+)/i.exec(ra)?.[1] ?? 20);
        svgPrimitives.push({ kind: "rect", x: rx, y: ry, w: rw, h: rh });
      }
      const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = textRe.exec(inner)) !== null) {
        const ta = tm[1] ?? "";
        const tx = Number(/\bx=["']?([\d.]+)/i.exec(ta)?.[1] ?? 8);
        const ty = Number(/\by=["']?([\d.]+)/i.exec(ta)?.[1] ?? 16);
        const txt = stripTags(tm[2] ?? "");
        if (txt) svgPrimitives.push({ kind: "text", x: tx, y: ty, text: txt });
      }
      blocks.push({ kind: "svg", displayWidth, displayHeight, svgPrimitives });
    } else if (tag === "blockquote") {
      const text = stripTags(inner);
      if (text) {
        blocks.push({ kind: "blockquote", text, links: extractLinks(inner) });
      }
    } else if (tag === "table") {
      const rows: { cells: { text: string; colspan: number }[]; header: boolean }[] = [];
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;
      while ((trMatch = trRegex.exec(inner)) !== null) {
        const rowHtml = trMatch[1] ?? "";
        const cells: { text: string; colspan: number }[] = [];
        let header = false;
        const cellRegex = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
          if (cellMatch[1]?.toLowerCase() === "th") header = true;
          const cellAttrs = cellMatch[2] ?? "";
          const colspanMatch = /colspan=["']?(\d+)/i.exec(cellAttrs);
          const colspan = Math.max(1, colspanMatch ? Number(colspanMatch[1]) : 1);
          cells.push({ text: stripTags(cellMatch[3] ?? ""), colspan });
        }
        if (cells.length > 0) {
          rows.push({ cells, header });
        }
      }
      if (rows.length > 0) {
        blocks.push({ kind: "table", rows });
      }
    } else {
      if (/<(h[1-6]|p|pre|ul|ol|dl|table|svg|hr|img|blockquote|div|section|article)\b/i.test(inner)) {
        const nested = parseHtmlDocument(inner, []);
        blocks.push(...nested.blocks);
      } else {
        const text = stripTags(inner);
        if (text) {
          blocks.push({ kind: "paragraph", text, links: extractLinks(inner) });
        }
      }
    }

    if (/page-break-after\s*:\s*always/i.test(attrs)) {
      blocks.push({ kind: "pagebreak" });
    }
  }

  const trailingText = stripTags(bodyHtml.slice(lastIndex));
  if (trailingText) {
    blocks.push({ kind: "paragraph", text: trailingText, links: extractLinks(bodyHtml.slice(lastIndex)) });
  }

  if (blocks.length === 0) {
    const fallback = stripTags(bodyHtml);
    if (fallback) {
      blocks.push({ kind: "paragraph", text: fallback });
    }
  }

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
}

function rgbColor(r: number, g: number, b: number, grayscale: boolean): PdfRgbColor {
  if (!grayscale) return { r, g, b };
  const lum = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * 1000) / 1000;
  return { r: lum, g: lum, b: lum };
}

function layoutObjectPages(
  blocks: readonly HtmlBlock[],
  box: ReturnType<typeof resolvePageBox>,
  settings: PageSettings
): LaidOutPageSpec[] {
  const pages: LaidOutPageSpec[] = [];
  let currentActions: DrawAction[] = [];
  const headerReserve = settings.header.left || settings.header.center || settings.header.right ? 24 : 0;
  const footerReserve = settings.footer.left || settings.footer.center || settings.footer.right ? 24 : 0;
  const topY = box.height - box.marginTop - headerReserve;
  const bottomY = box.marginBottom + footerReserve;
  const contentWidth = Math.max(72, box.width - box.marginLeft - box.marginRight);
  let cursorY = topY;

  const flushPage = () => {
    pages.push({ actions: currentActions });
    currentActions = [];
    cursorY = topY;
  };

  const ensureHeight = (needed: number) => {
    if (cursorY - needed < bottomY && currentActions.length > 0) {
      flushPage();
    }
  };

  for (const block of blocks) {
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
      cursorY -= 4;
      const blockTopY = cursorY;
      for (const line of lines) {
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
        const prefix = block.ordered ? `${idx + 1}. ` : "• ";
        const lines = wrapTextLines(prefix + items[idx]!, Math.max(20, Math.floor((contentWidth - 14) / 5.8)));
        ensureHeight(lines.length * lineHeight + 2);
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const drawY = cursorY - fontSize;
          const x = box.marginLeft + (lineIdx === 0 ? 10 : 22);
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
      const w = Math.min(contentWidth, block.displayWidth ?? 200);
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
          } else if (p.kind === "text" && p.text) {
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
      const colCount = Math.max(
        1,
        ...rows.map((r) => r.cells.reduce((sum, c) => sum + c.colspan, 0))
      );
      const colWidth = contentWidth / colCount;
      const rowHeight = 20;
      ensureHeight(rows.length * rowHeight + 8);
      for (const row of rows) {
        ensureHeight(rowHeight);
        const rowBottom = cursorY - rowHeight;
        let colCursor = 0;
        for (const cell of row.cells) {
          if (colCursor >= colCount) break;
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
            page.drawText(cellText, {
              x: cellX + 5,
              y: rowBottom + 6,
              size: 9.5,
              font: isHeader ? "Helvetica-Bold" : "Helvetica",
              color: rgbColor(0.1, 0.1, 0.12, grayscale),
            });
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
  tokens: { page: number; topage: number; webpage: string; title: string; section?: string; subsection?: string }
): string {
  const isoDate = new Date().toISOString().slice(0, 10);
  return template
    .replace(/\[page\]/g, String(tokens.page))
    .replace(/\[topage\]/g, String(tokens.topage))
    .replace(/\[webpage\]/g, tokens.webpage)
    .replace(/\[title\]/g, tokens.title)
    .replace(/\[section\]/g, tokens.section ?? tokens.title)
    .replace(/\[subsection\]/g, tokens.subsection ?? "")
    .replace(/\[isodate\]/g, isoDate)
    .replace(/\[date\]/g, isoDate);
}

export function createPdfAstRenderer(): StaticRenderer {
  return Object.freeze({
    profile: pdfAstRendererProfile,
    async open(request: Parameters<StaticRenderer["open"]>[0]): Promise<RenderedDocument> {
      request.signal.throwIfAborted();
      const { job, inputs, signal, limits } = request;
      const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
      const box = resolvePageBox(job.global);
      const grayscale = job.global.colorMode === "grayscale";

      const laidOutPerObject: LaidOutPageSpec[][] = [];
      const objectMeta: { title: string; webpage: string; settings: PageSettings }[] = [];
      let inferredDocumentTitle = job.global.documentTitle;

      for (let i = 0; i < job.objects.length; i++) {
        signal.throwIfAborted();
        const obj = job.objects[i]!;
        const htmlBytes = inputs[i] ?? new Uint8Array(0);
        const htmlText = decoder.decode(htmlBytes);
        const parsed = parseHtmlDocument(htmlText, obj.settings.replacements);
        if (!inferredDocumentTitle && parsed.title) {
          inferredDocumentTitle = parsed.title;
        }
        const pages = layoutObjectPages(parsed.blocks, box, obj.settings);
        laidOutPerObject.push(pages);
        objectMeta.push({
          title: parsed.title || inferredDocumentTitle || "Document",
          webpage: obj.input ?? "-",
          settings: obj.settings,
        });
      }

      const sequence = planPageSequence(
        laidOutPerObject.map((pages, idx) => ({
          physicalPages: pages.length,
          pagesCount: job.objects[idx]!.settings.pagesCount,
        })),
        {
          copies: job.global.copies,
          collate: job.global.collate,
          pageOffset: job.global.pageOffset,
          limits: {
            maxObjects: limits.parse.maxObjects,
            maxPhysicalPages: 4096,
            maxWork: limits.resources.maxWork,
          },
          signal,
        }
      );

      const doc = PdfDocument.create();
      doc.setMetadata({
        title: inferredDocumentTitle || "Document",
        creator: "wkhtmltopdf (pdf-ast-static)",
        producer: "@poe-code/pdf-ast",
      });

      for (const outPage of sequence.pages) {
        signal.throwIfAborted();
        const spec = laidOutPerObject[outPage.objectIndex]![outPage.pageIndex]!;
        const meta = objectMeta[outPage.objectIndex]!;
        const page = doc.addPage({ width: box.width, height: box.height });

        for (const action of spec.actions) {
          action(page, doc, grayscale);
        }

        const tokens = {
          page: outPage.logicalPage,
          topage: sequence.logicalTotal + job.global.pageOffset,
          webpage: meta.webpage,
          title: meta.title,
        };

        const { header, footer } = meta.settings;
        const headerY = box.height - Math.max(18, box.marginTop * 0.65);
        if (header.left) {
          page.drawText(substituteFurnitureTokens(header.left, tokens), {
            x: box.marginLeft,
            y: headerY,
            size: Math.min(10, header.fontSize || 9),
            font: "Helvetica",
            color: rgbColor(0.35, 0.35, 0.38, grayscale),
          });
        }
        if (header.center) {
          const text = substituteFurnitureTokens(header.center, tokens);
          page.drawText(text, {
            x: Math.max(box.marginLeft, (box.width - text.length * 4.5) / 2),
            y: headerY,
            size: Math.min(10, header.fontSize || 9),
            font: "Helvetica",
            color: rgbColor(0.35, 0.35, 0.38, grayscale),
          });
        }
        if (header.right) {
          const text = substituteFurnitureTokens(header.right, tokens);
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

        const footerY = Math.max(12, box.marginBottom * 0.5);
        if (footer.left) {
          page.drawText(substituteFurnitureTokens(footer.left, tokens), {
            x: box.marginLeft,
            y: footerY,
            size: Math.min(10, footer.fontSize || 9),
            font: "Helvetica",
            color: rgbColor(0.35, 0.35, 0.38, grayscale),
          });
        }
        if (footer.center) {
          const text = substituteFurnitureTokens(footer.center, tokens);
          page.drawText(text, {
            x: Math.max(box.marginLeft, (box.width - text.length * 4.5) / 2),
            y: footerY,
            size: Math.min(10, footer.fontSize || 9),
            font: "Helvetica",
            color: rgbColor(0.35, 0.35, 0.38, grayscale),
          });
        }
        if (footer.right) {
          const text = substituteFurnitureTokens(footer.right, tokens);
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

      const pdfBytes = doc.save();

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
