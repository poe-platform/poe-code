export interface HtmlToMarkdownLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxTokenBytes: number;
  readonly maxTokens: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxAttributes: number;
  readonly maxTableCells: number;
  readonly maxTableCellBytes: number;
  readonly maxFiles: number;
  readonly maxArgumentBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxWorkUnits: number;
}

export interface HtmlToMarkdownCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<HtmlToMarkdownLimits>;
}

export class HtmlUsageError extends Error {}

export function settings(options: HtmlToMarkdownCommandsOptions): HtmlToMarkdownLimits {
  const result: HtmlToMarkdownLimits = {
    maxInputBytes: Infinity, maxOutputBytes: Infinity,
    maxTokenBytes: Infinity, maxTokens: Infinity, maxNodes: Infinity, maxDepth: Infinity,
    maxAttributes: Infinity, maxTableCells: Infinity, maxTableCellBytes: Infinity,
    maxFiles: Infinity, maxArgumentBytes: Infinity, maxDiagnosticBytes: Infinity,
    maxWorkUnits: Infinity, ...options.limits,
  };
  for (const [name, value] of Object.entries(result)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) {
      throw new RangeError(`Invalid html-to-markdown limit: ${name}`);
    }
  }
  return Object.freeze(result);
}

export function argumentsFor(args: readonly string[], limits: HtmlToMarkdownLimits): { files: readonly string[]; info?: string } {
  let bytes = 0, literal = false;
  const files: string[] = [];
  if (args.length > limits.maxArgumentBytes) throw new HtmlUsageError("argument count limit exceeded");
  for (const argument of args) {
    if (argument.length > limits.maxArgumentBytes - bytes) throw new HtmlUsageError("argument limit exceeded");
    bytes += Buffer.byteLength(argument);
    if (bytes > limits.maxArgumentBytes || argument.includes("\0")) throw new HtmlUsageError("invalid or oversized argument");
    if (!literal && argument === "--") { literal = true; continue; }
    if (!literal && argument === "--help") return { files: [], info: helpText };
    if (!literal && argument === "--version") return { files: [], info: "html-to-markdown (safe-bash bounded HTML profile)\n" };
    if (!literal && argument.startsWith("-") && argument !== "-") throw new HtmlUsageError(`unknown option: ${argument}`);
    if (!argument) throw new HtmlUsageError("empty file operand");
    if (files.length >= limits.maxFiles) throw new HtmlUsageError("file limit exceeded");
    files.push(argument);
  }
  return { files: files.length ? files : ["-"] };
}

export const helpText = `Usage: html-to-markdown [--] [FILE|-] ...
Read VFS files or shared stdin; write bounded Markdown to stdout.
Supports headings, paragraphs, emphasis, links/images, lists, quotes, code and tables.
Drops scripts/styles/comments; unknown elements retain text. No fetching or execution.
This documented HTML subset is a converter, not a sanitizer or browser HTML5 parser.
`;
