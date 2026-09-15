import { fail, type ArchiveLimits } from "../internal.js";

function whitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\v" || character === "\f";
}

export function zipEnvironmentArguments(env: Readonly<Record<string, string>>, argv: readonly string[], limits: ArchiveLimits): readonly string[] {
  let value = "";
  let selectedBytes = 0;
  for (const key of ["ZIPOPT", "ZIP_OPTS"]) {
    const candidate = env[key] ?? "";
    if (Buffer.byteLength(candidate) > limits.maxArgumentBytes) fail("environment argument byte limit exceeded");
    let start = 0;
    while (whitespace(candidate[start])) start++;
    if (start < candidate.length) { value = candidate.slice(start); selectedBytes = Buffer.byteLength(candidate); break; }
  }
  if (!value) return argv;
  if (value.includes("\0") || Buffer.from(value).toString("utf8") !== value) fail("invalid environment argument text");
  let bytes = selectedBytes;
  for (const argument of argv) {
    bytes += Buffer.byteLength(argument);
    if (bytes > limits.maxArgumentBytes) fail("argument byte limit exceeded");
  }
  const defaults: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    let argument = "";
    if (value[offset] === '"') {
      offset++;
      while (offset < value.length && value[offset] !== '"') {
        if (value[offset] === "\\") {
          offset++;
          if (offset === value.length) break;
        }
        argument += value[offset++]!;
      }
      if (value[offset] === '"') offset++;
    } else {
      const start = offset;
      while (offset < value.length && !whitespace(value[offset])) offset++;
      argument = value.slice(start, offset);
    }
    if (defaults.length + argv.length >= limits.maxArgumentBytes) fail("argument count limit exceeded");
    defaults.push(argument);
    while (whitespace(value[offset])) offset++;
  }
  return [...defaults, ...argv];
}
