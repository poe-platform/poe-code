import { ToolError } from "./shared.js";

export function decodeHeaderPath(value: string): string {
  if (!value.startsWith('"')) return value.split("\t", 1)[0]!;
  if (value.length > 16_384) throw new ToolError("quoted path length limit exceeded");
  const bytes: number[] = [];
  const escapes: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  let index = 1;
  while (index < value.length) {
    const character = value[index++]!;
    if (character === '"') {
      if (index < value.length && value[index] !== "\t") throw new ToolError("unexpected text after quoted filename");
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes)); }
      catch { throw new ToolError("invalid UTF-8 in quoted filename"); }
    }
    if (character === "\\") {
      const escaped = value[index++]!;
      if (/[0-7]/u.test(escaped ?? "")) {
        const octal = value.slice(index - 1, index + 2);
        if (!/^[0-7]{3}$/u.test(octal) || parseInt(octal, 8) > 255) throw new ToolError("invalid octal filename escape");
        bytes.push(parseInt(octal, 8));
        index += 2;
      } else {
        const byte = escapes[escaped];
        if (byte === undefined) throw new ToolError("invalid quoted filename escape");
        bytes.push(byte);
      }
    } else {
      const point = value.codePointAt(index - 1)!;
      const literal = String.fromCodePoint(point);
      bytes.push(...Buffer.from(literal));
      index += literal.length - 1;
    }
  }
  throw new ToolError("unterminated quoted filename");
}

export function safeTarget(path: string, strip: number, allowAbsolute = false): string | undefined {
  if (path === "/dev/null") return undefined;
  if (path.length > 4096 || path.split("/").length > 256) throw new ToolError("path length/depth limit exceeded");
  if (!path || (!allowAbsolute && path.startsWith("/")) || /[\\\0-\x08\x0a-\x1f\x7f]/u.test(path)) throw new ToolError(`unsafe patch path: ${JSON.stringify(path)}`);
  const parts = path.split(/\/+/u);
  if (parts.some(part => part === ".." || /^[A-Za-z]:/u.test(part))) throw new ToolError(`unsafe patch path: ${JSON.stringify(path)}`);
  if (path.endsWith("/") || parts.at(-1) === ".") throw new ToolError(`patch path names a directory: ${JSON.stringify(path)}`);
  const stripped = parts.filter(Boolean).slice(strip).filter(part => part !== ".").join("/");
  if (!stripped) throw new ToolError(`strip count removes entire patch path: ${path}`);
  return allowAbsolute && path.startsWith("/") && strip === 0 ? `/${stripped}` : stripped;
}

export function isEpochHeader(line: string): boolean {
  const separator = line.lastIndexOf("\t");
  if (separator < 0) return false;
  let timestamp = line.slice(separator + 1).trim();
  const traditional = /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +([0-9]{1,2}) (\d{2}:\d{2}:\d{2}) (\d{4})(?: (UTC|GMT|[+-]\d{4}))?$/u.exec(timestamp);
  if (traditional) {
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(traditional[1]!) + 1;
    timestamp = `${traditional[4]}-${String(month).padStart(2, "0")}-${traditional[2]!.padStart(2, "0")} ${traditional[3]} ${traditional[5] ?? "+0000"}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}))?$/u.exec(timestamp);
  if (!match) return false;
  const iso = `${match[1]}T${match[2]}`;
  const local = Date.parse(`${iso}Z`);
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== iso) return false;
  const zone = match[4];
  let offset = 0;
  if (zone && /^[+-]/u.test(zone)) {
    const digits = zone.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2));
    if (hours > 25 || minutes > 59) return false;
    offset = (hours * 60 + minutes) * 60 * (zone[0] === "+" ? 1 : -1);
  }
  const seconds = local / 1000 - offset;
  const fractional = match[3] !== undefined && /[1-9]/u.test(match[3]);
  return (seconds > -25 * 3600 || (seconds === -25 * 3600 && fractional)) && seconds < 26 * 3600;
}
