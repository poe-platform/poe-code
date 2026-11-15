import { docxImageDimension } from "./docx-image-size.js";
import { docxPageDimension } from "./docx-page-size.js";
import { decodeJpegImage } from "@poe-code/image-ast";
import { csvFormulaCell, calculateCsvFormulas } from "./csv-formulas.js";
import { isCsvNumber } from "./csv-number.js";
import { parseXml, type XmlElement } from "@poe-code/safe-fs/xml";
import { xlsxDateText, xlsxDateSerial } from "./xlsx-dates.js";
import { xlsxMetadata, xlsxDocumentPrefix, xlsxDocumentSuffix } from "./xlsx-parts.js";
import { docxMetadata, docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";
import { tryRetainedTextConversion } from "./retained-conversion.js";
import { rtfTextSteps } from "./rtf-text.js";
import { catRetainedText } from "./retained-text.js";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type { ByteSink } from "safe-bash-contracts/io";
import { parseHtmlBlocks, escapeHtmlText, type DocBlock } from "./html.js";
import { parseMarkdownTableRows } from "./text-table.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { MemoryFileSystem, resolvePath } from "@poe-code/safe-fs/core";
import { convertOds, starCalcCsvOptions } from "./spreadsheet.js";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { PdfDocument, rgb } from "@poe-code/pdf-ast";

export interface SofficeLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxArgumentBytes: number;
}

function resolveLimits(options: SofficeCommandOptions): SofficeLimits {
  const limits = { maxInputBytes: Infinity, maxOutputBytes: Infinity, maxArgumentBytes: Infinity, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError(`${name} limit must be a nonnegative safe integer or Infinity`);
  }
  return limits;
}

export interface SofficeCommandOptions {
  readonly limits?: Partial<SofficeLimits>;
  readonly replace?: boolean;
}

export interface SofficeCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export { createStoredZipArchive, readZipArchiveEntries } from "@poe-code/office-package/zip-sync";
import { createStoredZipArchive, readZipArchiveEntries } from "@poe-code/office-package/zip-sync";

function unescapeXml(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseDocxBlocks(zipBytes: Uint8Array, pdf: boolean): { blocks: DocBlock[]; width: number; height: number } {
  const entries = readZipArchiveEntries(zipBytes);
  const docXmlBytes = entries.get("word/document.xml");
  if (!docXmlBytes) return { blocks: [], width: 612, height: 792 };
  const relTargets = new Map<string, string>();
  const relBytes = entries.get("word/_rels/document.xml.rels");
  if (relBytes) {
    const relXml = new TextDecoder().decode(relBytes);
    for (const rel of relXml.matchAll(/<(?:[A-Za-z0-9_-]+:)?Relationship\b[^>]*?>/g)) {
      const idMatch = /\bId="([^"]+)"/.exec(rel[0]);
      const targetMatch = /\bTarget="([^"]+)"/.exec(rel[0]);
      if (idMatch?.[1] && targetMatch?.[1]) {
        const rawTarget = targetMatch[1].replace(/^\/+/, "");
        const normalized = rawTarget.startsWith("../")
          ? rawTarget.replace(/^\.\.\//, "")
          : rawTarget.startsWith("word/")
            ? rawTarget
            : `word/${rawTarget}`;
        relTargets.set(idMatch[1], normalized);
      }
    }
  }
  const headingStyleIds = new Set<string>(["title", "subtitle"]);
  const stylesBytes = entries.get("word/styles.xml");
  if (stylesBytes) {
    const stylesXml = new TextDecoder().decode(stylesBytes);
    for (const st of stylesXml.matchAll(/<((?:[A-Za-z0-9_-]+:)?style)\b([^>]*?)>([\s\S]*?)<\/\1>/g)) {
      const idMatch = /\b(?:[A-Za-z0-9_-]+:)?styleId="([^"]+)"/.exec(st[2] ?? "");
      const nameMatch = /<(?:[A-Za-z0-9_-]+:)?name\b[^>]*?\b(?:[A-Za-z0-9_-]+:)?val="([^"]+)"/.exec(st[3] ?? "");
      const szMatch = /<(?:[A-Za-z0-9_-]+:)?sz\b[^>]*?\b(?:[A-Za-z0-9_-]+:)?val="(\d+)"/.exec(st[3] ?? "");
      const szVal = szMatch ? Number.parseInt(szMatch[1]!, 10) : 0;
      const isBold = /<(?:[A-Za-z0-9_-]+:)?b(?:\s|\/>|>)/.test(st[3] ?? "");
      const styleId = idMatch?.[1] ?? "";
      const styleName = (nameMatch?.[1] ?? "").toLowerCase();
      if (
        styleId &&
        styleId.toLowerCase() !== "normal" &&
        (styleName.startsWith("heading") ||
          styleName.includes("section") ||
          styleName === "title" ||
          styleName === "subtitle" ||
          /^heading/i.test(styleId) ||
          /^title$/i.test(styleId) ||
          szVal >= 26 ||
          (isBold && szVal >= 24))
      ) {
        headingStyleIds.add(styleId.toLowerCase());
      }
    }
  }
  const source = new TextDecoder().decode(docXmlBytes);
  const root = parseXml(`<root xmlns:w="w" xmlns:wp="wp" xmlns:a="a" xmlns:r="r">${source.startsWith('<?xml') ? source.slice(source.indexOf('?>') + 2) : source}</root>`);
  const attribute = (element: XmlElement, name: string) => element.attributes.find(attr => attr.localName === name)?.value;
  const section = [...pptxElements(root, "sectPr")].at(-1);
  const size = section?.children.find(child => child.localName === "pgSz");
  const width = docxPageDimension(size && attribute(size, "w"), 612);
  const height = docxPageDimension(size && attribute(size, "h"), 792);
  const contentWidth = Math.max(1, width - 108);
  const blocks: DocBlock[] = [];
  const pending = [...root.children].reverse();
  while (pending.length) {
    const element = pending.pop()!;
    if (element.localName === "tbl" && !(pdf && ([...pptxElements(element, "drawing")].length || [...pptxElements(element, "pict")].length))) {
      const rows = [...pptxElements(element, "tr")].map(row => [...pptxElements(row, "tc")].map(cell => [...pptxElements(cell, "t")].map(text => text.text).join("").trim()));
      if (rows.length) blocks.push({kind: "table", rows});
    } else if (element.localName === "p") {
      const style = [...pptxElements(element, "pStyle")][0];
      const size = [...pptxElements(element, "sz")][0];
      const styleName = style ? (attribute(style, "val") ?? "").toLowerCase() : "";
      const kind = styleName.startsWith("heading") || headingStyleIds.has(styleName) || Number(size && attribute(size, "val")) >= 28 ? "heading" : "paragraph";
      const before = element.children.find(child => child.localName === "pPr")?.children.find(child => child.localName === "pageBreakBefore");
      if (before && [undefined, "1", "true", "on"].includes(attribute(before, "val"))) blocks.push({kind: "pageBreakBefore"});
      const firstBlock = blocks.length;
      let text = "";
      let styles: NonNullable<DocBlock["styles"]> = [];
      const flush = () => {
        const value = text.split("\n").map(line => line.trim()).join("\n");
        if (value) blocks.push(pdf && styles.length ? {kind, text, styles} : {kind, text: value});
        text = ""; styles = [];
      };
      const runs = [...element.children].reverse().map(run => ({run, bold: false, italic: false}));
      while (runs.length) {
        const current = runs.pop()!;
        const {run} = current;
        let {bold, italic} = current;
        if (run.localName === "r") {
          bold = false; italic = false;
          for (const property of run.children.find(child => child.localName === "rPr")?.children ?? []) {
            const enabled = [undefined, "1", "true", "on"].includes(attribute(property, "val"));
            if (property.localName === "b") bold = enabled;
            if (property.localName === "i") italic = enabled;
          }
        }
        if (run.localName === "t") {
          if (pdf && (bold || italic)) styles.push({start: text.length, end: text.length + run.text.length, bold, italic});
          text += run.text;
        }
        else if (run.localName === "tab") text += "\t";
        else if (run.localName === "br" && attribute(run, "type") === "page") { flush(); blocks.push({kind: "pageBreak"}); }
        else if (run.localName === "br" || run.localName === "cr") text += "\n";
        else if (run.localName === "drawing" || run.localName === "pict") {
          flush();
          const blip = [...pptxElements(run, "blip")][0];
          const id = blip && attribute(blip, "embed");
          if (!id) continue;
          const path = relTargets.get(id), imageBytes = path ? entries.get(path) : undefined;
          if (!imageBytes) throw new Error("Missing referenced DOCX image");
          const extent = [...pptxElements(run, "extent"), ...pptxElements(run, "ext")][0];
          let width = docxImageDimension(extent && attribute(extent, "cx"), 432);
          let height = docxImageDimension(extent && attribute(extent, "cy"), 226.8);
          if (width > contentWidth) { height *= contentWidth / width; width = contentWidth; }
          blocks.push({kind: "image", imageBytes, width, height});
        } else if (run.localName !== "pPr" && run.localName !== "rPr") runs.push(...[...run.children].reverse().map(run => ({run, bold, italic})));
      }
      flush();
      if (pdf && blocks.length === firstBlock) blocks.push({kind, text: ""});
    } else pending.push(...[...element.children].reverse());
  }
  return { blocks, width, height };
}

function parseXlsxRows(zipBytes: Uint8Array, displayDates = false): string[][] {
  const entries = readZipArchiveEntries(zipBytes);
  const formats = new Map<number, string>();
  const styles: number[] = [];
  let date1904 = false;
  if (displayDates) {
    const styleBytes = entries.get("xl/styles.xml"), workbookBytes = entries.get("xl/workbook.xml");
    if (styleBytes) {
      const root = parseXml(new TextDecoder().decode(styleBytes));
      for (const node of root.children.find(node => node.localName === "numFmts")?.children ?? []) {
        formats.set(Number(node.attributes.find(attr => attr.localName === "numFmtId")?.value), node.attributes.find(attr => attr.localName === "formatCode")?.value ?? "");
      }
      for (const node of root.children.find(node => node.localName === "cellXfs")?.children ?? [])
        styles.push(Number(node.attributes.find(attr => attr.localName === "numFmtId")?.value ?? 0));
    }
    if (workbookBytes) date1904 = ["1", "true", "on"].includes(parseXml(new TextDecoder().decode(workbookBytes)).children.find(node => node.localName === "workbookPr")?.attributes.find(attr => attr.localName === "date1904")?.value ?? "");
  }
  const sharedStrings: string[] = [];
  const sstBytes = entries.get("xl/sharedStrings.xml");
  if (sstBytes) {
    const sstXml = new TextDecoder().decode(sstBytes);
    for (const si of sstXml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
      const parts = [...si[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) =>
        unescapeXml(t[1] ?? "")
      );
      sharedStrings.push(parts.join(""));
    }
  }

  const sheetBytes =
    entries.get("xl/worksheets/sheet1.xml") ??
    [...entries.entries()].find(([k]) => k.startsWith("xl/worksheets/sheet"))?.[1];
  if (!sheetBytes) return [];
  const sheetXml = new TextDecoder().decode(sheetBytes);

  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const rowCells: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const refMatch = /\br="([A-Z]+)\d+"/i.exec(attrs);
      if (refMatch?.[1]) {
        let targetCol = 0;
        for (const ch of refMatch[1].toUpperCase()) {
          targetCol = targetCol * 26 + (ch.charCodeAt(0) - 64);
        }
        targetCol -= 1;
        while (rowCells.length < targetCol) {
          rowCells.push("");
        }
      }
      if (cellMatch[2] === undefined) {
        rowCells.push("");
        continue;
      }
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const cellType = typeMatch?.[1] ?? "n";
      if (cellType === "inlineStr") {
        const tVal = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        rowCells.push(unescapeXml(tVal?.[1] ?? ""));
      } else {
        const vVal = /<v>([\s\S]*?)<\/v>/.exec(body);
        const raw = unescapeXml(vVal?.[1] ?? "");
        if (cellType === "s") {
          const idx = Number.parseInt(raw, 10);
          rowCells.push(sharedStrings[idx] ?? "");
        } else if (cellType === "b") {
          rowCells.push(raw === "1" || raw === "true" ? "TRUE" : "FALSE");
        } else {
          const style = displayDates && cellType === "n" ? Number(parseXml(`<c ${attrs}/>`).attributes.find(attr => attr.localName === "s")?.value ?? 0) : undefined;
          const format = style === undefined ? undefined : styles[style];
          rowCells.push(xlsxDateText(raw, format === undefined ? undefined : formats.get(format) ?? format, date1904));
        }
      }
    }
    if (rowCells.length > 0) rows.push(rowCells);
  }
  return rows;
}

interface SlideImagePlacement {
  readonly bytes: Uint8Array;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface SlideTextBoxPlacement {
  readonly paragraphs: string[];
  readonly x: number;
  readonly topY: number;
  readonly width: number;
  readonly fontSize: number;
}

interface SlideTablePlacement {
  readonly rows: string[][];
  readonly x: number;
  readonly topY: number;
  readonly width: number;
}

function wrapTextLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function* pptxElements(root: XmlElement, name: string): Generator<XmlElement> {
  const pending = [root];
  while (pending.length) {
    const element = pending.pop()!;
    if (element.localName === name) yield element;
    for (let index = element.children.length - 1; index >= 0; index--) pending.push(element.children[index]!);
  }
}
function pptxAttribute(element: XmlElement | undefined, name: string): string | undefined {
  return element?.attributes.find(attribute => attribute.name === name || name.includes(":") && attribute.prefix !== undefined && attribute.localName === name.slice(name.indexOf(":") + 1))?.value;
}
function pptxXml(bytes: Uint8Array): XmlElement {
  const text = new TextDecoder().decode(bytes);
  // Older generated slide fragments omit the namespace declarations and root.
  return parseXml(`<root xmlns:p="p" xmlns:a="a" xmlns:r="r" xmlns:n="n">${text.startsWith('<?xml') ? text.slice(text.indexOf('?>') + 2) : text}</root>`);
}
function parsePptxSlides(zipBytes: Uint8Array, pdf = false) {
  const entries = readZipArchiveEntries(zipBytes);
  const presentation = entries.get("ppt/presentation.xml");
  const root = presentation ? pptxXml(presentation) : undefined;
  const size = root ? [...pptxElements(root, "sldSz")][0] : undefined;
  const slideCx = Number(pptxAttribute(size, "cx") ?? 12192000);
  const slideCy = Number(pptxAttribute(size, "cy") ?? 6858000);
  if (!Number.isFinite(slideCx) || !Number.isFinite(slideCy) || slideCx <= 0 || slideCy <= 0) throw new Error("Invalid PPTX slide size");
  const relationships = (owner: string) => {
    const targets = new Map<string, string>();
    const slash = owner.lastIndexOf('/');
    const bytes = entries.get(owner.slice(0, slash + 1) + '_rels/' + owner.slice(slash + 1) + '.rels');
    if (bytes) for (const rel of pptxElements(pptxXml(bytes), 'Relationship')) {
      const id = pptxAttribute(rel, 'Id'), target = pptxAttribute(rel, 'Target');
      if (id && target && pptxAttribute(rel, 'TargetMode') !== 'External') targets.set(id, resolvePath('/' + owner.slice(0, slash), target).slice(1));
    }
    return targets;
  };
  const declared = root ? [...pptxElements(root, 'sldIdLst')][0] : undefined;
  const targets = relationships('ppt/presentation.xml');
  const slideKeys = declared ? [...pptxElements(declared, 'sldId')].map(slide => {
    const target = targets.get(pptxAttribute(slide, 'r:id') ?? '');
    if (!target || !entries.has(target)) throw new Error('Missing referenced PPTX slide');
    return target;
  }) : [...entries.keys()].filter(key => key.startsWith('ppt/slides/slide') && key.endsWith('.xml') && key.slice(16,-4).length > 0 && [...key.slice(16,-4)].every(char => char >= '0' && char <= '9')).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
  const slides: Array<{ title: string; bullets: string[]; images: SlideImagePlacement[]; textBoxes: SlideTextBoxPlacement[]; tables: SlideTablePlacement[]; pageWidth: number; pageHeight: number }> = [];
  for (const key of slideKeys) {
    const xml = new TextDecoder().decode(entries.get(key)!);
    const slideRoot = pptxXml(entries.get(key)!);
    const relTargets = relationships(key);
    const shapes: string[][] = [];
    const textBoxes: SlideTextBoxPlacement[] = [];
    let shapeIdx = 0;
    for (const sp of xml.matchAll(/<((?:[A-Za-z0-9_-]+:)?sp)\b[\s\S]*?<\/\1>/g)) {
      const paras: string[] = [];
      let maxSz = 1800;
      for (const p of sp[0].matchAll(/<((?:[A-Za-z0-9_-]+:)?p)\b[\s\S]*?<\/\1>/g)) {
        for (const szm of p[0].matchAll(/\bsz="(\d+)"/g)) {
          const val = Number.parseInt(szm[1]!, 10);
          if (val > 0) maxSz = val;
        }
        const runs = [...p[0].matchAll(/<((?:[A-Za-z0-9_-]+:)?t)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].map((t) =>
          unescapeXml(t[2] ?? "")
        );
        const line = runs.join("").trim();
        if (line) paras.push(line);
      }
      if (paras.length > 0) {
        shapes.push(paras);
        const offMatch = /<(?:[A-Za-z0-9_-]+:)?off\b[^>]*?\bx="(-?\d+)"[^>]*?\by="(-?\d+)"/.exec(sp[0]);
        const extMatch = /<(?:[A-Za-z0-9_-]+:)?ext\b[^>]*?\bcx="(\d+)"[^>]*?\bcy="(\d+)"/.exec(sp[0]);
        if (shapeIdx > 0 && offMatch) {
          const offX = Number.parseInt(offMatch[1]!, 10);
          const offY = Number.parseInt(offMatch[2]!, 10);
          const extCx = extMatch ? Number.parseInt(extMatch[1]!, 10) : Math.round(slideCx * 0.85);
          const x = Math.max(24, Math.min(660, (offX / slideCx) * 720));
          const width = Math.max(120, Math.min(720 - x - 24, (extCx / slideCx) * 720));
          const fontSize = Math.min(15, Math.max(10, Math.round((maxSz / 100) * 0.65)));
          const topY = Math.max(28, Math.min(330, 405 - (offY / slideCy) * 405 - fontSize));
          textBoxes.push({ paragraphs: paras, x, topY, width, fontSize });
        }
        shapeIdx++;
      }
    }

    const images: SlideImagePlacement[] = [];
    for (const pic of pptxElements(slideRoot, 'pic')) {
      const blip = [...pptxElements(pic, 'blip')][0];
      const target = relTargets.get(pptxAttribute(blip, 'r:embed') ?? '');
      const bytes = target ? entries.get(target) : undefined;
      if (!bytes) throw new Error('Missing referenced PPTX image');
      const off = [...pptxElements(pic, 'off')][0], ext = [...pptxElements(pic, 'ext')][0];
      const x = Number(pptxAttribute(off, 'x')) / 12700, top = Number(pptxAttribute(off, 'y')) / 12700;
      const width = Number(pptxAttribute(ext, 'cx')) / 12700, height = Number(pptxAttribute(ext, 'cy')) / 12700;
      if (![x, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Invalid PPTX picture placement');
      images.push({bytes, x, y: slideCy / 12700 - top - height, width, height});
    }

    const tables: SlideTablePlacement[] = [];
    const tableLines: string[] = [];
    for (const gf of xml.matchAll(/<((?:[A-Za-z0-9_-]+:)?graphicFrame)\b[\s\S]*?<\/\1>/g)) {
      const tblMatch = /<((?:[A-Za-z0-9_-]+:)?tbl)\b[\s\S]*?<\/\1>/.exec(gf[0]);
      if (!tblMatch) continue;
      const rows: string[][] = [];
      for (const tr of tblMatch[0].matchAll(/<((?:[A-Za-z0-9_-]+:)?tr)\b[\s\S]*?<\/\1>/g)) {
        const cells: string[] = [];
        for (const tc of tr[0].matchAll(/<((?:[A-Za-z0-9_-]+:)?tc)\b[\s\S]*?<\/\1>/g)) {
          const runs = [...tc[0].matchAll(/<((?:[A-Za-z0-9_-]+:)?t)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].map((t) =>
            unescapeXml(t[2] ?? "")
          );
          cells.push(runs.join("").trim());
        }
        if (cells.length > 0) {
          rows.push(cells);
          tableLines.push(cells.join("\t"));
        }
      }
      if (rows.length > 0) {
        const offMatch = /<(?:[A-Za-z0-9_-]+:)?off\b[^>]*?\bx="(-?\d+)"[^>]*?\by="(-?\d+)"/.exec(gf[0]);
        const extMatch = /<(?:[A-Za-z0-9_-]+:)?ext\b[^>]*?\bcx="(\d+)"[^>]*?\bcy="(\d+)"/.exec(gf[0]);
        const offX = offMatch ? Number.parseInt(offMatch[1]!, 10) : Math.round(slideCx * 0.08);
        const offY = offMatch ? Number.parseInt(offMatch[2]!, 10) : Math.round(slideCy * 0.22);
        const extCx = extMatch ? Number.parseInt(extMatch[1]!, 10) : Math.round(slideCx * 0.84);
        const x = Math.max(24, Math.min(640, (offX / slideCx) * 720));
        const width = Math.max(180, Math.min(720 - x - 24, (extCx / slideCx) * 720));
        const topY = Math.max(60, Math.min(325, 405 - (offY / slideCy) * 405));
        tables.push({ rows, x, topY, width });
      }
    }

    const title = shapes[0]?.[0] ?? (pdf ? "" : `Slide ${slides.length + 1}`);
    const bullets = [...(shapes[0]?.slice(1) ?? []), ...shapes.slice(1).flat(), ...tableLines];
    slides.push({ title, bullets, images, textBoxes, tables, pageWidth: slideCx / 12700, pageHeight: slideCy / 12700 });
  }
  return slides;
}

function* renderBlocksToPdf(blocks: readonly DocBlock[], title = "Document", {width = 612, height = 792} = {}): Generator<undefined, Uint8Array> {
  const doc = PdfDocument.create();
  doc.setTitle(title);
  doc.setCreator("LibreOffice 24.8 (@poe-code/pdf-ast)");

  let page = doc.addPage([width, height]);
  let y = height - 72;

  const ensureSpace = (needed: number) => {
    if (y - needed < 54) {
      page = doc.addPage([width, height]);
      y = height - 72;
    }
  };

  let work = 0;
  for (const block of blocks) {
    if (++work % 32 === 0) yield undefined;
    if (block.kind === "pageBreak" || block.kind === "pageBreakBefore") {
      if (block.kind === "pageBreak" || y !== height - 72) { page = doc.addPage([width, height]); y = height - 72; }
    } else if (block.kind === "heading" || block.kind === "paragraph") {
      const heading = block.kind === "heading", size = heading ? 18 : 11;
      const text = block.text ?? "", styles = block.styles ?? [];
      const lines = text.split("\n").flatMap(line => block.preformatted ? [line] : wrapTextLines(line, Math.max(1, Math.floor((width - 108) * (heading ? 48 : 84) / 504))));
      const color = heading ? rgb(0.1, 0.15, 0.28) : rgb(0.15, 0.15, 0.15);
      let offset = 0, styleIndex = 0;
      for (const line of lines) {
        ensureSpace(heading ? 26 : 16);
        let font = doc.embedStandardFont(heading ? "Helvetica-Bold" : block.preformatted ? "Courier" : "Helvetica");
        if (!styles.length) page.drawText(line, {x: 54, y, size, font, color});
        else {
          let x = 54;
          for (const [index, word] of line.split(" ").entries()) {
            if (index) { page.drawText(" ", {x, y, size, font, color}); x += font.widthOfTextAtSize(" ", size); }
            offset = text.indexOf(word, offset);
            const limit = offset + word.length;
            while (offset < limit) {
              while (styles[styleIndex] && styles[styleIndex]!.end <= offset) styleIndex++;
              const style = styles[styleIndex];
              const active = style && style.start <= offset ? style : undefined;
              const end = Math.min(limit, active ? active.end : style?.start ?? limit);
              const bold = heading || active?.bold, italic = active?.italic;
              font = doc.embedStandardFont(bold ? italic ? "Helvetica-BoldOblique" : "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica");
              const part = text.slice(offset, end);
              page.drawText(part, {x, y, size, font, color});
              x += font.widthOfTextAtSize(part, size);
              offset = end;
            }
          }
        }
        y -= heading ? 24 : 15;
      }
      y -= heading ? 4 : 5;
    } else if (block.kind === "table" && block.rows) {
      const colCount = Math.max(1, ...block.rows.map((r) => r.length));
      const tableWidth = Math.max(1, width - 108);
      const colWidth = tableWidth / colCount;
      const rowHeight = 22;

      for (let rIdx = 0; rIdx < block.rows.length; rIdx++) {
        if (++work % 32 === 0) yield undefined;
        const row = block.rows[rIdx]!;
        ensureSpace(rowHeight + 6);
        const rowTop = y;
        const rowBottom = y - rowHeight;
        if (rIdx === 0) {
          page.drawRect({
            x: 54,
            y: rowBottom,
            width: tableWidth,
            height: rowHeight,
            fill: rgb(0.92, 0.94, 0.97),
            stroke: rgb(0.5, 0.55, 0.62),
            strokeWidth: 0.75
          });
        } else {
          page.drawRect({
            x: 54,
            y: rowBottom,
            width: tableWidth,
            height: rowHeight,
            stroke: rgb(0.7, 0.72, 0.75),
            strokeWidth: 0.5
          });
        }
        row.forEach((cellText, cIdx) => {
          const cellX = 54 + cIdx * colWidth;
          if (cIdx > 0) {
            page.drawLine({
              x1: cellX,
              y1: rowBottom,
              x2: cellX,
              y2: rowTop,
              stroke: rgb(0.7, 0.72, 0.75),
              strokeWidth: 0.5
            });
          }
          page.drawText(cellText, {
            x: cellX + 6,
            y: rowBottom + 6,
            size: 10,
            font: rIdx === 0 ? "Helvetica-Bold" : "Helvetica"
          });
        });
        y -= rowHeight;
      }
      y -= 14;
    } else if (block.kind === "image" && block.imageBytes) {
      const b = block.imageBytes;
      const isPng = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
      const isJpg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
      if (!isPng && !isJpg) throw new Error("Unsupported DOCX image");
      if (isJpg) decodeJpegImage(b);
      const embedded = isPng ? doc.embedPng(b) : doc.embedJpg(b);
      const w = block.width ?? 400;
      const h = block.height ?? 210;
      ensureSpace(h + 12);
      page.drawImage(embedded, {
        x: 54,
        y: y - h,
        width: w,
        height: h
      });
      y -= h + 12;
    }
  }

  return doc.save();
}

function renderSlidesToPdf(slides: readonly { title: string; bullets: string[]; images?: readonly SlideImagePlacement[]; textBoxes?: readonly SlideTextBoxPlacement[]; tables?: readonly SlideTablePlacement[]; pageWidth: number; pageHeight: number }[]): Uint8Array {
  const doc = PdfDocument.create();
  doc.setCreator("LibreOffice Impress (@poe-code/pdf-ast)");

  for (const slide of slides) {
    const page = doc.addPage([slide.pageWidth, slide.pageHeight]);
    if (slide.title) page.drawText(slide.title, {x:40, y:slide.pageHeight - 40, size:22, font:"Helvetica-Bold"});
    for (const img of slide.images ?? []) {
      const isPng = img.bytes[0] === 0x89 && img.bytes[1] === 0x50;
      const isJpg = img.bytes[0] === 0xff && img.bytes[1] === 0xd8;
      if (!isPng && !isJpg) throw new Error("Unsupported PPTX image");
      if (isJpg) decodeJpegImage(img.bytes);
      const handle = isPng ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);
      page.drawImage(handle, { x: img.x, y: img.y, width: img.width, height: img.height });
    }
    let cursorY = 330;
    let prevBoxX: number | undefined;
    if (slide.textBoxes && slide.textBoxes.length > 0) {
      for (const box of slide.textBoxes) {
        let y = prevBoxX !== undefined && Math.abs(box.x - prevBoxX) < 40 ? Math.min(box.topY, cursorY) : box.topY;
        prevBoxX = box.x;
        const maxChars = Math.max(24, Math.floor(box.width / (box.fontSize * 0.52)));
        const lineHeight = Math.round(box.fontSize * 1.35);
        for (const para of box.paragraphs) {
          const lines = wrapTextLines(para, maxChars);
          lines.forEach((line, idx) => {
            if (y >= 14) {
              page.drawText(idx === 0 ? `- ${line}` : `  ${line}`, {
                x: box.x,
                y,
                size: box.fontSize,
                font: "Helvetica",
                color: rgb(0.18, 0.2, 0.24)
              });
              y -= lineHeight;
            }
          });
          y -= 4;
        }
        cursorY = y - 4;
      }
    } else if (!slide.tables || slide.tables.length === 0) {
      let y = 300;
      for (const bullet of slide.bullets) {
        const lines = wrapTextLines(bullet, 78);
        lines.forEach((line, idx) => {
          page.drawText(idx === 0 ? `- ${line}` : `  ${line}`, {
            x: 52,
            y,
            size: 14,
            font: "Helvetica",
            color: rgb(0.18, 0.2, 0.24)
          });
          y -= 20;
        });
        y -= 6;
      }
    }
    for (const tbl of slide.tables ?? []) {
      const colCount = Math.max(1, ...tbl.rows.map((r) => r.length));
      const colWidth = tbl.width / colCount;
      const rowHeight = 22;
      let rowTop = Math.min(tbl.topY, cursorY);
      for (let rIdx = 0; rIdx < tbl.rows.length; rIdx++) {
        const row = tbl.rows[rIdx]!;
        const rowBottom = rowTop - rowHeight;
        if (rowBottom < 14) break;
        if (rIdx === 0) {
          page.drawRect({
            x: tbl.x,
            y: rowBottom,
            width: tbl.width,
            height: rowHeight,
            fill: rgb(0.92, 0.94, 0.97),
            stroke: rgb(0.5, 0.55, 0.62),
            strokeWidth: 0.75
          });
        } else {
          page.drawRect({
            x: tbl.x,
            y: rowBottom,
            width: tbl.width,
            height: rowHeight,
            stroke: rgb(0.7, 0.72, 0.75),
            strokeWidth: 0.5
          });
        }
        row.forEach((cellText, cIdx) => {
          const cellX = tbl.x + cIdx * colWidth;
          if (cIdx > 0) {
            page.drawLine({
              x1: cellX,
              y1: rowBottom,
              x2: cellX,
              y2: rowTop,
              stroke: rgb(0.7, 0.72, 0.75),
              strokeWidth: 0.5
            });
          }
          page.drawText(cellText, {
            x: cellX + 6,
            y: rowBottom + 6,
            size: 10,
            font: rIdx === 0 ? "Helvetica-Bold" : "Helvetica",
            color: rgb(0.15, 0.15, 0.15)
          });
        });
        rowTop -= rowHeight;
      }
      cursorY = rowTop - 8;
    }
  }

  return doc.save();
}

function formatStarCalcCsv(rows: readonly string[][], filterOptions?: string): Uint8Array {
  const { separator: sep, quote, quoteAll } = starCalcCsvOptions(filterOptions);

  const lines = rows.map((row) =>
    row
      .map((cell) => {
        const mustQuote =
          quoteAll ||
          cell.includes(sep) ||
          cell.includes(quote) ||
          cell.includes("\n") ||
          cell.includes("\r");
        if (!mustQuote) return cell;
        const escaped = cell.split(quote).join(quote + quote);
        return `${quote}${escaped}${quote}`;
      })
      .join(sep)
  );
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

function renderBlocksToText(blocks: readonly DocBlock[], separator = "\n\n"): Uint8Array {
  const lines = blocks.map(block => block.kind === "table"
    ? (block.rows ?? []).map(row => row.join("\t")).join("\n")
    : block.text ?? "");
  return new TextEncoder().encode(lines.join(separator) + "\n");
}

function renderBlocksToHtml(blocks: readonly DocBlock[], title = "Document"): Uint8Array {
  let html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtmlText(title)}</title></head><body>\n`;
  for (const b of blocks) {
    if (b.kind === "heading") {
      html += `<h1>${escapeHtmlText(b.text ?? "")}</h1>\n`;
    } else if (b.kind === "paragraph") {
      const tag = b.preformatted ? "pre" : "p";
      html += `<${tag}>${escapeHtmlText(b.text ?? "")}</${tag}>\n`;
    } else if (b.kind === "table" && b.rows) {
      html += "<table>\n";
      for (const r of b.rows) {
        html += `  <tr>${r.map((c) => `<td>${escapeHtmlText(c)}</td>`).join("")}</tr>\n`;
      }
      html += "</table>\n";
    }
  }
  html += "</body></html>\n";
  return new TextEncoder().encode(html);
}

function parseOdtBlocks(zipBytes: Uint8Array): DocBlock[] {
  const entries = readZipArchiveEntries(zipBytes);
  const contentXml = entries.get("content.xml");
  if (!contentXml) return [{ kind: "paragraph", text: "" }];
  const xml = new TextDecoder().decode(contentXml);
  const blocks: DocBlock[] = [];
  const stripTags = (s: string) => unescapeXml(s.replace(/<[^>]+>/g, "").trim());
  const tokenRegex = /<(text:h|text:p|table:table)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(xml)) !== null) {
    const tag = m[1]!;
    const inner = m[2]!;
    if (tag === "text:h") {
      const t = stripTags(inner);
      if (t) blocks.push({ kind: "heading", text: t });
    } else if (tag === "text:p") {
      const t = stripTags(inner);
      if (t) blocks.push({ kind: "paragraph", text: t });
    } else if (tag === "table:table") {
      const rows: string[][] = [];
      const rowRe = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(inner)) !== null) {
        const cells: string[] = [];
        const cellRe = /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g;
        let cm: RegExpExecArray | null;
        while ((cm = cellRe.exec(rm[1]!)) !== null) {
          cells.push(stripTags(cm[1]!));
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) blocks.push({ kind: "table", rows });
    }
  }
  return blocks.length > 0 ? blocks : [{ kind: "paragraph", text: stripTags(xml) }];
}

function parseRtfBlocks(rtfBytes: Uint8Array): DocBlock[] {
  const groups: number[] = [], steps = rtfTextSteps(rtfBytes.length);
  let cleaned = "", next = steps.next();
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") next = steps.next(rtfBytes[step.position]);
    else if (step.kind === "group-read") next = steps.next(groups[step.index]);
    else {
      if (step.kind === "group-write") groups[step.index] = step.value;
      else cleaned += step.value;
      next = steps.next();
    }
  }
  const lines = cleaned.split("\n").map(line => line.trim()).filter(line => line.length > 0);
  return lines.map((line, idx) =>
    idx === 0 ? { kind: "heading", text: line } : { kind: "paragraph", text: line }
  );
}

function buildDocxFromBlocks(blocks: readonly DocBlock[]): Uint8Array {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bodyParts: string[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") {
      bodyParts.push(
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(b.text ?? "")}</w:t></w:r></w:p>`
      );
    } else if (b.kind === "table" && b.rows) {
      const trs = b.rows
        .map(
          (r) =>
            `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`
        )
        .join("");
      bodyParts.push(`<w:tbl>${trs}</w:tbl>`);
    } else {
      bodyParts.push(`<w:p><w:r><w:t>${esc(b.text ?? "")}</w:t></w:r></w:p>`);
    }
  }
  const enc = new TextEncoder();
  return createStoredZipArchive({
    ...Object.fromEntries(Object.entries(docxMetadata).map(([name, text]) => [name, enc.encode(text)])),
    "word/document.xml": enc.encode(docxDocumentPrefix + bodyParts.join("") + docxDocumentSuffix)
  });
}

function buildXlsxFromRows(rows: readonly (readonly string[])[], inferDates = false, numericCells?: ReadonlySet<string>): Uint8Array {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let formulas: Map<string, string> | undefined;
  if (inferDates && rows.some(row => row.some(text => text.startsWith("=")))) {
    const calculation = calculateCsvFormulas(rows.flatMap((row, r) => row.map((text, c) =>
      csvFormulaCell(r, c, text, numericCells?.has(`${r}:${c}`) ?? false))), new AbortController().signal);
    let step = calculation.next();
    while (!step.done) step = calculation.next();
    formulas = step.value;
  }
  const sheetRows = rows
    .map((row, rIdx) => {
      const cells = row
        .map((val, cIdx) => {
          let colLetter = "";
          for (let column = cIdx + 1; column > 0; column = Math.floor((column - 1) / 26)) {
            colLetter = String.fromCharCode(65 + (column - 1) % 26) + colLetter;
          }
          const formula = formulas?.get(`${rIdx}:${cIdx}`);
          if (formula !== undefined) return `<c r="${colLetter}${rIdx + 1}" ${formula}`;
          const serial = inferDates ? xlsxDateSerial(val) : undefined;
          if (serial !== undefined) return `<c r="${colLetter}${rIdx + 1}" s="1" t="n"><v>${serial}</v></c>`;
          if (numericCells?.has(`${rIdx}:${cIdx}`)) return `<c r="${colLetter}${rIdx + 1}" t="n"><v>${val}</v></c>`;
          return `<c r="${colLetter}${rIdx + 1}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rIdx + 1}">${cells}</row>`;
    })
    .join("");
  const enc = new TextEncoder();
  return createStoredZipArchive({
    ...Object.fromEntries(Object.entries(xlsxMetadata).map(([name, text]) => [name, enc.encode(text)])),
    "xl/worksheets/sheet1.xml": enc.encode(xlsxDocumentPrefix + sheetRows + xlsxDocumentSuffix)
  });
}

function parseDelimitedRows(text: string, separator = ",", numericCells?: Set<string>): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false, wasQuoted = false;
  const cell = () => {
    if (!wasQuoted && isCsvNumber(field)) numericCells?.add(`${rows.length}:${row.length}`);
    row.push(field); field = ""; wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field.length === 0) {
        quoted = !quoted; wasQuoted = true;
      } else {
        field += char;
      }
    } else if (!quoted && char === separator) {
      cell();
    } else if (!quoted && (char === "\r" || char === "\n")) {
      cell();
      rows.push(row);
      row = [];
      field = "";
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Invalid CSV: unterminated quoted field");
  if (text.length > 0 && (field.length > 0 || row.length > 0 || !["\r", "\n"].includes(text.at(-1)!))) {
    cell();
    rows.push(row);
  }
  return rows;
}

interface SofficeArguments {
  readonly convertSpec: string | undefined;
  readonly catMode: boolean;
  readonly outdir: string;
  readonly inputs: readonly string[];
}

function parseSofficeArguments(argv: readonly string[], cwd: string): SofficeArguments | SofficeCliResult {
  let convertSpec: string | undefined;
  let catMode = false;
  let outdir = cwd;
  const inputs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      inputs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return {
        exitCode: 0,
        stdout: "LibreOffice 24.8 (@poe-code/pdf-ast)\nUsage: soffice --headless --convert-to <format> [--outdir <dir>] <files...>\n",
        stderr: ""
      };
    }
    if (arg === "--version") {
      return {
        exitCode: 0,
        stdout: "LibreOffice 24.8.0.0 (@poe-code/pdf-ast)\n",
        stderr: ""
      };
    }
    if (arg === "--cat" || arg === "-cat") {
      catMode = true;
      continue;
    }
    const option = arg.startsWith("--") ? arg.slice(2) : arg.startsWith("-") ? arg.slice(1) : "";
    const equals = option.indexOf("=");
    const name = equals < 0 ? option : option.slice(0, equals);
    if (["convert-to", "outdir", "infilter", "pidfile", "language"].includes(name)) {
      const value = equals < 0 ? argv[++i] : option.slice(equals + 1);
      if (!value || (equals < 0 && value.startsWith("-"))) {
        return { exitCode: 1, stdout: "", stderr: `Error: ${arg} requires a value\n` };
      }
      if (name === "convert-to") convertSpec = value;
      if (name === "outdir") outdir = value;
    } else if (arg.startsWith("-")) {
      continue;
    } else {
      inputs.push(arg);
    }
  }

  return { convertSpec, catMode, outdir, inputs };
}

function* runSofficeSteps(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  cwd: string,
  signal: AbortSignal
): Generator<undefined | (() => Promise<Uint8Array>), SofficeCliResult, Uint8Array | undefined> {
  try {
    const parsed = parseSofficeArguments(argv, cwd);
    if ("exitCode" in parsed) return parsed;
    const { convertSpec, catMode, outdir, inputs } = parsed;

    if (catMode && !convertSpec && inputs.length > 0) {
      const chunks: string[] = [];
      for (const inputPath of inputs) {
      yield undefined;
      signal.throwIfAborted();
        const bytes = files.get(inputPath) ?? files.get(resolvePath(cwd, inputPath));
        if (!bytes) {
          return { exitCode: 1, stdout: "", stderr: `Error: source file could not be loaded: ${inputPath}\n` };
        }
        const lower = inputPath.toLowerCase();
        if (lower.endsWith(".pdf")) {
          chunks.push(PdfDocument.load(bytes).extractText());
        } else if (lower.endsWith(".docx")) {
          chunks.push("\uFEFF" + parseDocxBlocks(bytes, false).blocks.map((b) => b.text ?? (b.rows?.map((r) => r.join("\t")).join("\n") ?? "")).join("\n"));
        } else if ([".odt", ".ods", ".odp"].some(ext => lower.endsWith(ext))) {
          chunks.push(parseOdtBlocks(bytes).map((b) => b.text ?? (b.rows?.map((r) => r.join("\t")).join("\n") ?? "")).join("\n"));
        } else if (lower.endsWith(".xlsx")) {
          chunks.push(parseXlsxRows(bytes).map(row => row.join("\t")).join("\n"));
        } else if (lower.endsWith(".pptx")) {
          chunks.push(parsePptxSlides(bytes).map(slide => [slide.title, ...slide.bullets].join("\n")).join("\n\n"));
        } else if (lower.endsWith(".html") || lower.endsWith(".htm")) {
          chunks.push(parseHtmlBlocks(new TextDecoder().decode(bytes)).map((b) => b.text ?? (b.rows?.map((r) => r.join("\t")).join("\n") ?? "")).join("\n"));
        } else if (lower.endsWith(".rtf")) {
          chunks.push(parseRtfBlocks(bytes).map((b) => b.text ?? "").join("\n"));
        } else {
          chunks.push(new TextDecoder().decode(bytes));
        }
      }
      return { exitCode: 0, stdout: chunks.join("\n") + "\n", stderr: "" };
    }

    if (!convertSpec || inputs.length === 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Error: --convert-to and at least one input file are required\n"
      };
    }

    const firstColon = convertSpec.indexOf(":");
    const secondColon = firstColon >= 0 ? convertSpec.indexOf(":", firstColon + 1) : -1;
    const targetExtRaw = firstColon >= 0 ? convertSpec.slice(0, firstColon) : convertSpec;
    const filterNameRaw =
      firstColon >= 0
        ? secondColon >= 0
          ? convertSpec.slice(firstColon + 1, secondColon)
          : convertSpec.slice(firstColon + 1)
        : undefined;
    const filterOpts = secondColon >= 0 ? convertSpec.slice(secondColon + 1) : undefined;
    const targetExt = (targetExtRaw ?? "pdf").toLowerCase();
    let stdout = "";

    for (const inputPath of inputs) {
      yield undefined;
      signal.throwIfAborted();
      const inputBytes = files.get(inputPath) ?? files.get(resolvePath(cwd, inputPath));
      if (!inputBytes) {
        return {
          exitCode: 1,
          stdout,
          stderr: `Error: source file could not be loaded: ${inputPath}\n`
        };
      }

      const baseName = inputPath.split("/").pop() ?? "document";
      const stem = baseName.replace(/\.[^.]+$/, "");
      const lowerIn = baseName.toLowerCase();
      const outPath = resolvePath(cwd, outdir, `${stem}.${targetExt}`);

      const defaultFilter =
        targetExt === "pdf"
          ? [".xlsx", ".csv", ".ods"].some(ext => lowerIn.endsWith(ext))
            ? "calc_pdf_Export"
            : [".pptx", ".odp"].some(ext => lowerIn.endsWith(ext))
              ? "impress_pdf_Export"
              : "writer_pdf_Export"
          : targetExt === "csv"
            ? "Text - txt - csv (StarCalc)"
            : `${targetExt}_Export`;
      const filterName = filterNameRaw || defaultFilter;

      let outBytes: Uint8Array;

      if (lowerIn.endsWith(".ods") && (targetExt === "csv" || targetExt === "xlsx")) {
        outBytes = (yield () => convertOds(inputBytes, targetExt, filterOpts, signal))!;
      } else if ([".docx", ".odt", ".ods", ".odp", ".rtf"].some(ext => lowerIn.endsWith(ext))) {
        const docx = lowerIn.endsWith(".docx") ? parseDocxBlocks(inputBytes, targetExt === "pdf") : undefined;
        const blocks = docx
          ? docx.blocks
          : [".odt", ".ods", ".odp"].some(ext => lowerIn.endsWith(ext))
            ? parseOdtBlocks(inputBytes)
            : parseRtfBlocks(inputBytes);
        if (targetExt === "pdf") {
          outBytes = yield* renderBlocksToPdf(blocks, stem, docx);
        } else if (targetExt === "html") {
          outBytes = renderBlocksToHtml(blocks, stem);
        } else if (targetExt === "docx") {
          outBytes = buildDocxFromBlocks(blocks);
        } else {
          outBytes = renderBlocksToText(blocks, lowerIn.endsWith(".docx") && targetExt === "txt" ? "\n" : "\n\n");
          if (lowerIn.endsWith(".docx") && targetExt === "txt") {
            const encoded = new Uint8Array(outBytes.length + 3);
            encoded.set([0xef, 0xbb, 0xbf]);
            encoded.set(outBytes, 3);
            outBytes = encoded;
          }
        }
      } else if (lowerIn.endsWith(".xlsx") || lowerIn.endsWith(".csv")) {
        const numericCells = targetExt === "xlsx" && lowerIn.endsWith(".csv") ? new Set<string>() : undefined;
        const rows = lowerIn.endsWith(".xlsx")
          ? parseXlsxRows(inputBytes, targetExt === "csv" || targetExt === "html")
          : parseDelimitedRows(new TextDecoder().decode(inputBytes), ",", numericCells);
        if (targetExt === "csv") {
          outBytes = formatStarCalcCsv(rows, filterOpts);
        } else if (targetExt === "xlsx") {
          outBytes = buildXlsxFromRows(rows, lowerIn.endsWith(".csv"), numericCells);
        } else if (targetExt === "docx") {
          outBytes = buildDocxFromBlocks([{ kind: "table", rows }]);
        } else if (targetExt === "html") {
          outBytes = renderBlocksToHtml([{ kind: "table", rows }], stem);
        } else if (targetExt === "pdf") {
          outBytes = yield* renderBlocksToPdf([{ kind: "table", rows }], stem);
        } else {
          outBytes = new TextEncoder().encode(rows.map(row => row.join("\t")).join("\n") + "\n");
        }
      } else if (lowerIn.endsWith(".pptx")) {
        const slides = parsePptxSlides(inputBytes, targetExt === "pdf");
        if (targetExt === "pdf") {
          outBytes = renderSlidesToPdf(slides);
        } else if (targetExt === "html" || targetExt === "docx") {
          const blocks = slides.flatMap<DocBlock>(slide => [
            { kind: "heading", text: slide.title },
            ...slide.bullets.map((text): DocBlock => ({ kind: "paragraph", text }))
          ]);
          outBytes = targetExt === "html" ? renderBlocksToHtml(blocks, stem) : buildDocxFromBlocks(blocks);
        } else {
          const txt = slides.map((s) => `${s.title}\n${s.bullets.join("\n")}`).join("\n\n");
          outBytes = new TextEncoder().encode(txt + "\n");
        }
      } else if (lowerIn.endsWith(".pdf")) {
        const doc = PdfDocument.load(inputBytes);
        const extracted = doc.extractText();
        const tables = doc.extractTables();
        const sem = doc.toSemanticAst();
        const pdfBlocks: DocBlock[] = sem.map((node) => {
          if (node.kind === "heading") return { kind: "heading", text: node.text };
          if (node.kind === "table") {
            return {
              kind: "table",
              rows: [[...node.headers], ...node.rows.map((r) => [...r])]
            };
          }
          if (node.kind === "list") return { kind: "paragraph", text: node.items.join("\n") };
          return { kind: "paragraph", text: "text" in node ? node.text : "" };
        });
        if (pdfBlocks.length === 0 && extracted.trim()) {
          pdfBlocks.push({ kind: "paragraph", text: extracted.trim() });
        }
        if (targetExt === "html") {
          outBytes = renderBlocksToHtml(pdfBlocks, stem);
        } else if (targetExt === "docx") {
          outBytes = buildDocxFromBlocks(pdfBlocks);
        } else if (targetExt === "xlsx") {
          const rows = tables[0]
            ? [[...tables[0].headers], ...tables[0].rows.map((r) => [...r])]
            : extracted.trim().split(/\r?\n/).map((l) => l.split(/\s{2,}|\t/));
          outBytes = buildXlsxFromRows(rows);
        } else if (targetExt === "csv") {
          const rows = tables[0]
            ? [[...tables[0].headers], ...tables[0].rows.map((r) => [...r])]
            : extracted.trim().split(/\r?\n/).map((l) => l.split(/\s{2,}|\t/));
          outBytes = formatStarCalcCsv(rows, filterOpts);
        } else if (targetExt === "png") {
          outBytes = doc.getPage(0).renderToPng();
        } else if (targetExt === "pdf") {
          outBytes = doc.save();
        } else {
          outBytes = new TextEncoder().encode(extracted + "\n");
        }
      } else {
        // Plain text / Markdown / HTML input uses the selected document writer.
        const rawText = new TextDecoder().decode(inputBytes);
        const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const isHtml = lowerIn.endsWith(".html") || lowerIn.endsWith(".htm");
        const blocks: DocBlock[] = isHtml ? parseHtmlBlocks(rawText) : lines.map((l) =>
          l.startsWith("# ")
            ? { kind: "heading", text: l.slice(2).trim() }
            : { kind: "paragraph", text: l }
        );
        if (targetExt === "pdf") outBytes = yield* renderBlocksToPdf(blocks, stem);
        else if (targetExt === "docx") outBytes = buildDocxFromBlocks(blocks);
        else if (targetExt === "html") outBytes = renderBlocksToHtml(blocks, stem);
        else if (targetExt === "xlsx" || targetExt === "csv") {
          const tableRows = isHtml
            ? blocks.filter(block => block.kind === "table").flatMap(block => block.rows ?? [])
            : lowerIn.endsWith(".md") ? parseMarkdownTableRows(rawText) : [];
          const rows = tableRows.length > 0 ? tableRows
            : isHtml ? blocks.map(block => [block.text ?? ""])
            : parseDelimitedRows(rawText, rawText.includes("\t") ? "\t" : ",");
          outBytes = targetExt === "xlsx" ? buildXlsxFromRows(rows) : formatStarCalcCsv(rows, filterOpts);
        } else outBytes = isHtml || lowerIn.endsWith(".md") ? renderBlocksToText(blocks, isHtml && targetExt === "txt" ? "\n" : "\n\n") : inputBytes;
      }

      if (targetExt === "txt" && filterNameRaw === "Text" &&
        ![".pdf", ".xlsx", ".csv", ".ods", ".pptx", ".odp"].some(ext => lowerIn.endsWith(ext)) &&
        !(outBytes[0] === 0xef && outBytes[1] === 0xbb && outBytes[2] === 0xbf)) {
        const encoded = new Uint8Array(outBytes.length + 3);
        encoded.set([0xef, 0xbb, 0xbf]);
        encoded.set(outBytes, 3);
        outBytes = encoded;
      }

      if (targetExt === "pdf" && filterOpts && filterOpts.trim().startsWith("{")) {
        try {
          const parsedFilter = JSON.parse(filterOpts) as Record<string, { value?: unknown } | unknown>;
          const unwrap = (k: string) => {
            const v = parsedFilter[k];
            return v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v;
          };
          let pdfDoc = PdfDocument.load(outBytes);
          const pageRangeVal = unwrap("PageRange");
          if (typeof pageRangeVal === "string" && pageRangeVal.trim().length > 0) {
            const [startStr, endStr] = pageRangeVal.trim().split("-");
            const startPage = Math.max(1, Number(startStr) || 1);
            const endPage = Math.min(pdfDoc.pageCount, Number(endStr ?? startStr) || startPage);
            const indices: number[] = [];
            for (let p = startPage; p <= endPage; p++) indices.push(p - 1);
            if (indices.length > 0 && indices.length < pdfDoc.pageCount) {
              const filteredDoc = PdfDocument.create();
              filteredDoc.copyPagesFrom(pdfDoc, indices);
              pdfDoc = filteredDoc;
            }
          }
          const verVal = unwrap("SelectPdfVersion");
          if (typeof verVal === "number") {
            if (verVal === 15) pdfDoc.setVersion("1.5");
            else if (verVal === 16) pdfDoc.setVersion("1.6");
            else if (verVal === 17) pdfDoc.setVersion("1.7");
            else if (verVal === 20) pdfDoc.setVersion("2.0");
          }
          outBytes = pdfDoc.save();
        } catch {
          // Ignore invalid JSON FilterData per LibreOffice fallback profile
        }
      }

      signal.throwIfAborted();
      files.set(outPath, outBytes);
      stdout += `convert ${inputPath} -> ${outPath} using filter : ${filterName}\n`;
    }

    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: `Error: conversion failed: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}

export function runSofficeCliSync(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  cwd = "/"
): SofficeCliResult {
  const steps = runSofficeSteps(argv, files, cwd, new AbortController().signal);
  let step = steps.next();
  while (!step.done && step.value === undefined) step = steps.next();
  if (step.done) return step.value;
  const result: SofficeCliResult = { exitCode: 1, stdout: "", stderr: "Error: this spreadsheet conversion requires the asynchronous runSofficeCli API\n" };
  steps.return(result);
  return result;
}

export async function runSofficeCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  cwd = "/",
  options: { readonly signal?: AbortSignal } = {}
): Promise<SofficeCliResult> {
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const parsed = parseSofficeArguments(argv, cwd);
  if (!("exitCode" in parsed) && parsed.inputs.length && parsed.inputs.some(input => input.toLowerCase().endsWith(".docx")) &&
      (parsed.convertSpec || parsed.inputs.every(input => input.toLowerCase().endsWith(".docx")))) {
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) {
      const absolute = resolvePath(cwd, path);
      await fs.mkdir(absolute.slice(0, absolute.lastIndexOf("/")) || "/", { recursive: true });
      await fs.writeFile(absolute, bytes);
    }
    await fs.mkdir(resolvePath(cwd), { recursive: true });
    let stdout = "", stderr = "";
    const context = { fs, cwd, env: {}, signal,
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } } };
    const result = parsed.catMode && !parsed.convertSpec
      ? await catRetainedText(parsed.inputs, context, context.stdout, resolveLimits({}), () => {})
      : await tryRetainedTextConversion(parsed, context, resolveLimits({}), () => {});
    if (result) {
      if (parsed.convertSpec) {
        const format = parsed.convertSpec.split(":")[0]!.toLowerCase();
        for (const input of parsed.inputs) {
          const basename = input.split("/").at(-1)!, dot = basename.lastIndexOf(".");
          const path = resolvePath(cwd, parsed.outdir, `${dot >= 0 && dot < basename.length - 1 ? basename.slice(0, dot) : basename}.${format}`);
          if (await fs.stat(path).catch(() => undefined)) files.set(path, await fs.readFile(path));
        }
      }
      return { exitCode: result.exitCode, stdout, stderr: "stderr" in result ? result.stderr : stderr };
    }
  }
  const steps = runSofficeSteps(argv, files, cwd, signal);
  try {
    let step = steps.next();
    while (!step.done) {
      try {
        await yieldTurn(signal);
        signal.throwIfAborted();
        step = steps.next(step.value ? await step.value() : undefined);
      } catch (error) { step = steps.throw(error); }
    }
    signal.throwIfAborted();
    return step.value;
  } finally { steps.return({ exitCode: 1, stdout: "", stderr: "" }); }
}

export interface SofficeFileOptions {
  readonly filesystem: FileSystem;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  readonly limits?: Partial<SofficeLimits>;
  readonly inputBudget?: { check(bytes: number): void };
  readonly registerCleanup?: NonNullable<CommandContext["registerCleanup"]>;
}

/** File SDK and shell entrypoint share the supplied filesystem and output lifetime. */
export async function runSofficeFileCli(argv: readonly string[], options: SofficeFileOptions): Promise<{ exitCode: number }> {
  const context = { ...options, fs: options.filesystem, cwd: options.cwd ?? "/", env: options.env ?? {}, signal: options.signal ?? new AbortController().signal };
  const limits = resolveLimits(options);
  let outputBytes = 0;
  const chargeOutput = (bytes: number) => {
    outputBytes += bytes;
    if (outputBytes > limits.maxOutputBytes) throw new RangeError("Output byte limit exceeded");
  };
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const argumentBytes = argv.reduce((total, arg) => total + new TextEncoder().encode(arg).byteLength + 1, 0);
    if (argumentBytes > limits.maxArgumentBytes) throw new RangeError("Argument byte limit exceeded");

    const vfsFiles = new Map<string, Uint8Array>();
    const parsed = parseSofficeArguments(argv, context.cwd);
    const structured = [".pdf", ".html", ".htm"];
    if ((context.fs.readStream || context.fs.openReadFile) && !("exitCode" in parsed) && parsed.catMode && !parsed.convertSpec && parsed.inputs.length &&
        parsed.inputs.every(path => !structured.some(extension => path.toLowerCase().endsWith(extension)))) {
      const stdout = invocation.child(context.stdout);
      const result = await catRetainedText(parsed.inputs, { ...context, signal: invocation.signal }, stdout.output, limits, chargeOutput);
      if (result.stderr) await writeBytes(context.stderr, new TextEncoder().encode(result.stderr), invocation.signal);
      return { exitCode: result.exitCode };
    }
    if (!("exitCode" in parsed)) {
      const stdout = invocation.child(context.stdout);
      const retained = await tryRetainedTextConversion(parsed, { ...context, signal: invocation.signal, stdout: stdout.output }, limits, chargeOutput);
      if (retained) return retained;
    }
    let inputBytes = 0;
    for (const token of "exitCode" in parsed ? [] : parsed.inputs) {
      const abs = resolvePath(context.cwd, token);
      if (vfsFiles.has(abs)) continue;
      let bytes: Uint8Array;
      try {
        bytes = await context.fs.readFile(abs, { signal: invocation.signal });
      } catch {
        invocation.signal.throwIfAborted();
        // The runner reports unreadable source operands consistently for both APIs.
        continue;
      }
      inputBytes += bytes.byteLength;
      context.inputBudget?.check(inputBytes);
      if (inputBytes > limits.maxInputBytes) throw new RangeError("Input byte limit exceeded");
      vfsFiles.set(abs, bytes);
    }

    const existingSnap = new Map(vfsFiles);
    const res = await runSofficeCli(argv, vfsFiles, context.cwd, { signal: invocation.signal });

    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdout) {
      chargeOutput(new TextEncoder().encode(res.stdout).byteLength);
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }

    for (const [fileKey, fileBytes] of vfsFiles.entries()) {
      if (existingSnap.get(fileKey) !== fileBytes) {
        chargeOutput(fileBytes.byteLength);
        const abs = resolvePath(context.cwd, fileKey);
        const parentDir = abs.slice(0, abs.lastIndexOf("/")) || "/";
        try {
          await context.fs.mkdir(parentDir, { recursive: true, signal: invocation.signal });
        } catch {
          // Directory may already exist
        }
        await writeFileOutput(context, fileBytes, data => context.fs.writeFile(abs, data, { signal: invocation.signal }));
      }
    }

    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
    if (typeof (globalThis as { gc?: () => void }).gc === "function") {
      try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Optional collection must not mask command results. */ }
    }
  }
}

export async function soffice(context: CommandContext, options: SofficeCommandOptions = {}): Promise<{ exitCode: number }> {
  return runSofficeFileCli(getCommandArguments(context).args, {
    filesystem: context.fs, cwd: context.cwd, env: context.env, signal: context.signal,
    stdout: context.stdout, stderr: context.stderr,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(context.inputBudget ? { inputBudget: context.inputBudget } : {}),
    ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {})
  });
}

export function createSofficeCommand(options: SofficeCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "soffice",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Headless document/spreadsheet/presentation to PDF and CSV converter via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return soffice(context, options);
    }
  });
}

export const sofficeCommand: CommandDefinition = createSofficeCommand();

export function createLibreofficeCommand(options: SofficeCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "libreoffice",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Headless LibreOffice document/spreadsheet/presentation to PDF converter via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return soffice(context, options);
    }
  });
}

export const libreofficeCommand: CommandDefinition = createLibreofficeCommand();

export function sofficeCommands(options: SofficeCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSofficeCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "soffice",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}

export type SofficeCommandsOptions = SofficeCommandOptions;

export function createSofficeCommands(options: SofficeCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createSofficeCommand(options), createLibreofficeCommand(options)]);
}
