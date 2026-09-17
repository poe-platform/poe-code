export class ZipFailure extends Error {
  constructor(readonly status: number, readonly label: string, detail: string) { super(detail); }
}

// Native two-character switches take precedence over grouped one-character
// flags. These collisions must fail before enabling delete, move or test.
export const reservedZipShortOptions = new Set(["mm"]);

export const zipLongOptions: Readonly<Record<string, string>> = {
  fifo: "FI", "DOS-names": "k", regex: "RE",
  password: "P", encrypt: "e",
  "difference-archive": "DF", grow: "g", "temp-path": "b", "junk-sfx": "J",
  "logfile-path": "lf", "log-append": "la", "log-info": "li", "unzip-command": "TT",
  verbose: "v", version: "version", license: "L", "show-command": "sc", "show-debug": "sd", "show-files": "sf", "show-options": "so",
  "display-bytes": "db", "display-counts": "dc", "display-dots": "dd", "display-globaldots": "dg", "dot-size": "ds", "display-usize": "du", "display-volume": "dv",
  "recurse-paths": "r", quiet: "q", "junk-paths": "j", paths: "p", help: "h", "more-help": "h2", "no-dir-entries": "D",
  symlinks: "y", test: "T", "names-stdin": "@", update: "u", freshen: "f", filesync: "FS", "archive-comment": "z", "entry-comments": "c", "latest-time": "o", move: "m", "to-crlf": "l",
  "from-crlf": "ll", delete: "d", include: "i", exclude: "x", suffixes: "n", store: "0", "compression-method": "Z",
  "compress-1": "1", "compress-2": "2", "compress-3": "3", "compress-4": "4",
  "compress-5": "5", "compress-6": "6", "compress-7": "7", "compress-8": "8",
  "compress-9": "9", "force-zip64": "fz", "strip-extra": "X", "force-descriptors": "fd", "no-wild": "nw", "wild-stop-dirs": "ws", "recurse-patterns": "R", "from-date": "t", "before-date": "tt", "copy-entries": "U", "output-file": "O", "must-match": "MM",
};

// Include unimplemented Unix options when resolving abbreviations: a partial
// implementation must not make native-ambiguous prefixes uniquely resolvable.
const reservedOptions = [
  "adjust-sfx", "fix", "fixfix",
  "split-size", "split-pause",
  "split-verbose", "split-bell", "show-unicode", "show-just-unicode",
];

export function normalizeZipOption(argument: string): string {
  if (!argument.startsWith("--") || argument === "--") return argument;
  const equal = argument.indexOf("=");
  const rawName = argument.slice(2, equal < 0 ? undefined : equal);
  const negate = rawName.endsWith("-");
  const name = negate ? rawName.slice(0, -1) : rawName;
  const names = [...Object.keys(zipLongOptions), ...reservedOptions];
  const matches = names.includes(name) ? [name] : names.filter(option => option.startsWith(name));
  if (matches.length > 1) throw new ZipFailure(16, "Invalid command arguments", `long option '${name}' ambiguous`);
  const matched = matches[0];
  const short = matched === undefined ? undefined : zipLongOptions[matched];
  if (!short) throw new ZipFailure(16, "Invalid command arguments", `unsupported option: --${name}`);
  if (negate && !zipNegatableOptions.has(short)) throw new ZipFailure(16, "Invalid command arguments", `option ${matched} is not negatable`);
  if (equal >= 0 && short !== "P" && short !== "i" && short !== "x" && short !== "n" && short !== "Z" && short !== "t" && short !== "tt" && short !== "O" && short !== "ds" && short !== "b" && short !== "lf" && short !== "TT") {
    throw new ZipFailure(16, "Invalid command arguments", `option '${matched}' does not allow a value`);
  }
  if (short === "version") return "--version";
  return `-${short}${negate ? "-" : ""}${equal < 0 ? "" : argument.slice(equal)}`;
}

export const zipNegatableOptions = new Set(["FI", "fz", "X", "db", "dc", "dd", "dg", "du", "dv", "sf"]);

export function parseZipDotSize(value: string): number {
  if (!value) return 10 * 1024 * 1024;
  let end = 0;
  while (end < value.length && value[end]! >= "0" && value[end]! <= "9") end++;
  const unit = value.slice(end).toLowerCase();
  const multiplier = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[unit];
  const size = Number(value.slice(0, end)) * (multiplier ?? 0);
  if (!end || value.length > 8 || multiplier === undefined || !Number.isSafeInteger(size)) {
    throw new ZipFailure(16, "Invalid command arguments", "option -ds (--dot-size) has bad size");
  }
  if (size >= 1024 && size < 32 * 1024) throw new ZipFailure(16, "Invalid command arguments", "dot size must be at least 32 KB");
  return size < 1024 ? size * 1024 ** 2 : size;
}

export function zipDisplaySize(size: number): string {
  let unit = 0;
  while (size >= 10240) { size = Math.floor(size / 1024); unit++; }
  const number = size >= 1000 ? (Math.floor(size * 10 / 1024) / 10).toFixed(1) : String(size);
  if (size >= 1000) unit++;
  return `${number}${["", "K", "M", "G", "T"][unit] ?? "T"}`;
}

// Diagnostic arguments can be literal paths as well as options. Never expose
// credentials merely because an option-shaped path follows the -- terminator.
export function zipPasswordArgument(value: string): "attached" | "separate" | undefined {
  if (value.startsWith("--")) {
    const equal = value.indexOf("=");
    const name = value.slice(2, equal < 0 ? undefined : equal);
    if (name.length >= 3 && "password".startsWith(name)) return equal < 0 ? "separate" : "attached";
  } else if (value.startsWith("-")) {
    const password = value.indexOf("P", 1);
    if (password >= 0) return password === value.length - 1 ? "separate" : "attached";
  }
  return undefined;
}

export function zipPublicText(value: string): string {
  const lower = value.toLowerCase();
  if (zipPasswordArgument(value) || lower.includes("password") || lower.includes("token=") || lower.includes("secret=")) return "[redacted]";
  // Special URL schemes can carry credentials even with omitted authority
  // slashes. Refuse those noncanonical forms before displaying path text.
  if (value.includes("://") || ["http:", "https:", "ftp:", "ws:", "wss:"].some(scheme => lower.includes(scheme))) {
    try {
      const url = new URL(value);
      if (!value.startsWith(`${url.protocol}//`)) return "[redacted URL]";
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch { return "[redacted URL]"; }
  }
  return value;
}
