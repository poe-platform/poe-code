import { parseHtmlBlocks, type DocBlock } from "./html.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { resolvePath } from "@poe-code/safe-fs/core";
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

function parseDocxBlocks(zipBytes: Uint8Array): DocBlock[] {
  const entries = readZipArchiveEntries(zipBytes);
  const docXmlBytes = entries.get("word/document.xml");
  if (!docXmlBytes) return [];
  const xml = new TextDecoder()
    .decode(docXmlBytes)
    .replace(/<w:tab\b[^/>]*\/>/g, "<w:t>\t</w:t>")
    .replace(/<w:(?:br|cr)\b[^/>]*\/>/g, "<w:t> </w:t>");

  const blocks: DocBlock[] = [];
  const tokenRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tbl")) {
      const rows: string[][] = [];
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(chunk)) !== null) {
        const cells: string[] = [];
        const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        let cm: RegExpExecArray | null;
        while ((cm = cellRe.exec(rm[0])) !== null) {
          const texts = [...cm[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) =>
            unescapeXml(t[1] ?? "")
          );
          cells.push(texts.join("").trim());
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) blocks.push({ kind: "table", rows });
    } else {
      const isHeading = /w:pStyle\s+w:val="Heading/i.test(chunk);
      const texts = [...chunk.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) =>
        unescapeXml(t[1] ?? "")
      );
      const line = texts.join("").trim();
      if (line.length > 0) {
        blocks.push({ kind: isHeading ? "heading" : "paragraph", text: line });
      }
    }
  }
  return blocks;
}

function parseXlsxRows(zipBytes: Uint8Array): string[][] {
  const entries = readZipArchiveEntries(zipBytes);
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
        } else {
          rowCells.push(raw);
        }
      }
    }
    if (rowCells.length > 0) rows.push(rowCells);
  }
  return rows;
}

function parsePptxSlides(zipBytes: Uint8Array): Array<{ title: string; bullets: string[] }> {
  const entries = readZipArchiveEntries(zipBytes);
  const slideKeys = [...entries.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const slides: Array<{ title: string; bullets: string[] }> = [];
  for (const key of slideKeys) {
    const xml = new TextDecoder().decode(entries.get(key)!);
    const shapes: string[][] = [];
    for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const paras: string[] = [];
      for (const p of sp[0].matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
        const runs = [...p[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) =>
          unescapeXml(t[1] ?? "")
        );
        const line = runs.join("").trim();
        if (line) paras.push(line);
      }
      if (paras.length > 0) shapes.push(paras);
    }
    const title = shapes[0]?.[0] ?? `Slide ${slides.length + 1}`;
    const bullets = [...(shapes[0]?.slice(1) ?? []), ...shapes.slice(1).flat()];
    slides.push({ title, bullets });
  }
  return slides;
}

function* renderBlocksToPdf(blocks: readonly DocBlock[], title = "Document"): Generator<undefined, Uint8Array> {
  const doc = PdfDocument.create();
  doc.setTitle(title);
  doc.setCreator("LibreOffice 24.8 (@poe-code/pdf-ast)");

  let page = doc.addPage([612, 792]);
  let y = 720;

  const ensureSpace = (needed: number) => {
    if (y - needed < 54) {
      page = doc.addPage([612, 792]);
      y = 720;
    }
  };

  let work = 0;
  for (const block of blocks) {
    if (++work % 32 === 0) yield undefined;
    if (block.kind === "heading") {
      ensureSpace(32);
      page.drawText(block.text ?? "", {
        x: 54,
        y,
        size: 18,
        font: "Helvetica-Bold",
        color: rgb(0.1, 0.15, 0.28)
      });
      y -= 28;
    } else if (block.kind === "paragraph") {
      ensureSpace(22);
      page.drawText(block.text ?? "", {
        x: 54,
        y,
        size: 11,
        font: "Helvetica",
        color: rgb(0.15, 0.15, 0.15)
      });
      y -= 18;
    } else if (block.kind === "table" && block.rows) {
      const colCount = Math.max(1, ...block.rows.map((r) => r.length));
      const tableWidth = 504;
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
    }
  }

  return doc.save();
}

function renderSlidesToPdf(slides: readonly { title: string; bullets: string[] }[]): Uint8Array {
  const doc = PdfDocument.create();
  doc.setCreator("LibreOffice Impress (@poe-code/pdf-ast)");

  for (const slide of slides) {
    const page = doc.addPage([720, 405]);
    page.drawRect({
      x: 0,
      y: 345,
      width: 720,
      height: 60,
      fill: rgb(0.12, 0.22, 0.38)
    });
    page.drawText(slide.title, {
      x: 40,
      y: 365,
      size: 22,
      font: "Helvetica-Bold",
      color: rgb(1, 1, 1)
    });
    let y = 300;
    for (const bullet of slide.bullets) {
      page.drawText(`- ${bullet}`, {
        x: 52,
        y,
        size: 14,
        font: "Helvetica",
        color: rgb(0.18, 0.2, 0.24)
      });
      y -= 26;
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

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBlocksToText(blocks: readonly DocBlock[]): Uint8Array {
  const lines = blocks.map(block => block.kind === "table"
    ? (block.rows ?? []).map(row => row.join("\t")).join("\n")
    : block.text ?? "");
  return new TextEncoder().encode(lines.join("\n\n") + "\n");
}

function renderBlocksToHtml(blocks: readonly DocBlock[], title = "Document"): Uint8Array {
  let html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtmlText(title)}</title></head><body>\n`;
  for (const b of blocks) {
    if (b.kind === "heading") {
      html += `<h1>${escapeHtmlText(b.text ?? "")}</h1>\n`;
    } else if (b.kind === "paragraph") {
      html += `<p>${escapeHtmlText(b.text ?? "")}</p>\n`;
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
  const raw = new TextDecoder("latin1").decode(rtfBytes);
  const cleaned = raw
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info)[\s\S]*?\}/g, "")
    .replace(/\\par\b\s*/g, "\n")
    .replace(/\\line\b\s*/g, "\n")
    .replace(/\\tab\b\s*/g, "\t")
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
    .replace(/[{}]/g, "");
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
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
    "[Content_Types].xml": enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    "_rels/.rels": enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    "word/document.xml": enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyParts.join("")}</w:body></w:document>`
    )
  });
}

function buildXlsxFromRows(rows: readonly (readonly string[])[]): Uint8Array {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sheetRows = rows
    .map((row, rIdx) => {
      const cells = row
        .map((val, cIdx) => {
          const colLetter = String.fromCharCode(65 + (cIdx % 26));
          return `<c r="${colLetter}${rIdx + 1}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rIdx + 1}">${cells}</row>`;
    })
    .join("");
  const enc = new TextEncoder();
  return createStoredZipArchive({
    "[Content_Types].xml": enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    ),
    "_rels/.rels": enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    "xl/workbook.xml": enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`
    ),
    "xl/worksheets/sheet1.xml": enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    )
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field.length === 0) {
        quoted = !quoted;
      } else {
        field += char;
      }
    } else if (!quoted && char === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\r" || char === "\n")) {
      row.push(field);
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
    row.push(field);
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
          chunks.push(parseDocxBlocks(bytes).map((b) => b.text ?? (b.rows?.map((r) => r.join("\t")).join("\n") ?? "")).join("\n"));
        } else if ([".odt", ".ods", ".odp"].some(ext => lower.endsWith(ext))) {
          chunks.push(parseOdtBlocks(bytes).map((b) => b.text ?? (b.rows?.map((r) => r.join("\t")).join("\n") ?? "")).join("\n"));
        } else if (lower.endsWith(".xlsx")) {
          chunks.push(parseXlsxRows(bytes).map(row => row.join("\t")).join("\n"));
        } else if (lower.endsWith(".pptx")) {
          chunks.push(parsePptxSlides(bytes).map(slide => [slide.title, ...slide.bullets].join("\n")).join("\n\n"));
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
        const blocks = lowerIn.endsWith(".docx")
          ? parseDocxBlocks(inputBytes)
          : [".odt", ".ods", ".odp"].some(ext => lowerIn.endsWith(ext))
            ? parseOdtBlocks(inputBytes)
            : parseRtfBlocks(inputBytes);
        if (targetExt === "pdf") {
          outBytes = yield* renderBlocksToPdf(blocks, stem);
        } else if (targetExt === "html") {
          outBytes = renderBlocksToHtml(blocks, stem);
        } else if (targetExt === "docx") {
          outBytes = buildDocxFromBlocks(blocks);
        } else {
          outBytes = renderBlocksToText(blocks);
        }
      } else if (lowerIn.endsWith(".xlsx") || lowerIn.endsWith(".csv")) {
        const rows = lowerIn.endsWith(".xlsx")
          ? parseXlsxRows(inputBytes)
          : parseCsvRows(new TextDecoder().decode(inputBytes));
        if (targetExt === "csv") {
          outBytes = formatStarCalcCsv(rows, filterOpts);
        } else if (targetExt === "xlsx") {
          outBytes = buildXlsxFromRows(rows);
        } else if (targetExt === "html") {
          outBytes = renderBlocksToHtml([{ kind: "table", rows }], stem);
        } else if (targetExt === "pdf") {
          outBytes = yield* renderBlocksToPdf([{ kind: "table", rows }], stem);
        } else {
          outBytes = new TextEncoder().encode(rows.map(row => row.join("\t")).join("\n") + "\n");
        }
      } else if (lowerIn.endsWith(".pptx")) {
        const slides = parsePptxSlides(inputBytes);
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
        else outBytes = isHtml || lowerIn.endsWith(".md") ? renderBlocksToText(blocks) : inputBytes;
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

export async function soffice(context: CommandContext, options: SofficeCommandOptions = {}): Promise<{ exitCode: number }> {
  const limits = resolveLimits(options);
  let outputBytes = 0;
  const chargeOutput = (bytes: number) => {
    outputBytes += bytes;
    if (outputBytes > limits.maxOutputBytes) throw new RangeError("Output byte limit exceeded");
  };
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const argumentBytes = argv.reduce((total, arg) => total + new TextEncoder().encode(arg).byteLength + 1, 0);
    if (argumentBytes > limits.maxArgumentBytes) throw new RangeError("Argument byte limit exceeded");

    const vfsFiles = new Map<string, Uint8Array>();
    const parsed = parseSofficeArguments(argv, context.cwd);
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
  }
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
