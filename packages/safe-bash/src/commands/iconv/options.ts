import { Budget, IconvError } from "./internal.js";

export type Encoding = "ascii" | "latin1" | "utf8" | "utf16" | "utf16le" | "utf16be";
export interface Parsed {
  readonly from: Encoding;
  readonly to: Encoding;
  readonly discard: boolean;
  readonly transliterate: boolean;
  readonly verbose: boolean;
  readonly output: string | undefined;
  readonly files: readonly string[];
}

const aliases: Record<string, Encoding> = {
  ASCII: "ascii", "US-ASCII": "ascii", "ANSI_X3.4-1968": "ascii",
  LATIN1: "latin1", "LATIN-1": "latin1", "ISO-8859-1": "latin1", "ISO8859-1": "latin1",
  UTF8: "utf8", "UTF-8": "utf8", UTF16: "utf16", "UTF-16": "utf16",
  UTF16LE: "utf16le", "UTF-16LE": "utf16le", UTF16BE: "utf16be", "UTF-16BE": "utf16be",
};

function encoding(value: string): Encoding {
  const key = value.toUpperCase();
  if (key.includes("//")) throw new IconvError(`unsupported encoding suffix: ${value}`);
  const result = Object.hasOwn(aliases, key) ? aliases[key] : undefined;
  if (!result) throw new IconvError(`unsupported encoding: ${value}`);
  return result;
}

const usage = "Usage: iconv [-lcs?V] [-f NAME] [-t NAME] [-o FILE] [--from-code=NAME]\n" +
  "             [--to-code=NAME] [--list] [--output=FILE] [--silent] [--verbose]\n" +
  "             [--help] [--usage] [--version] [FILE...]\n";
const information: Record<string, string> = {
  l: Object.keys(aliases).sort().map(name => `${name}//\n`).join(""),
  "?": usage + "Convert text using the safe-bash bounded encoding engine.\n" +
    "  -f, --from-code=NAME  input encoding\n  -t, --to-code=NAME    output encoding\n" +
    "  -l, --list            list supported encodings and aliases\n" +
    "  -c                    omit invalid characters\n  -o, --output=FILE     virtual output file (- for stdout)\n" +
    "  -s, --silent          suppress warnings\n      --verbose         report input operands\n" +
    "  -?, --help            show help\n      --usage           show usage\n  -V, --version         show engine identity\n",
  V: "iconv (safe-bash bounded encoding engine)\n",
};

export function parse(budget: Budget): Parsed | { readonly information: string } {
  const args = budget.arguments();
  let from: string | undefined, to: string | undefined, output: string | undefined, discard = false, ended = false;
  let verbose = false;
  const files: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    budget.charge(argument.length + 1);
    if (ended || argument === "-" || !argument.startsWith("-")) { files.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    if (argument === "--list") return { information: information.l! };
    if (argument === "--help") return { information: information["?"]! };
    if (argument === "--version") return { information: information.V! };
    if (argument === "--usage") return { information: usage };
    if (argument === "--silent") continue;
    if (argument === "--verbose") { verbose = true; continue; }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const option = equals < 0 ? argument : argument.slice(0, equals);
      if (option !== "--from-code" && option !== "--to-code" && option !== "--output") throw new IconvError(`unsupported option: ${argument}`, 64);
      const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
      if (value === undefined) throw new IconvError(`option '${option}' requires an argument`, 64);
      if (option === "--from-code") from = value;
      else if (option === "--to-code") to = value;
      else output = value;
      continue;
    }
    for (let offset = 1; offset < argument.length; offset++) {
      const flag = argument[offset]!;
      if (Object.hasOwn(information, flag)) return { information: information[flag]! };
      if (flag === "c") { discard = true; continue; }
      if (flag === "s") continue;
      if (flag !== "f" && flag !== "t" && flag !== "o") throw new IconvError(`invalid option -- '${flag}'`, 64);
      const value = argument.slice(offset + 1) || args[++index];
      if (value === undefined) throw new IconvError(`option requires an argument -- '${flag}'`, 64);
      if (flag === "f") from = value;
      else if (flag === "t") to = value;
      else output = value;
      break;
    }
  }
  const transliterate = to?.toUpperCase().endsWith("//TRANSLIT") ?? false;
  if (transliterate) to = to!.slice(0, -10);
  if (from === undefined || to === undefined || transliterate) {
    const env = budget.context.env;
    budget.assertOpen();
    let locale = "";
    for (const name of ["LC_ALL", "LC_CTYPE", "LANG"]) {
      locale = env[name] || "";
      budget.assertOpen();
      budget.check(locale.length, budget.limits.maxArgumentBytes, "locale bytes");
      budget.charge(locale.length + 1);
      if (locale) break;
    }
    locale ||= "C";
    if (transliterate && locale !== "C" && locale !== "POSIX") throw new IconvError(`unsupported transliteration locale: ${locale}; supported: C, POSIX, or unset`);
    let fallback: string;
    if (locale === "C" || locale === "POSIX") fallback = "ASCII";
    else if (locale === "C.UTF-8" || locale === "C.utf8") fallback = "UTF-8";
    else throw new IconvError(`unsupported default encoding locale: ${locale}; specify -f and -t`);
    from ??= fallback; to ??= fallback;
  }
  return { from: encoding(from), to: encoding(to), discard, transliterate, files: files.length ? files : ["-"], output, verbose };
}
