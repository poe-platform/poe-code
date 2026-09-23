import { dirname, resolvePath } from "../../contracts/path.js";
import { SafeJsCommandLimitError, type SafeJsCommandLimits, type SafeJsRunOptions } from "../safejs/types.js";

type Location = { filename: string; line: number; column: number };
type Segment = { column: number; location?: Location };
type Mapper = NonNullable<SafeJsRunOptions<unknown>["sourceLocation"]>;

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeMap(value: unknown, base: string, limits: SafeJsCommandLimits): Segment[][] {
  if (!value || typeof value !== "object") throw new Error("invalid source map");
  const map = value as Record<string, unknown>;
  if (map.version !== 3 || !Array.isArray(map.sources) || !map.sources.every(source => typeof source === "string") ||
    typeof map.mappings !== "string" || map.sourceRoot !== undefined && typeof map.sourceRoot !== "string") throw new Error("invalid source map");
  const sources = map.sources as string[];
  const root = map.sourceRoot as string | undefined;
  const lines: Segment[][] = [];
  const filenames = new Map<number, string>();
  let entries = 0;
  let dataBytes = 0;
  const admit = (bytes = 128): void => {
    if (++entries > limits.arrayLength) throw new SafeJsCommandLimitError("arrayLength");
    if (bytes > limits.dataSize - dataBytes) throw new SafeJsCommandLimitError("dataSize");
    dataBytes += bytes;
  };
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  for (const encodedLine of pieces(map.mappings, ";")) {
    admit();
    const line: Segment[] = [];
    let column = 0;
    for (const encoded of pieces(encodedLine, ",")) {
      if (!encoded) continue;
      admit();
      const fields: number[] = [];
      let number = 0;
      let shift = 0;
      for (const character of encoded) {
        const digit = alphabet.indexOf(character);
        if (digit < 0 || shift > 50) throw new Error("invalid source map VLQ");
        number += (digit & 31) * 2 ** shift;
        if (digit & 32) shift += 5;
        else {
          fields.push(number % 2 ? -Math.floor(number / 2) : Math.floor(number / 2));
          if (fields.length > 5) throw new Error("invalid source map segment");
          number = 0;
          shift = 0;
        }
      }
      if (shift || ![1, 4, 5].includes(fields.length)) throw new Error("invalid source map segment");
      column += fields[0]!;
      if (!Number.isSafeInteger(column) || column < 0 || line.length && column < line[line.length - 1]!.column) throw new Error("invalid source map column");
      if (fields.length === 1) { line.push({ column }); continue; }
      source += fields[1]!;
      originalLine += fields[2]!;
      originalColumn += fields[3]!;
      if (fields.length === 5) {
        name += fields[4]!;
        if (!Array.isArray(map.names) || name < 0 || name >= map.names.length) throw new Error("invalid source map name");
      }
      if (!Number.isSafeInteger(source) || source < 0 || source >= sources.length ||
        !Number.isSafeInteger(originalLine) || originalLine < 0 || !Number.isSafeInteger(originalColumn) || originalColumn < 0) throw new Error("invalid source map position");
      let filename = filenames.get(source);
      if (filename === undefined) {
        const path = sources[source]!;
        const length = base.length + (root?.length ?? 0) + path.length + 1;
        if (length > limits.stringLength) throw new SafeJsCommandLimitError("stringLength");
        admit(128 + length * 2);
        const rooted = (root ?? "") + path;
        filename = rooted.includes(":") ? rooted : resolvePath(base, rooted);
        filenames.set(source, filename);
      }
      line.push({ column, location: { filename, line: originalLine + 1, column: originalColumn + 1 } });
    }
    lines.push(line);
  }
  return lines;
}

function* pieces(text: string, delimiter: string): Generator<string> {
  let start = 0;
  for (;;) {
    const end = text.indexOf(delimiter, start);
    yield text.slice(start, end < 0 ? text.length : end);
    if (end < 0) return;
    start = end + 1;
  }
}

// Scan comments while skipping quoted text so a guest string cannot select a map.
function mapReference(source: string): string | undefined {
  let reference: string | undefined;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === "\"" || character === "'" || character === "`") {
      const quote = character;
      while (++index < source.length) {
        if (source[index] === "\\") index++;
        else if (source[index] === quote) break;
      }
      continue;
    }
    if (character !== "/") continue;
    if (!["/", "*"].includes(source[index + 1]!)) {
      let previous = index - 1;
      while (previous >= 0 && source[previous]!.trim() === "") previous--;
      const before = source[previous];
      let wordStart = previous;
      while (wordStart >= 0 && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(source[wordStart]!)) wordStart--;
      const word = source.slice(wordStart + 1, previous + 1);
      if (before !== undefined && !"=(:,[!&|?;{}".includes(before) && !["return", "throw", "case", "yield", "await"].includes(word)) continue;
      let bracket = false;
      while (++index < source.length) {
        if (source[index] === "\\") index++;
        else if (source[index] === "[") bracket = true;
        else if (source[index] === "]") bracket = false;
        else if (source[index] === "/" && !bracket) break;
      }
      continue;
    }
    const block = source[index + 1] === "*";
    const start = index + 2;
    const end = source.indexOf(block ? "*/" : "\n", start);
    const body = source.slice(start, end < 0 ? source.length : end).trim();
    if (body.startsWith("#") || body.startsWith("@")) {
      const directive = body.slice(1).trim();
      if (directive.startsWith("sourceMappingURL=")) reference = directive.slice(17).trim();
    }
    index = end < 0 ? source.length : end + (block ? 1 : 0);
  }
  return reference;
}

export async function nodeSourceLocation(source: string, filename: string, cwd: string, prefix: string,
  readSource: (path: string) => Promise<string>, signal: AbortSignal, limits: SafeJsCommandLimits): Promise<Mapper> {
  const offset = prefix.split("\n").length - 1;
  const base = filename.startsWith("<") || filename === "-" ? cwd : dirname(filename);
  let lines: Segment[][] | undefined;
  const reference = mapReference(source);
  if (reference) {
    try {
      let json: string;
      let mapBase = base;
      if (reference.startsWith("data:")) {
        const comma = reference.indexOf(",");
        if (comma < 0) throw new Error("invalid source map data URI");
        const header = reference.slice(0, comma);
        const payload = reference.slice(comma + 1);
        json = header.endsWith(";base64") ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
      } else {
        // Never fetch remote maps or escape the caller's explicit VFS through host paths.
        if (reference.includes(":") || reference.startsWith("//")) throw new Error("unsupported source map URL");
        const path = resolvePath(base, decodeURIComponent(reference));
        mapBase = dirname(path);
        json = await readSource(path);
      }
      signal.throwIfAborted();
      lines = decodeMap(JSON.parse(json), mapBase, limits);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof SafeJsCommandLimitError) throw error;
      // Node also ignores unavailable or invalid maps and keeps generated locations.
    }
  }
  return position => {
    const line = position.line - offset;
    if (line < 1) return undefined;
    const segments = lines?.[line - 1];
    let low = 0;
    let high = segments?.length ?? 0;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (segments![middle]!.column <= position.column - 1) low = middle + 1;
      else high = middle;
    }
    return (low ? segments![low - 1]!.location : undefined) ?? { filename, line, column: position.column };
  };
}
