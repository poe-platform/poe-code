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
  formatExtractedPageText,
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
    eol: "unix",
    invalidEolWarning: false,
    colspacing: 0.7,
    encoding: "UTF-8",
    listenc: false,
    quiet: false,
    version: false,
    help: false
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-f") {
      const val = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(val)) {
        res.error = "Invalid -f page number\n";
        res.errorExitCode = 99;
        return res;
      }
      res.firstPage = val;
    } else if (arg === "-l") {
      const val = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(val)) {
        res.error = "Invalid -l page number\n";
        res.errorExitCode = 99;
        return res;
      }
      res.lastPage = val;
      res.lastPageExplicit = true;
    } else if (arg === "-r") {
      const val = Number.parseFloat(argv[++i] ?? "");
      if (!Number.isFinite(val) || val <= 0) {
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
    } else if (arg === "-eol") {
      const val = argv[++i] ?? "";
      if (val === "unix" || val === "dos" || val === "mac") {
        res.eol = val;
      } else {
        res.invalidEolWarning = true;
      }
    } else if (arg === "-colspacing") {
      const val = Number.parseFloat(argv[++i] ?? "");
      if (!Number.isFinite(val) || val <= 0 || val > 10) {
        res.error = "Command Line Error: Invalid column spacing\n";
        res.errorExitCode = 99;
        return res;
      }
      res.colspacing = val;
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
    res.outputFile = res.inputFile.replace(/\.pdf$/i, "") + ext;
  }
  return res;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function filterExtractedPageByCrop(
  extracted: PdfExtractedPage,
  args: ParsedArgs
): PdfExtractedPage {
  if (
    args.cropX === undefined &&
    args.cropY === undefined &&
    args.cropW === undefined &&
    args.cropH === undefined
  ) {
    return extracted;
  }
  const scale = args.resolution / 72;
  const minX = (args.cropX ?? 0) / scale;
  const minTopY = (args.cropY ?? 0) / scale;
  const maxX = args.cropW !== undefined && args.cropW > 0 ? minX + args.cropW / scale : extracted.width;
  const maxTopY =
    args.cropH !== undefined && args.cropH > 0 ? minTopY + args.cropH / scale : extracted.height;

  const filterWords = (words: readonly PdfTextWord[]): PdfTextWord[] =>
    words.filter((w) => {
      const topY = extracted.height - w.bbox[3];
      const bottomY = extracted.height - w.bbox[1];
      const cx = (w.bbox[0] + w.bbox[2]) / 2;
      const cy = (topY + bottomY) / 2;
      return cx >= minX && cx <= maxX && cy >= minTopY && cy <= maxTopY;
    });

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
  if (args.invalidEolWarning) {
    stderrParts.push("Bad '-eol' value on command line\n");
  }
  if (args.error) {
    return {
      exitCode: args.errorExitCode ?? 99,
      output: "",
      stderr: args.quiet ? "" : stderrParts.join("") + args.error,
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
    const errText = /password|encrypted/i.test(msg)
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
    const rawExtracted = page.extractPage({
      mode,
      rejoinHyphens: mode === "logical"
    });
    pages.push({
      pageNumber: p,
      extracted: filterExtractedPageByCrop(rawExtracted, args)
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
    return {
      exitCode: 0,
      output: renderTsv(pages, args),
      stderr: stderrParts.join(""),
      outputPath: args.outputFile ?? "-"
    };
  }

  const eolChar = args.eol === "dos" ? "\r\n" : args.eol === "mac" ? "\r" : "\n";
  let textOut = "";
  for (const { extracted } of pages) {
    let pageText = formatExtractedPageText(extracted, {
      mode,
      rejoinHyphens: mode === "logical"
    });
    if (eolChar !== "\n") {
      pageText = pageText.replace(/\n/g, eolChar);
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
    output: textOut,
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
    if (inputTarget === "-") {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function runPdftohtmlCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let xmlMode = false;
  let toStdout = false;
  let firstPage = 1;
  let lastPage = 0;
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
    else if (arg === "-f") firstPage = Math.max(1, Number(argv[++i] ?? "1") || 1);
    else if (arg === "-l") lastPage = Math.max(0, Number(argv[++i] ?? "0") || 0);
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (arg === "-s" || arg === "-i" || arg === "-noframes" || arg === "-c" || arg === "-p" || arg === "-q") {
      // Flag options
    } else if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  const inputPath = positionals[0];
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
      lines.push(`  <page number="${p}" position="absolute" top="0" left="0" height="${Math.round(height)}" width="${Math.round(width)}">`);
      lines.push(`    <fontspec id="0" size="12" family="Helvetica" color="#000000"/>`);
      for (const block of extracted.blocks) {
        for (const line of block.lines) {
          const [x0, y0, x1, y1] = line.bbox;
          const top = Math.max(0, Math.round(height - y1));
          const left = Math.max(0, Math.round(x0));
          const w = Math.max(1, Math.round(x1 - x0));
          const h = Math.max(1, Math.round(y1 - y0));
          lines.push(`    <text top="${top}" left="${left}" width="${w}" height="${h}" font="0">${escapeHtmlXml(line.text)}</text>`);
        }
      }
      lines.push(`  </page>`);
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
      lines.push(`<div class="page" id="page${p}" style="position:relative;width:${Math.round(width)}pt;height:${Math.round(height)}pt;">`);
      for (const block of extracted.blocks) {
        for (const line of block.lines) {
          const [x0, , , y1] = line.bbox;
          const top = Math.max(0, Math.round(height - y1));
          const left = Math.max(0, Math.round(x0));
          lines.push(`  <p style="position:absolute;top:${top}pt;left:${left}pt;margin:0;">${escapeHtmlXml(line.text)}</p>`);
        }
      }
      lines.push(`</div>`);
    }
    lines.push(`</body>`, `</html>`);
    outputText = lines.join("\n") + "\n";
  }

  const explicitOut = positionals[1];
  if (toStdout || explicitOut === "-") {
    return { exitCode: 0, stdout: outputText, stderr: "" };
  }
  const defaultExt = xmlMode ? ".xml" : ".html";
  const outPath = explicitOut
    ? explicitOut.endsWith(".html") || explicitOut.endsWith(".xml")
      ? explicitOut
      : `${explicitOut}${defaultExt}`
    : inputPath.replace(/\.pdf$/i, "") + defaultExt;
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

    for (const token of argv) {
      if (token.startsWith("-")) continue;
      try {
        const bytes = await context.fs.readFile(resolveVfsPath(token), { signal: invocation.signal });
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
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }
    for (const [key, val] of vfsFiles.entries()) {
      if (existingSnap.get(key) !== val) {
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
