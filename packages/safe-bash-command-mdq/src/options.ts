export interface MdqOptions {
  readonly selectors?: string;
  readonly files?: readonly string[];
  readonly output?: "markdown" | "md" | "json" | "plain";
  readonly linkPos?: "section" | "doc";
  readonly footnotePos?: "section" | "doc";
  readonly linkFormat?: "keep" | "inline" | "never-inline";
  readonly renumberFootnotes?: boolean;
  readonly wrapWidth?: number;
  readonly quiet?: boolean;
  readonly breaks?: boolean;
  readonly allowUnknownMarkdown?: boolean;
}
export interface Arguments {
  selectors: string; files: string[]; output: "markdown" | "md" | "json" | "plain";
  linkPos: "section" | "doc"; footnotePos: "section" | "doc";
  linkFormat: "keep" | "inline" | "never-inline"; renumberFootnotes: boolean;
  wrapWidth?: number; quiet: boolean; breaks: boolean; allowUnknownMarkdown: boolean;
  information?: "help" | "shortHelp" | "version";
}
export class MdqError extends Error {
  constructor(message: string, readonly exitCode = 1) { super(message); }
}
const usage = "Usage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...";
export function argumentError(message: string, status = 2, usageLine: string | undefined = usage): never {
  throw new MdqError(`error: ${message}\n\n${usageLine ? usageLine + "\n\n" : ""}For more information, try '--help'.\n`, status);
}
export function optionsArgv(options: MdqOptions): Iterable<string> & { readonly length: number } {
  const args: string[] = [];
  for (const [key, flag] of Object.entries({ output: "output", linkPos: "link-pos", footnotePos: "footnote-pos", linkFormat: "link-format", renumberFootnotes: "renumber-footnotes", wrapWidth: "wrap-width" })) {
    const value = options[key as keyof MdqOptions];
    if (value !== undefined) args.push(`--${flag}`, String(value));
  }
  if (options.quiet) args.push("--quiet");
  if (options.allowUnknownMarkdown) args.push("--allow-unknown-markdown");
  if (options.breaks !== undefined) args.push(options.breaks ? "--br" : "--no-br");
  const selectors = options.selectors ?? "", files = options.files ?? [];
  return {
    length: args.length + 2 + files.length,
    *[Symbol.iterator]() { yield* args; yield "--"; yield selectors; yield* files; }
  };
}
function suggestion(value: string, choices: readonly string[]): string | undefined {
  let best: string | undefined, score = 0.7;
  for (const candidate of choices) {
    // Jaro similarity cannot exceed 0.7 beyond this length ratio. This also
    // bounds suggestions for an oversized invalid option to fixed flag lengths.
    if (value.length > candidate.length * 10 || candidate.length > value.length * 10) continue;
    const range = Math.max(0, Math.floor(Math.max(value.length, candidate.length) / 2) - 1);
    const left = new Set<number>(), right = new Set<number>();
    for (let i = 0; i < value.length; i++) for (let j = Math.max(0, i - range); j < Math.min(candidate.length, i + range + 1); j++) {
      if (right.has(j) || value[i] !== candidate[j]) continue;
      left.add(i); right.add(j); break;
    }
    if (!left.size) continue;
    const a = [...left].sort((x, y) => x - y), b = [...right].sort((x, y) => x - y);
    const swaps = a.reduce((total, at, i) => total + (value[at] === candidate[b[i]!] ? 0 : 1), 0) / 2;
    const similarity = (left.size / value.length + left.size / candidate.length + (left.size - swaps) / left.size) / 3;
    if (similarity > score) { score = similarity; best = candidate; }
  }
  return best;
}
export function parseMdqArguments(argv: readonly string[]): Arguments {
  const out: Arguments = { selectors: "", files: [], output: "markdown", linkPos: "section", footnotePos: "section", linkFormat: "never-inline", renumberFootnotes: true, quiet: false, breaks: true, allowUnknownMarkdown: false };
  let positional = false, selector = false, listSelector = false, breaks: boolean | undefined, footnote = false;
  const seen = new Set<string>();
  const flags: Record<string, { key: keyof Arguments; values?: readonly string[] }> = {
    "link-pos": { key: "linkPos", values: ["section", "doc"] },
    "footnote-pos": { key: "footnotePos", values: ["section", "doc"] },
    "link-format": { key: "linkFormat", values: ["keep", "inline", "never-inline"] },
    "renumber-footnotes": { key: "renumberFootnotes", values: ["true", "false"] },
    "output": { key: "output", values: ["markdown", "md", "json", "plain"] },
    "wrap-width": { key: "wrapWidth" }
  };
  const booleans = ["quiet", "br", "no-br", "allow-unknown-markdown", "[no]-br", "help", "version"];
  const shortNames: Record<string, string> = { o: "output", l: "link-format", q: "quiet", h: "help", V: "version", " ": "list-selector" };
  const display = (flag: string): string => flag === "list-selector" ? "-  <selectors starting with list>" : `--${flag}${flags[flag] ? ` <${flag.toUpperCase().split("-").join("_")}>` : ""}`;
  const unknown = (arg: string): never => {
    const similar = arg.startsWith("--") ? suggestion(arg.slice(2), [...Object.keys(flags), ...booleans]) : undefined;
    const tip = similar ? `a similar argument exists: '--${similar}'` : `to pass '${arg}' as a value, use '-- ${arg}'`;
    const used = [...Object.keys(flags), "quiet"].filter(flag => seen.has(flag));
    if (similar && !used.includes(similar)) used.push(similar);
    const prefix = used.length ? used.map(display).join(" ") + " " : selector ? "" : "[OPTIONS] ";
    const usageLine = `Usage: mdq ${prefix}${selector ? "<selectors>" : "[selectors]"} [MARKDOWN_FILE_PATHS]...`;
    argumentError(`unexpected argument '${arg}' found\n\n  tip: ${tip}`, 2, usageLine);
  };
  const knownOption = (arg: string): boolean => arg.startsWith("--") ? booleans.includes(arg.slice(2).split("=")[0]!) || Object.hasOwn(flags, arg.slice(2).split("=")[0]!) : Object.hasOwn(shortNames, arg[1] ?? "");
  const missing = (flag: string): never => {
    const values = flags[flag]?.values;
    argumentError(`a value is required for '${display(flag)}' but none was supplied${values ? "\n  [possible values: " + values.join(", ") + "]" : ""}`, 2, "");
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!positional && arg === "--") { positional = true; continue; }
    if (!positional && arg.startsWith("-") && arg !== "-") {
      const long = arg.startsWith("--"), equals = arg.indexOf("=");
      for (let offset = 1; offset < arg.length; offset++) {
        const flag = long ? arg.slice(2, equals < 0 ? undefined : equals) : shortNames[arg[offset]!];
        if (flag === undefined || !Object.hasOwn(flags, flag) && !booleans.includes(flag) && flag !== "list-selector") unknown(long ? arg.slice(0, equals < 0 ? undefined : equals) : "-" + arg[offset]!);
        const spec = flags[flag!];
        const tail = long ? undefined : arg.slice(offset + 1);
        const attached = long ? (equals < 0 ? undefined : arg.slice(equals + 1)) : spec || flag === "list-selector" ? (tail ? tail.startsWith("=") ? tail.slice(1) : tail : undefined) : undefined;
        if (!spec && flag !== "list-selector") {
          if (attached !== undefined) {
            let usageLine = `Usage: mdq --${flag} [selectors] [MARKDOWN_FILE_PATHS]...`;
            if (booleans.some(flag => seen.has(flag))) {
              const group = [...Object.keys(flags), "quiet", "allow-unknown-markdown", "[no]-br", "br", "no-br", "list-selector"].map(display);
              group.push("selectors", "MARKDOWN_FILE_PATHS");
              usageLine = `Usage: mdq ${flag === "help" || flag === "version" ? `--${flag} ` : ""}<${group.join("|")}>`;
            }
            argumentError(`unexpected value '${attached}' for '--${flag}' found; no more were expected`, 2, usageLine);
          }
          if (flag === "help" || flag === "version") { out.information = flag === "help" && !long ? "shortHelp" : flag; return out; }
          if (seen.has(flag!)) argumentError(`the argument '${display(flag!)}' cannot be used multiple times`);
          if ((flag === "br" && seen.has("no-br")) || (flag === "no-br" && seen.has("br"))) argumentError(`the argument '--${flag === "br" ? "no-br" : "br"}' cannot be used with '--${flag}'`);
          seen.add(flag!);
          if (flag === "quiet") out.quiet = true;
          else if (flag === "allow-unknown-markdown") out.allowUnknownMarkdown = true;
          else if (flag === "br" || flag === "no-br") breaks = flag === "br";
          if (long) break;
          continue;
        }
        let value = attached;
        if (value === undefined) {
          const next = argv[i + 1];
          if (next === undefined || next === "--") missing(flag!);
          if (next!.startsWith("-") && next !== "-") {
            if (knownOption(next!)) missing(flag!);
            unknown(next!.startsWith("--") ? next!.split("=")[0]! : next!.slice(0, 2));
          }
          value = next!; i++;
        }
        if (seen.has(flag!)) argumentError(`the argument '${display(flag!)}' cannot be used multiple times`);
        seen.add(flag!);
        if (flag === "list-selector") {
          if (selector) argumentError("the argument '[selectors]' cannot be used with '-  <selectors starting with list>'");
          listSelector = true; out.selectors = "- " + value; break;
        }
        if (spec!.values && !spec!.values.includes(value)) {
          const similar = suggestion(value, spec!.values);
          argumentError(`invalid value '${value}' for '${display(flag!)}'\n  [possible values: ${spec!.values.join(", ")}]${similar ? "\n\n  tip: a similar value exists: '" + similar + "'" : ""}`, 2, "");
        }
        if (flag === "wrap-width") {
          const digits = value.startsWith("+") ? value.slice(1) : value;
          const error = !value ? "cannot parse integer from empty string" : !digits || [...digits].some(c => c < "0" || c > "9") ? "invalid digit found in string" : BigInt(digits) > 18446744073709551615n ? "number too large to fit in target type" : undefined;
          if (error) argumentError(`invalid value '${value}' for '${display(flag)}': ${error}`, 2, "");
          out.wrapWidth = Number(value);
        } else if (flag === "renumber-footnotes") out.renumberFootnotes = value === "true";
        else (out as unknown as Record<string, unknown>)[spec!.key] = value;
        if (flag === "footnote-pos") footnote = true;
        break;
      }
      continue;
    }
    if (!selector) {
      if (listSelector) argumentError("the argument '-  <selectors starting with list>' cannot be used with '[selectors]'");
      out.selectors = arg; selector = true;
    }
    else out.files.push(arg);
  }
  if (out.output === "json" && out.wrapWidth !== undefined) argumentError("Can't set text width with JSON output format", 1);
  if (seen.has("[no]-br")) argumentError("invalid argument '--[no]-br'; use '--br' or '--no-br'.", 1);
  if (!footnote) out.footnotePos = out.linkPos;
  out.breaks = breaks ?? (out.output === "markdown" || out.output === "md");
  return out;
}
