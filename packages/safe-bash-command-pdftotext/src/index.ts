import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import {
  PdfDocument,
  decodePdfString,
  dictGet,
  encodeJpeg,
  encodePng,
  extractDocumentImages,
  extractPageAnnotations,
  formatExtractedPageText,
  resolveDestinationPageIndex,
  type PdfCosDict,
  type PdfExtractedPage,
  type PdfTextBlock,
  type PdfTextLine,
  type PdfTextWord
} from "@poe-code/pdf-ast";

export interface PdftotextCommandOptions {
  readonly replace?: boolean;
}

export interface PdftotextCliResult {
  readonly exitCode: number;
  readonly output: string;
  readonly stderr: string;
  readonly outputPath: string;
}

const SUPPORTED_ENCODINGS = new Set([
  "ASCII7",
  "Latin1",
  "UTF-8",
  "UCS-2",
  "Symbol",
  "ZapfDingbats"
]);

interface ParsedArgs {
  firstPage: number;
  lastPage: number;
  lastPageExplicit: boolean;
  resolution: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  layout: boolean;
  raw: boolean;
  bbox: boolean;
  bboxLayout: boolean;
  tsv: boolean;
  htmlmeta: boolean;
  nopgbrk: boolean;
  nodiag: boolean;
  cropbox: boolean;
  clip: boolean;
  urls: boolean;
  removeHyphens: boolean;
  fixed?: number;
  linespacing?: number;
  eol: "unix" | "dos" | "mac";
  invalidEolWarning: boolean;
  colspacing: number;
  encoding: string;
  listenc: boolean;
  upw?: string;
  opw?: string;
  quiet: boolean;
  version: boolean;
  help: boolean;
  inputFile?: string;
  outputFile?: string;
  error?: string;
  errorExitCode?: number;
  earlyErrorIgnoreQuiet?: boolean;
}

function parseStrictIntArg(raw: string | undefined): number | undefined {
  if (!raw || raw.length === 0) return undefined;
  let start = 0;
  if (raw[0] === "-" || raw[0] === "+") {
    if (raw.length === 1) return undefined;
    start = 1;
  }
  for (let i = start; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return undefined;
  }
  const val = Number.parseInt(raw, 10);
  return Number.isSafeInteger(val) ? val : undefined;
}

function parseStrictFloatArg(raw: string | undefined): number | undefined {
  if (!raw || raw.length === 0) return undefined;
  let start = 0;
  if (raw[0] === "-" || raw[0] === "+") {
    if (raw.length === 1) return undefined;
    start = 1;
  }
  let dotCount = 0;
  let digitCount = 0;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === ".") {
      dotCount++;
      if (dotCount > 1) return undefined;
    } else {
      const c = ch.charCodeAt(0);
      if (c < 0x30 || c > 0x39) return undefined;
      digitCount++;
    }
  }
  if (digitCount === 0) return undefined;
  const val = Number.parseFloat(raw);
  return Number.isFinite(val) ? val : undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const res: ParsedArgs = {
    firstPage: 1,
    lastPage: 0,
    lastPageExplicit: false,
    resolution: 72,
    layout: false,
    raw: false,
    bbox: false,
    bboxLayout: false,
    tsv: false,
    htmlmeta: false,
    nopgbrk: false,
    nodiag: false,
    cropbox: false,
    clip: false,
    urls: false,
    removeHyphens: true,
    eol: "unix",
    invalidEolWarning: false,
    colspacing: 0.7,
    encoding: "UTF-8",
    listenc: false,
    quiet: false,
    version: false,
    help: false
  };

  let invalidColspacing = false;
  let invalidRemoveHyphens = false;
  const positional: string[] = [];
  let afterDoubleDash = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (afterDoubleDash) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (arg === "-f") {
      const val = parseStrictIntArg(argv[++i]);
      if (val === undefined) {
        res.error = "Invalid -f page number\n";
        res.errorExitCode = 99;
        return res;
      }
      res.firstPage = val;
    } else if (arg === "-l") {
      const val = parseStrictIntArg(argv[++i]);
      if (val === undefined) {
        res.error = "Invalid -l page number\n";
        res.errorExitCode = 99;
        return res;
      }
      res.lastPage = val;
      res.lastPageExplicit = true;
    } else if (arg === "-r") {
      const val = parseStrictFloatArg(argv[++i]);
      if (val === undefined || val <= 0) {
        res.error = "Invalid -r resolution\n";
        res.errorExitCode = 99;
        return res;
      }
      res.resolution = val;
    } else if (arg === "-x" || arg === "-y" || arg === "-W" || arg === "-H") {
      const val = Number.parseFloat(argv[++i] ?? "");
      if (!Number.isFinite(val)) {
        res.error = `Command Line Error: Invalid numeric argument for ${arg}\n`;
        res.errorExitCode = 99;
        return res;
      }
      if (arg === "-x") res.cropX = val;
      else if (arg === "-y") res.cropY = val;
      else if (arg === "-W") res.cropW = val;
      else res.cropH = val;
    } else if (arg === "-layout") {
      res.layout = true;
    } else if (arg === "-table") {
      res.layout = true;
      res.colspacing = 0.5;
    } else if (arg === "-lineprinter") {
      res.layout = true;
      if (res.fixed === undefined) res.fixed = 12;
      if (res.linespacing === undefined) res.linespacing = 24;
    } else if (arg === "-clip") {
      res.clip = true;
    } else if (arg === "-urls") {
      res.urls = true;
    } else if (arg === "-remove-hyphens") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        i++;
        if (next === "yes" || next === "auto") {
          res.removeHyphens = true;
        } else if (next === "no") {
          res.removeHyphens = false;
        } else {
          invalidRemoveHyphens = true;
        }
      } else {
        res.removeHyphens = true;
      }
    } else if (arg === "-raw") {
      res.raw = true;
    } else if (arg === "-bbox") {
      res.bbox = true;
    } else if (arg === "-bbox-layout") {
      res.bbox = true;
      res.bboxLayout = true;
    } else if (arg === "-tsv") {
      res.tsv = true;
    } else if (arg === "-htmlmeta") {
      res.htmlmeta = true;
    } else if (arg === "-nopgbrk") {
      res.nopgbrk = true;
    } else if (arg === "-nodiag") {
      res.nodiag = true;
    } else if (arg === "-cropbox") {
      res.cropbox = true;
    } else if (arg === "-fixed") {
      const val = Number.parseFloat(argv[++i] ?? "0");
      if (Number.isFinite(val) && val > 0) {
        res.fixed = val;
      }
    } else if (arg === "-linespacing") {
      const val = Number.parseFloat(argv[++i] ?? "0");
      if (Number.isFinite(val) && val > 0) {
        res.linespacing = val;
      }
    } else if (arg === "-eol") {
      const val = argv[++i] ?? "";
      if (val === "unix" || val === "dos" || val === "mac") {
        res.eol = val;
      } else {
        res.invalidEolWarning = true;
      }
    } else if (arg === "-colspacing") {
      const val = parseStrictFloatArg(argv[++i]);
      if (val === undefined || val <= 0 || val > 10) {
        invalidColspacing = true;
      } else {
        res.colspacing = val;
      }
    } else if (arg === "-enc") {
      const next = argv[++i];
      if (!next || !SUPPORTED_ENCODINGS.has(next)) {
        res.error = `Command Line Error: Unknown encoding '${next ?? ""}'\n`;
        res.errorExitCode = 99;
        return res;
      }
      res.encoding = next;
    } else if (arg === "-listenc") {
      res.listenc = true;
    } else if (arg === "-upw") {
      res.upw = argv[++i] ?? "";
    } else if (arg === "-opw") {
      res.opw = argv[++i] ?? "";
    } else if (arg === "-q") {
      res.quiet = true;
    } else if (arg === "-v" || arg === "--version") {
      res.version = true;
    } else if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      res.help = true;
    } else if (arg.startsWith("-") && arg !== "-") {
      res.error = `Command Line Error: Unknown option '${arg}'\n`;
      res.errorExitCode = 99;
      return res;
    } else {
      positional.push(arg);
    }
  }

  // Early checks BEFORE help/version and BEFORE quiet installation:
  if (invalidColspacing) {
    res.error = "Command Line Error: Invalid column spacing\n";
    res.errorExitCode = 99;
    res.earlyErrorIgnoreQuiet = true;
    return res;
  }
  if (res.urls && (res.htmlmeta || res.bbox || res.tsv)) {
    res.error = "Command Line Error: '-urls' is not supported with HTML or TSV output\n";
    res.errorExitCode = 99;
    res.earlyErrorIgnoreQuiet = true;
    return res;
  }
  if (invalidRemoveHyphens && !res.help && !res.version && !res.listenc) {
    res.error = "Bad '-remove-hyphens' value on command line\n";
    res.errorExitCode = 99;
    return res;
  }

  if (positional.length > 2) {
    res.error = "Usage: pdftotext [options] [PDF-file [text-file]]\n";
    res.errorExitCode = 99;
    return res;
  }
  res.inputFile = positional[0] ?? "-";
  if (positional[1] !== undefined) {
    res.outputFile = positional[1];
  } else if (res.inputFile === "-") {
    res.outputFile = "-";
  } else {
    const ext = res.bbox || res.htmlmeta ? ".html" : res.tsv ? ".tsv" : ".txt";
    const stem = res.inputFile.toLowerCase().endsWith(".pdf")
      ? res.inputFile.slice(0, -4)
      : res.inputFile;
    res.outputFile = stem + ext;
  }
  return res;
}


const ASCII7_COMPAT_MAP: Readonly<Record<string, string>> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": "\"",
  "\u201D": "\"",
  "\u2013": "-",
  "\u2014": "--",
  "\u2026": "...",
  "\u00A0": " "
};

function applyPopplerOutputEncoding(text: string, encoding: string): string {
  if (!encoding || encoding === "UTF-8" || encoding === "UCS-2") return text;
  if (encoding === "ASCII7") {
    let out = "";
    const normalized = text.normalize("NFKD");
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i]!;
      const mapped = ASCII7_COMPAT_MAP[ch];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code >= 0x0300 && code <= 0x036f) continue;
      if (code <= 0x7f) out += ch;
    }
    return out;
  }
  if (encoding === "Latin1") {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const mapped = ASCII7_COMPAT_MAP[ch];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code <= 0xff) out += ch;
    }
    return out;
  }
  return text;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&apos;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function filterExtractedPageByCrop(
  extracted: PdfExtractedPage,
  args: ParsedArgs,
  pageCropBoxPt?: readonly [number, number, number, number]
): PdfExtractedPage {
  if (
    args.cropX === undefined &&
    args.cropY === undefined &&
    args.cropW === undefined &&
    args.cropH === undefined &&
    pageCropBoxPt === undefined
  ) {
    return extracted;
  }
  const scale = args.resolution / 72;
  const cbX0 = pageCropBoxPt ? Math.min(pageCropBoxPt[0], pageCropBoxPt[2]) : 0;
  const cbY0 = pageCropBoxPt ? Math.min(pageCropBoxPt[1], pageCropBoxPt[3]) : 0;
  const cbX1 = pageCropBoxPt ? Math.max(pageCropBoxPt[0], pageCropBoxPt[2]) : extracted.width;
  const cbY1 = pageCropBoxPt ? Math.max(pageCropBoxPt[1], pageCropBoxPt[3]) : extracted.height;

  const minX = cbX0 + (args.cropX ?? 0) / scale;
  const minTopY = (extracted.height - cbY1) + (args.cropY ?? 0) / scale;
  const maxX =
    args.cropW !== undefined && args.cropW > 0 ? minX + args.cropW / scale : cbX1;
  const maxTopY =
    args.cropH !== undefined && args.cropH > 0
      ? minTopY + args.cropH / scale
      : extracted.height - cbY0;

  const filterWords = (words: readonly PdfTextWord[]): PdfTextWord[] =>
    words
      .filter((w) => {
        const topY = extracted.height - w.bbox[3];
        const bottomY = extracted.height - w.bbox[1];
        const cx = (w.bbox[0] + w.bbox[2]) / 2;
        const cy = (topY + bottomY) / 2;
        return cx >= minX && cx <= maxX && cy >= minTopY && cy <= maxTopY;
      })
      .map((w) =>
        pageCropBoxPt
          ? {
              ...w,
              bbox: [
                w.bbox[0] - cbX0,
                w.bbox[1] - cbY0,
                w.bbox[2] - cbX0,
                w.bbox[3] - cbY0
              ] as const
            }
          : w
      );

  const blocks: PdfTextBlock[] = [];
  for (const b of extracted.blocks) {
    const lines: PdfTextLine[] = [];
    for (const l of b.lines) {
      const words = filterWords(l.words);
      if (words.length > 0) {
        const lineBbox: readonly [number, number, number, number] = [
          Math.min(...words.map((w) => w.bbox[0])),
          Math.min(...words.map((w) => w.bbox[1])),
          Math.max(...words.map((w) => w.bbox[2])),
          Math.max(...words.map((w) => w.bbox[3]))
        ];
        lines.push({
          ...l,
          bbox: lineBbox,
          words,
          text: words.map((w) => w.text).join(" ")
        });
      }
    }
    if (lines.length > 0) {
      const blockBbox: readonly [number, number, number, number] = [
        Math.min(...lines.map((l) => l.bbox[0])),
        Math.min(...lines.map((l) => l.bbox[1])),
        Math.max(...lines.map((l) => l.bbox[2])),
        Math.max(...lines.map((l) => l.bbox[3]))
      ];
      blocks.push({
        ...b,
        bbox: blockBbox,
        lines,
        text: lines.map((l) => l.text).join("\n")
      });
    }
  }

  return {
    ...extracted,
    width: pageCropBoxPt ? Math.max(1, cbX1 - cbX0) : extracted.width,
    height: pageCropBoxPt ? Math.max(1, cbY1 - cbY0) : extracted.height,
    blocks
  };
}

function countWords(page: PdfExtractedPage): number {
  let count = 0;
  for (const b of page.blocks) {
    for (const l of b.lines) {
      count += l.words.length;
    }
  }
  return count;
}

function renderBboxHtml(
  doc: PdfDocument,
  pages: readonly { pageNumber: number; extracted: PdfExtractedPage }[],
  args: ParsedArgs
): { html: string; emptyPageWarning: boolean } {
  const scale = args.resolution / 72;
  const meta = doc.getMetadata();
  let emptyPageWarning = false;

  let html =
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n';
  html += `<title>${escapeXml(meta.title ?? "")}</title>\n`;
  if (meta.author) html += `<meta name="Author" content="${escapeXml(meta.author)}"/>\n`;
  if (meta.subject) html += `<meta name="Subject" content="${escapeXml(meta.subject)}"/>\n`;
  if (meta.creator) html += `<meta name="Creator" content="${escapeXml(meta.creator)}"/>\n`;
  if (meta.producer) html += `<meta name="Producer" content="${escapeXml(meta.producer)}"/>\n`;
  html += "</head>\n<body>\n<doc>\n";

  for (const { extracted } of pages) {
    html += `  <page width="${extracted.width.toFixed(6)}" height="${extracted.height.toFixed(6)}">\n`;
    if (countWords(extracted) === 0 && !args.bboxLayout) {
      emptyPageWarning = true;
    }
    for (const block of extracted.blocks) {
      const bxMin = (block.bbox[0] * scale).toFixed(6);
      const byMin = ((extracted.height - block.bbox[3]) * scale).toFixed(6);
      const bxMax = (block.bbox[2] * scale).toFixed(6);
      const byMax = ((extracted.height - block.bbox[1]) * scale).toFixed(6);
      if (args.bboxLayout) html += "    <flow>\n";
      html += `      <block xMin="${bxMin}" yMin="${byMin}" xMax="${bxMax}" yMax="${byMax}">\n`;
      for (const line of block.lines) {
        const lxMin = (line.bbox[0] * scale).toFixed(6);
        const lyMin = ((extracted.height - line.bbox[3]) * scale).toFixed(6);
        const lxMax = (line.bbox[2] * scale).toFixed(6);
        const lyMax = ((extracted.height - line.bbox[1]) * scale).toFixed(6);
        html += `        <line xMin="${lxMin}" yMin="${lyMin}" xMax="${lxMax}" yMax="${lyMax}">\n`;
        for (const word of line.words) {
          const wxMin = (word.bbox[0] * scale).toFixed(6);
          const wyMin = ((extracted.height - word.bbox[3]) * scale).toFixed(6);
          const wxMax = (word.bbox[2] * scale).toFixed(6);
          const wyMax = ((extracted.height - word.bbox[1]) * scale).toFixed(6);
          html += `          <word xMin="${wxMin}" yMin="${wyMin}" xMax="${wxMax}" yMax="${wyMax}">${escapeXml(word.text)}</word>\n`;
        }
        html += "        </line>\n";
      }
      html += "      </block>\n";
      if (args.bboxLayout) html += "    </flow>\n";
    }
    html += "  </page>\n";
  }

  html += "</doc>\n</body>\n</html>\n";
  return { html, emptyPageWarning };
}

function renderTsv(
  pages: readonly { pageNumber: number; extracted: PdfExtractedPage }[],
  args: ParsedArgs
): string {
  const scale = args.resolution / 72;
  const rows: string[] = [
    "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
  ];

  for (const { pageNumber, extracted } of pages) {
    rows.push(
      `1\t${pageNumber}\t0\t0\t0\t0\t0.000000\t0.000000\t${extracted.width.toFixed(6)}\t${extracted.height.toFixed(6)}\t-1\t###PAGE###`
    );
    if (args.raw) continue;
    extracted.blocks.forEach((block, blockIdx) => {
      const bLeft = (block.bbox[0] * scale).toFixed(6);
      const bTop = ((extracted.height - block.bbox[3]) * scale).toFixed(6);
      const bWidth = ((block.bbox[2] - block.bbox[0]) * scale).toFixed(6);
      const bHeight = ((block.bbox[3] - block.bbox[1]) * scale).toFixed(6);
      rows.push(
        `2\t${pageNumber}\t${blockIdx}\t${blockIdx}\t0\t0\t${bLeft}\t${bTop}\t${bWidth}\t${bHeight}\t-1\t###FLOW###`
      );
      block.lines.forEach((line, lineIdx) => {
        const lLeft = (line.bbox[0] * scale).toFixed(6);
        const lTop = ((extracted.height - line.bbox[3]) * scale).toFixed(6);
        const lWidth = ((line.bbox[2] - line.bbox[0]) * scale).toFixed(6);
        const lHeight = ((line.bbox[3] - line.bbox[1]) * scale).toFixed(6);
        rows.push(
          `4\t${pageNumber}\t${blockIdx}\t${blockIdx}\t${lineIdx}\t0\t${lLeft}\t${lTop}\t${lWidth}\t${lHeight}\t-1\t###LINE###`
        );
        line.words.forEach((word, wordIdx) => {
          const wLeft = (word.bbox[0] * scale).toFixed(2);
          const wTop = ((extracted.height - word.bbox[3]) * scale).toFixed(2);
          const wWidth = ((word.bbox[2] - word.bbox[0]) * scale).toFixed(2);
          const wHeight = ((word.bbox[3] - word.bbox[1]) * scale).toFixed(2);
          rows.push(
            `5\t${pageNumber}\t${blockIdx}\t${blockIdx}\t${lineIdx}\t${wordIdx}\t${wLeft}\t${wTop}\t${wWidth}\t${wHeight}\t100\t${word.text}`
          );
        });
      });
    });
  }

  return rows.join("\n") + "\n";
}

export function extractPdfToTextBytes(
  bytes: Uint8Array,
  argv: readonly string[] = []
): PdftotextCliResult {
  const args = parseArgs(argv);
  const stderrParts: string[] = [];
  // Invalid -eol prints direct stderr and continues default platform EOL, even with -q
  if (args.invalidEolWarning) {
    stderrParts.push("Bad '-eol' value on command line\n");
  }
  if (args.error) {
    return {
      exitCode: args.errorExitCode ?? 99,
      output: "",
      stderr:
        args.quiet && !args.earlyErrorIgnoreQuiet
          ? stderrParts.join("")
          : stderrParts.join("") + args.error,
      outputPath: args.outputFile ?? "-"
    };
  }
  if (args.listenc) {
    return {
      exitCode: 0,
      output: `Available encodings are:\n${[...SUPPORTED_ENCODINGS].join("\n")}\n`,
      stderr: stderrParts.join(""),
      outputPath: "-"
    };
  }
  if (args.version) {
    return {
      exitCode: 0,
      output: "pdftotext version 26.09.90 (@poe-code/pdf-ast)\n",
      stderr: stderrParts.join(""),
      outputPath: "-"
    };
  }
  if (args.help) {
    return {
      exitCode: 0,
      output:
        "Usage: pdftotext [options] [PDF-file [text-file]]\n  -f <int>          : first page to convert\n  -l <int>          : last page to convert\n  -r <fp>           : resolution, in DPI (default is 72)\n  -x <int>          : x-coordinate of the crop area top left corner\n  -y <int>          : y-coordinate of the crop area top left corner\n  -W <int>          : width of crop area in pixels\n  -H <int>          : height of crop area in pixels\n  -layout           : maintain original physical layout\n  -raw              : keep strings in content stream order\n  -bbox             : output bounding box for each word and page size to html\n  -bbox-layout      : like -bbox but with extra layout bounding box data\n  -tsv              : output bounding box for each word and page size to tsv\n  -htmlmeta         : generate a simple HTML file, including the meta information\n  -nopgbrk          : don't insert page breaks between pages\n  -eol <string>     : output end-of-line convention (unix, dos, or mac)\n  -upw <string>     : user password\n  -opw <string>     : owner password\n",
      stderr: stderrParts.join(""),
      outputPath: "-"
    };
  }

  if (bytes.byteLength === 0) {
    return {
      exitCode: 1,
      output: "",
      stderr: args.quiet ? "" : stderrParts.join("") + "Syntax Error: Document stream is empty\n",
      outputPath: args.outputFile ?? "-"
    };
  }

  const password = args.opw ?? args.upw;
  let doc: PdfDocument;
  try {
    doc = PdfDocument.load(bytes, password !== undefined ? { password } : {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lowerMsg = msg.toLowerCase();
    const errText =
      lowerMsg.includes("password") || lowerMsg.includes("encrypted")
      ? "Command Line Error: Incorrect password\n"
      : `Syntax Error: ${msg}\n`;
    return {
      exitCode: 1,
      output: "",
      stderr: args.quiet ? "" : stderrParts.join("") + errText,
      outputPath: args.outputFile ?? "-"
    };
  }

  const pageCount = doc.getPageCount();
  const firstPage = args.firstPage < 1 ? 1 : args.firstPage;
  const lastPage =
    !args.lastPageExplicit || args.lastPage === 0 || args.lastPage > pageCount
      ? pageCount
      : args.lastPage;

  if (firstPage > pageCount || firstPage > lastPage) {
    return {
      exitCode: 99,
      output: "",
      stderr: args.quiet
        ? ""
        : stderrParts.join("") +
          `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${lastPage}).\n`,
      outputPath: args.outputFile ?? "-"
    };
  }

  const mode = args.raw ? "raw" : args.layout ? "layout" : "logical";
  const pages: Array<{ pageNumber: number; extracted: PdfExtractedPage }> = [];
  for (let p = firstPage; p <= lastPage; p++) {
    const page = doc.getPage(p - 1);
    let pageCropBoxPt: [number, number, number, number] | undefined;
    if (args.cropbox) {
      let cur: PdfCosDict | undefined = page.pageDict;
      const visited = new Set<PdfCosDict>();
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        const cb = doc.cos.resolveArray(dictGet(cur, "CropBox"));
        if (cb && cb.items.length >= 4) {
          const nums = cb.items.slice(0, 4).map(it => {
            const r = doc.cos.resolve(it);
            return r?.kind === "number" ? r.value : 0;
          });
          pageCropBoxPt = [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
          break;
        }
        cur = doc.cos.resolveDict(dictGet(cur, "Parent"));
      }
    }
    const rawExtracted = page.extractPage({
      mode,
      rejoinHyphens: mode === "logical" && args.removeHyphens,
      discardDiagonal: args.nodiag,
      clipText: args.clip,
      colSpacing: args.colspacing,
      fixedPitch: args.fixed,
      lineSpacing: args.linespacing
    });
    pages.push({
      pageNumber: p,
      extracted: filterExtractedPageByCrop(rawExtracted, args, pageCropBoxPt)
    });
  }

  if (args.bbox) {
    const { html, emptyPageWarning } = renderBboxHtml(doc, pages, args);
    if (emptyPageWarning && !args.quiet) {
      stderrParts.push("no word list\n");
    }
    return {
      exitCode: 0,
      output: html,
      stderr: stderrParts.join(""),
      outputPath: args.outputFile ?? "-"
    };
  }

  if (args.tsv) {
    const tsvText = renderTsv(pages, args);
    if (args.htmlmeta) {
      const meta = doc.getMetadata();
      let html =
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n';
      html += `<title>${escapeXml(meta.title ?? "")}</title>\n`;
      if (meta.author) html += `<meta name="Author" content="${escapeXml(meta.author)}"/>\n`;
      if (meta.subject) html += `<meta name="Subject" content="${escapeXml(meta.subject)}"/>\n`;
      if (meta.creator) html += `<meta name="Creator" content="${escapeXml(meta.creator)}"/>\n`;
      if (meta.producer) html += `<meta name="Producer" content="${escapeXml(meta.producer)}"/>\n`;
      html += `</head>\n<body>\n<pre>\n${escapeXml(tsvText)}</pre>\n</body>\n</html>\n`;
      return {
        exitCode: 0,
        output: html,
        stderr: stderrParts.join(""),
        outputPath: args.outputFile ?? "-"
      };
    }
    return {
      exitCode: 0,
      output: tsvText,
      stderr: stderrParts.join(""),
      outputPath: args.outputFile ?? "-"
    };
  }

  const eolChar = args.eol === "dos" ? "\r\n" : args.eol === "mac" ? "\r" : "\n";
  let textOut = "";
  for (const { pageNumber, extracted } of pages) {
    let pageText = formatExtractedPageText(extracted, {
      mode,
      rejoinHyphens: mode === "logical" && args.removeHyphens,
      colSpacing: args.colspacing,
      fixedPitch: args.fixed,
      lineSpacing: args.linespacing
    });
    if (args.urls) {
      const annots = extractPageAnnotations(doc.cos, doc.getPage(pageNumber - 1).pageDict);
      const uris: string[] = [];
      for (const ann of annots) {
        if (ann.uri && !pageText.includes(ann.uri) && !uris.includes(ann.uri)) {
          uris.push(ann.uri);
        }
      }
      if (uris.length > 0) {
        if (pageText.length > 0 && !pageText.endsWith("\n")) {
          pageText += "\n";
        }
        pageText += uris.join("\n") + "\n";
      }
    }
    if (eolChar !== "\n") {
      pageText = pageText.replaceAll("\n", eolChar);
    }
    if (pageText.length > 0 && !pageText.endsWith(eolChar)) {
      pageText += eolChar;
    }
    if (mode === "logical" && pageText.length > 0) {
      pageText += eolChar;
    }
    if (!args.nopgbrk) {
      pageText += "\f";
    }
    textOut += pageText;
  }

  if (args.htmlmeta) {
    const meta = doc.getMetadata();
    let html =
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n';
    html += `<title>${escapeXml(meta.title ?? "")}</title>\n`;
    if (meta.author) html += `<meta name="Author" content="${escapeXml(meta.author)}"/>\n`;
    if (meta.subject) html += `<meta name="Subject" content="${escapeXml(meta.subject)}"/>\n`;
    if (meta.creator) html += `<meta name="Creator" content="${escapeXml(meta.creator)}"/>\n`;
    if (meta.producer) html += `<meta name="Producer" content="${escapeXml(meta.producer)}"/>\n`;
    html += `</head>\n<body>\n<pre>\n${escapeXml(textOut)}</pre>\n</body>\n</html>\n`;
    textOut = html;
  }

  return {
    exitCode: 0,
    output: applyPopplerOutputEncoding(textOut, args.encoding),
    stderr: stderrParts.join(""),
    outputPath: args.outputFile ?? "-"
  };
}

export async function runPdftotextCli(
  argv: readonly string[],
  files: ReadonlyMap<string, Uint8Array>,
  stdinBytes: Uint8Array = new Uint8Array(0)
): Promise<PdftotextCliResult> {
  const args = parseArgs(argv);
  if (args.error || args.listenc || args.version || args.help) {
    return extractPdfToTextBytes(new Uint8Array(0), argv);
  }
  const target = args.inputFile ?? "-";
  if (target === "-") {
    return extractPdfToTextBytes(stdinBytes, argv);
  }
  const fileBytes = files.get(target);
  if (!fileBytes) {
    return {
      exitCode: 1,
      output: "",
      stderr: args.quiet
        ? ""
        : `I/O Error: Couldn't open file '${target}': No such file or directory.\n`,
      outputPath: args.outputFile ?? "-"
    };
  }
  return extractPdfToTextBytes(fileBytes, argv);
}

export async function pdftotext(context: CommandContext): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const parsed = parseArgs(argv);

    if (parsed.error || parsed.listenc || parsed.version || parsed.help) {
      const res = extractPdfToTextBytes(new Uint8Array(0), argv);
      if (res.stderr) {
        await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
      }
      if (res.output) {
        const stdout = invocation.child(context.stdout);
        await writeBytes(stdout.output, new TextEncoder().encode(res.output), invocation.signal);
      }
      return { exitCode: res.exitCode };
    }

    const inputTarget = parsed.inputFile ?? "-";
    let pdfBytes: Uint8Array;
    let accountedBytes = 0;
    const chargeBytes = (delta: number) => {
      if (delta > 0) {
        accountedBytes += delta;
        context.inputBudget?.check(accountedBytes);
      }
    };
    if (inputTarget === "-") {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
        chargeBytes(chunk.byteLength);
      }
      pdfBytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        pdfBytes.set(c, offset);
        offset += c.byteLength;
      }
    } else {
      const resolvedPath = inputTarget.startsWith("/")
        ? inputTarget
        : `${context.cwd === "/" ? "" : context.cwd}/${inputTarget}`;
      try {
        pdfBytes = await context.fs.readFile(resolvedPath, { signal: invocation.signal });
        chargeBytes(pdfBytes.byteLength);
      } catch {
        if (!parsed.quiet) {
          const msg = `I/O Error: Couldn't open file '${inputTarget}': No such file or directory.\n`;
          await writeBytes(context.stderr, new TextEncoder().encode(msg), invocation.signal);
        }
        return { exitCode: 1 };
      }
    }

    const res = extractPdfToTextBytes(pdfBytes, argv);
    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.exitCode !== 0) {
      return { exitCode: res.exitCode };
    }

    const outBytes = new TextEncoder().encode(res.output);
    chargeBytes(outBytes.byteLength);
    if (res.outputPath === "-") {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, outBytes, invocation.signal);
    } else {
      const outResolved = res.outputPath.startsWith("/")
        ? res.outputPath
        : `${context.cwd === "/" ? "" : context.cwd}/${res.outputPath}`;
      try {
        await context.fs.writeFile(outResolved, outBytes, { signal: invocation.signal });
      } catch {
        if (!parsed.quiet) {
          const msg = `I/O Error: Couldn't open text file '${res.outputPath}'\n`;
          await writeBytes(context.stderr, new TextEncoder().encode(msg), invocation.signal);
        }
        return { exitCode: 2 };
      }
    }

    return { exitCode: 0 };
  } finally {
    await invocation.close();
  }
}

export function createPdftotextCommand(_options: PdftotextCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdftotext",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Extract PDF text, layout, XHTML bounding boxes, and TSV via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return pdftotext(context);
    }
  });
}

export const pdftotextCommand: CommandDefinition = createPdftotextCommand();

function escapeHtmlXml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >>> 18) & 0x3f]!;
    out += BASE64_ALPHABET[(triple >>> 12) & 0x3f]!;
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >>> 6) & 0x3f]! : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f]! : "=";
  }
  return out;
}

export async function runPdftohtmlCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let xmlMode = false;
  let toStdout = false;
  let ignoreImages = false;
  let dataUrls = false;
  let firstPage = 1;
  let lastPage = 0;
  let zoom = 1;
  let imageFmt: "png" | "jpg" = "png";
  let encoding = "UTF-8";
  let password = "";
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdftohtml version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout: "Usage: pdftohtml [options] <PDF-file> [<html-file>|<xml-file>]\n  -xml / -stdout / -s / -i / -noframes / -c / -f <int> / -l <int>\n",
        stderr: ""
      };
    }
    if (arg === "-xml") xmlMode = true;
    else if (arg === "-stdout") toStdout = true;
    else if (arg === "-i") ignoreImages = true;
    else if (arg === "-dataurls") dataUrls = true;
    else if (arg === "-f") firstPage = Math.max(1, Number(argv[++i] ?? "1") || 1);
    else if (arg === "-l") lastPage = Math.max(0, Number(argv[++i] ?? "0") || 0);
    else if (arg === "-zoom") {
      const z = Number.parseFloat(argv[++i] ?? "1");
      if (Number.isFinite(z) && z > 0) zoom = z;
    } else if (arg === "-fmt") {
      const fmtVal = (argv[++i] ?? "").toLowerCase();
      if (fmtVal === "png") imageFmt = "png";
      else if (fmtVal === "jpg" || fmtVal === "jpeg") imageFmt = "jpg";
      else {
        return { exitCode: 99, stdout: "", stderr: `Command Line Error: Invalid image format '${fmtVal}'\n` };
      }
    } else if (arg === "-enc") {
      const nextEnc = argv[++i] ?? "";
      if (!SUPPORTED_ENCODINGS.has(nextEnc)) {
        return { exitCode: 99, stdout: "", stderr: `Command Line Error: Unknown encoding '${nextEnc}'\n` };
      }
      encoding = nextEnc;
    }
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (
      arg === "-s" ||
      arg === "-noframes" ||
      arg === "-c" ||
      arg === "-p" ||
      arg === "-q" ||
      arg === "-hidden" ||
      arg === "-nomerge" ||
      arg === "-nodrm"
    ) {
      // Flag options
    } else if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
    }
  }

  const inputPath = positionals[0] ?? (files.has("-") ? "-" : undefined);
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: "Usage: pdftohtml [options] <PDF-file> [<html-file>]\n" };
  }
  const pdfBytes = files.get(inputPath);
  if (!pdfBytes) {
    return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${inputPath}'\n` };
  }

  let doc: PdfDocument;
  try {
    doc = PdfDocument.load(pdfBytes, password ? { password } : undefined);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: `PDF Error: ${(err as Error).message}\n` };
  }

  const totalPages = Math.max(1, doc.pageCount);
  const endPage = lastPage > 0 ? Math.min(totalPages, lastPage) : totalPages;
  if (firstPage > totalPages || (lastPage > 0 && firstPage > endPage)) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${endPage}).\n`
    };
  }

  interface OutlineItem {
    readonly title: string;
    readonly pageNumber: number;
    readonly children: OutlineItem[];
  }
  const pageRefToNum = new Map<number, number>();
  for (let i = 0; i < doc.pageCount; i++) {
    pageRefToNum.set(doc.getPage(i).ref.objectNumber, i + 1);
  }
  const resolveOutlineDestPage = (itemDict: PdfCosDict): number => {
    const idx = resolveDestinationPageIndex(doc, dictGet(itemDict, "Dest") ?? dictGet(itemDict, "A"));
    return idx !== undefined ? idx + 1 : 1;
  };
  const collectOutlines = (firstNode: import("@poe-code/pdf-ast").PdfCosNode | undefined, visited = new Set<number>()): OutlineItem[] => {
    const items: OutlineItem[] = [];
    let cur = firstNode;
    while (cur) {
      if (cur.kind === "ref") {
        if (visited.has(cur.objectNumber)) break;
        visited.add(cur.objectNumber);
      }
      const dict = doc.cos.resolveDict(cur);
      if (!dict) break;
      const tNode = doc.cos.resolve(dictGet(dict, "Title"));
      const title = tNode?.kind === "string" ? decodePdfString(tNode) : "";
      const pageNumber = resolveOutlineDestPage(dict);
      const children = collectOutlines(dictGet(dict, "First"), visited);
      if (title.length > 0) {
        items.push({ title, pageNumber, children });
      }
      cur = dictGet(dict, "Next");
    }
    return items;
  };
  const catalog = doc.cos.resolveDict(doc.cos.rootRef);
  const outlinesRoot = catalog ? doc.cos.resolveDict(dictGet(catalog, "Outlines")) : undefined;
  const outlineTree = outlinesRoot ? collectOutlines(dictGet(outlinesRoot, "First")) : [];

  let outputText = "";
  if (xmlMode) {
    const lines = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!DOCTYPE pdf2xml SYSTEM "pdf2xml.dtd">`,
      `<pdf2xml producer="@poe-code/pdf-ast" version="24.08.0">`
    ];
    for (let p = firstPage; p <= endPage; p++) {
      const page = doc.getPage(p - 1);
      const { width, height } = page.getSize();
      const extracted = page.extractPage();
      const annots = extractPageAnnotations(doc.cos, page.pageDict);
      const pageImages = ignoreImages ? [] : extractDocumentImages(doc.cos, { firstPage: p, lastPage: p });
      const fontKeyToBaseFont = new Map<string, string>();
      const resDict = page.getResourcesDict();
      const fontSubDict = resDict ? doc.cos.resolveDict(dictGet(resDict, "Font")) : undefined;
      if (fontSubDict) {
        for (const entry of fontSubDict.entries) {
          const fDict = doc.cos.resolveDict(entry.value);
          const bfNode = fDict ? doc.cos.resolve(dictGet(fDict, "BaseFont") ?? dictGet(fDict, "Name")) : undefined;
          if (bfNode?.kind === "name") {
            fontKeyToBaseFont.set(entry.key.decoded, bfNode.decoded);
          } else if (bfNode?.kind === "string") {
            fontKeyToBaseFont.set(entry.key.decoded, decodePdfString(bfNode));
          }
        }
      }
      const defaultSize = Math.round(12 * zoom);
      const fontSpecIdByKey = new Map<string, number>([[`Helvetica:${defaultSize}`, 0]]);
      const fontSpecLines: string[] = [
        `    <fontspec id="0" size="${defaultSize}" family="Helvetica" color="#000000"/>`
      ];
      lines.push(`  <page number="${p}" position="absolute" top="0" left="0" height="${Math.round(height * zoom)}" width="${Math.round(width * zoom)}">`);
      const imageLines: string[] = [];
      for (let imgIdx = 0; imgIdx < pageImages.length; imgIdx++) {
        const img = pageImages[imgIdx]!;
        const imgBytes = imageFmt === "jpg" ? encodeJpeg(img.bitmap) : encodePng(img.bitmap);
        const imgFile = `page${p}_${imgIdx + 1}.${imageFmt}`;
        if (!dataUrls) {
          files.set(imgFile, imgBytes);
        }
        const mime = imageFmt === "jpg" ? "image/jpeg" : "image/png";
        const src = dataUrls ? `data:${mime};base64,${bytesToBase64(imgBytes)}` : imgFile;
        imageLines.push(`    <image top="0" left="0" width="${img.width}" height="${img.height}" src="${src}"/>`);
      }
      const textLines: string[] = [];
      for (const block of extracted.blocks) {
        for (const line of block.lines) {
          const [x0, y0, x1, y1] = line.bbox;
          const top = Math.max(0, Math.round((height - y1) * zoom));
          const left = Math.max(0, Math.round(x0 * zoom));
          const w = Math.max(1, Math.round((x1 - x0) * zoom));
          const h = Math.max(1, Math.round((y1 - y0) * zoom));
          const firstWord = line.words[0];
          const rawFontName = firstWord?.fontName ?? firstWord?.glyphs[0]?.fontName ?? "Helvetica";
          const family = fontKeyToBaseFont.get(rawFontName) ?? rawFontName;
          const rawFontSize = firstWord?.fontSize ?? firstWord?.glyphs[0]?.fontSize ?? 12;
          const scaledSize = Math.max(1, Math.round(rawFontSize * zoom));
          const specKey = `${family}:${scaledSize}`;
          let specId = fontSpecIdByKey.get(specKey);
          if (specId === undefined) {
            specId = fontSpecIdByKey.size;
            fontSpecIdByKey.set(specKey, specId);
            fontSpecLines.push(
              `    <fontspec id="${specId}" size="${scaledSize}" family="${escapeHtmlXml(family)}" color="#000000"/>`
            );
          }
          const matchingLink = annots.find(
            a =>
              a.uri &&
              Math.min(x1, Math.max(a.rect[0], a.rect[2])) > Math.max(x0, Math.min(a.rect[0], a.rect[2])) &&
              Math.min(y1, Math.max(a.rect[1], a.rect[3])) > Math.max(y0, Math.min(a.rect[1], a.rect[3]))
          );
          let styledText = escapeHtmlXml(line.text);
          const lowerFam = family.toLowerCase();
          if (lowerFam.includes("italic") || lowerFam.includes("oblique")) {
            styledText = `<i>${styledText}</i>`;
          }
          if (lowerFam.includes("bold")) {
            styledText = `<b>${styledText}</b>`;
          }
          const innerXmlText = matchingLink?.uri
            ? `<a href="${escapeHtmlXml(matchingLink.uri)}">${styledText}</a>`
            : styledText;
          textLines.push(`    <text top="${top}" left="${left}" width="${w}" height="${h}" font="${specId}">${innerXmlText}</text>`);
        }
      }
      lines.push(...fontSpecLines, ...imageLines, ...textLines);
      lines.push(`  </page>`);
    }
    if (outlineTree.length > 0) {
      const emitXmlOutline = (items: readonly OutlineItem[], indent: string): void => {
        lines.push(`${indent}<outline>`);
        for (const it of items) {
          lines.push(`${indent}  <item page="${it.pageNumber}">${escapeHtmlXml(it.title)}</item>`);
          if (it.children.length > 0) {
            emitXmlOutline(it.children, `${indent}  `);
          }
        }
        lines.push(`${indent}</outline>`);
      };
      emitXmlOutline(outlineTree, "  ");
    }
    lines.push(`</pdf2xml>`);
    outputText = lines.join("\n") + "\n";
  } else {
    const meta = doc.getMetadata();
    const title = escapeHtmlXml(meta.title ?? inputPath);
    const lines = [
      `<!DOCTYPE html>`,
      `<html>`,
      `<head><meta charset="utf-8"/><title>${title}</title></head>`,
      `<body>`
    ];
    for (let p = firstPage; p <= endPage; p++) {
      const page = doc.getPage(p - 1);
      const { width, height } = page.getSize();
      const extracted = page.extractPage();
      const annots = extractPageAnnotations(doc.cos, page.pageDict);
      const pageImages = ignoreImages ? [] : extractDocumentImages(doc.cos, { firstPage: p, lastPage: p });
      lines.push(`<div class="page" id="page${p}" style="position:relative;width:${Math.round(width * zoom)}pt;height:${Math.round(height * zoom)}pt;">`);
      for (let imgIdx = 0; imgIdx < pageImages.length; imgIdx++) {
        const img = pageImages[imgIdx]!;
        const imgBytes = imageFmt === "jpg" ? encodeJpeg(img.bitmap) : encodePng(img.bitmap);
        const imgFile = `page${p}_${imgIdx + 1}.${imageFmt}`;
        if (!dataUrls) {
          files.set(imgFile, imgBytes);
        }
        const mime = imageFmt === "jpg" ? "image/jpeg" : "image/png";
        const src = dataUrls
          ? `data:${mime};base64,${bytesToBase64(imgBytes)}`
          : imgFile;
        lines.push(`  <img src="${src}" width="${img.width}" height="${img.height}"/>`);
      }
      for (const block of extracted.blocks) {
        for (const line of block.lines) {
          const [x0, y0, x1, y1] = line.bbox;
          const top = Math.max(0, Math.round((height - y1) * zoom));
          const left = Math.max(0, Math.round(x0 * zoom));
          const matchingLink = annots.find(
            a =>
              a.uri &&
              Math.min(x1, Math.max(a.rect[0], a.rect[2])) > Math.max(x0, Math.min(a.rect[0], a.rect[2])) &&
              Math.min(y1, Math.max(a.rect[1], a.rect[3])) > Math.max(y0, Math.min(a.rect[1], a.rect[3]))
          );
              const firstWord = line.words[0];
          const rawFontName = firstWord?.fontName ?? firstWord?.glyphs[0]?.fontName ?? "Helvetica";
          const cleanFontKey = rawFontName.startsWith("/") ? rawFontName.slice(1) : rawFontName;
          const resDict = page.getResourcesDict();
          const fontSubDict = resDict ? doc.cos.resolveDict(dictGet(resDict, "Font")) : undefined;
          const fDict = fontSubDict ? doc.cos.resolveDict(dictGet(fontSubDict, cleanFontKey)) : undefined;
          const bfNode = fDict ? doc.cos.resolve(dictGet(fDict, "BaseFont") ?? dictGet(fDict, "Name")) : undefined;
          const family =
            bfNode?.kind === "name"
              ? bfNode.decoded
              : bfNode?.kind === "string"
                ? decodePdfString(bfNode)
                : cleanFontKey;
          const lowerFont = family.toLowerCase();
          let styledHtmlText = escapeHtmlXml(line.text);
          if (lowerFont.includes("italic") || lowerFont.includes("oblique")) {
            styledHtmlText = `<i>${styledHtmlText}</i>`;
          }
          if (lowerFont.includes("bold")) {
            styledHtmlText = `<b>${styledHtmlText}</b>`;
          }
          const innerText = matchingLink?.uri
            ? `<a href="${escapeHtmlXml(matchingLink.uri)}">${styledHtmlText}</a>`
            : styledHtmlText;
          lines.push(`  <p style="position:absolute;top:${top}pt;left:${left}pt;margin:0;">${innerText}</p>`);
        }
      }
      lines.push(`</div>`);
    }
    if (outlineTree.length > 0) {
      lines.push(`<hr/>`, `<a name="outline"></a><h1>Document Outline</h1>`);
      const emitHtmlOutline = (items: readonly OutlineItem[]): void => {
        lines.push(`<ul>`);
        for (const it of items) {
          lines.push(`<li><a href="#page${it.pageNumber}">${escapeHtmlXml(it.title)}</a>`);
          if (it.children.length > 0) {
            emitHtmlOutline(it.children);
          }
          lines.push(`</li>`);
        }
        lines.push(`</ul>`);
      };
      emitHtmlOutline(outlineTree);
    }
    lines.push(`</body>`, `</html>`);
    outputText = lines.join("\n") + "\n";
  }

  outputText = applyPopplerOutputEncoding(outputText, encoding);
  const explicitOut = positionals[1];
  if (toStdout || explicitOut === "-" || (inputPath === "-" && !explicitOut)) {
    return { exitCode: 0, stdout: outputText, stderr: "" };
  }
  const defaultExt = xmlMode ? ".xml" : ".html";
  const inputStem = inputPath.toLowerCase().endsWith(".pdf") ? inputPath.slice(0, -4) : inputPath;
  const outPath = explicitOut
    ? explicitOut.endsWith(".html") || explicitOut.endsWith(".xml")
      ? explicitOut
      : `${explicitOut}${defaultExt}`
    : inputStem + defaultExt;
  files.set(outPath, new TextEncoder().encode(outputText));
  return { exitCode: 0, stdout: "", stderr: "" };
}

export async function pdftohtml(context: CommandContext): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const vfsFiles = new Map<string, Uint8Array>();
    const resolveVfsPath = (p: string) =>
      p.startsWith("/") ? p : `${context.cwd === "/" ? "" : context.cwd}/${p}`;
    let accountedBytes = 0;
    const chargeBytes = (delta: number) => {
      if (delta > 0) {
        accountedBytes += delta;
        context.inputBudget?.check(accountedBytes);
      }
    };

    let inputOperand: string | undefined;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      if (["-f", "-l", "-zoom", "-fmt", "-enc", "-upw", "-opw"].includes(arg)) {
        i++;
      } else if (arg === "-" || !arg.startsWith("-")) {
        inputOperand = arg;
        break;
      }
    }
    if (inputOperand === "-") {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
        chargeBytes(chunk.byteLength);
      }
      if (total > 0) {
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          buf.set(c, off);
          off += c.byteLength;
        }
        vfsFiles.set("-", buf);
      }
    }

    for (const token of argv) {
      if (token.startsWith("-") && token !== "-") continue;
      try {
        const bytes = await context.fs.readFile(resolveVfsPath(token), { signal: invocation.signal });
        chargeBytes(bytes.byteLength);
        vfsFiles.set(token, bytes);
      } catch {
        // Non-existing output path
      }
    }
    const existingSnap = new Map(vfsFiles);
    const res = await runPdftohtmlCli(argv, vfsFiles);
    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdout) {
      const outBytes = new TextEncoder().encode(res.stdout);
      chargeBytes(outBytes.byteLength);
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, outBytes, invocation.signal);
    }
    for (const [key, val] of vfsFiles.entries()) {
      if (existingSnap.get(key) !== val) {
        chargeBytes(val.byteLength);
        const abs = resolveVfsPath(key);
        await context.fs.writeFile(abs, val, { signal: invocation.signal });
      }
    }
    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createPdftohtmlCommand(_options: PdftotextCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdftohtml",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Convert PDF pages into HTML or XML layout documents via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return pdftohtml(context);
    }
  });
}

export const pdftohtmlCommand: CommandDefinition = createPdftohtmlCommand();

export function pdftotextCommands(options: PdftotextCommandOptions = {}): VirtualShellPlugin {
  const command = createPdftotextCommand(options);
  const htmlCmd = createPdftohtmlCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdftotext",
    setup(host) {
      host.commands.register(command, { replace });
      host.commands.register(htmlCmd, { replace });
    }
  };
}
