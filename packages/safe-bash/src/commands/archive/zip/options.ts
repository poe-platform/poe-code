export class ZipFailure extends Error {
  constructor(readonly status: number, readonly label: string, detail: string) { super(detail); }
}

const longOptions: Readonly<Record<string, string>> = {
  "recurse-paths": "r", quiet: "q", "junk-paths": "j", "no-dir-entries": "D",
  symlinks: "y", test: "T", "names-stdin": "@", update: "u", freshen: "f", filesync: "FS",
  delete: "d", include: "i", exclude: "x", suffixes: "n", store: "0", "compression-method": "Z",
  "compress-1": "1", "compress-2": "2", "compress-3": "3", "compress-4": "4",
  "compress-5": "5", "compress-6": "6", "compress-7": "7", "compress-8": "8",
  "compress-9": "9", "force-zip64": "fz", "strip-extra": "X", "force-descriptors": "fd", "no-wild": "nw", "wild-stop-dirs": "ws", "recurse-patterns": "R", "from-date": "t", "before-date": "tt", "copy-entries": "U", "output-file": "O", "must-match": "MM",
};

// Include unimplemented Unix options when resolving abbreviations: a partial
// implementation must not make native-ambiguous prefixes uniquely resolvable.
const reservedOptions = [
  "adjust-sfx", "temp-path", "entry-comments", "display-bytes", "display-counts",
  "display-dots", "display-globaldots", "dot-size", "display-usize", "display-volume",
  "difference-archive", "encrypt", "fix", "fixfix", "fifo",
  "grow", "help", "more-help", "junk-sfx",
  "DOS-names", "to-crlf", "from-crlf", "logfile-path", "log-append", "log-info",
  "license", "move", "latest-time",
  "paths", "password", "regex", "split-size", "split-pause",
  "split-verbose", "split-bell", "show-command", "show-debug", "show-files",
  "show-options", "unzip-command",
  "verbose", "version", "archive-comment",
];

export function normalizeZipOption(argument: string): string {
  if (!argument.startsWith("--") || argument === "--") return argument;
  const equal = argument.indexOf("=");
  const rawName = argument.slice(2, equal < 0 ? undefined : equal);
  const negate = rawName.endsWith("-");
  const name = negate ? rawName.slice(0, -1) : rawName;
  const names = [...Object.keys(longOptions), ...reservedOptions];
  const matches = names.includes(name) ? [name] : names.filter(option => option.startsWith(name));
  if (matches.length > 1) throw new ZipFailure(16, "Invalid command arguments", `long option '${name}' ambiguous`);
  const matched = matches[0];
  const short = matched === undefined ? undefined : longOptions[matched];
  if (!short) throw new ZipFailure(16, "Invalid command arguments", `unsupported option: ${argument}`);
  if (negate && short !== "fz" && short !== "X") throw new ZipFailure(16, "Invalid command arguments", `option ${matched} is not negatable`);
  if (equal >= 0 && short !== "i" && short !== "x" && short !== "n" && short !== "Z" && short !== "t" && short !== "tt" && short !== "O") {
    throw new ZipFailure(16, "Invalid command arguments", `option '${matched}' does not allow a value`);
  }
  return `-${short}${negate ? "-" : ""}${equal < 0 ? "" : argument.slice(equal)}`;
}
