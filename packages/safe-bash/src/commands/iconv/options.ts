import { Budget, IconvError } from "./internal.js";

export type Encoding = "ascii" | "latin1" | "utf8" | "utf16" | "utf16le" | "utf16be";
export interface Parsed {
  readonly from: Encoding;
  readonly to: Encoding;
  readonly discard: boolean;
  readonly transliterate: boolean;
  readonly files: readonly string[];
}

function encoding(value: string): Encoding {
  const key = value.toUpperCase();
  const aliases: Record<string, Encoding> = {
    ASCII: "ascii", "US-ASCII": "ascii", "ANSI_X3.4-1968": "ascii",
    LATIN1: "latin1", "LATIN-1": "latin1", "ISO-8859-1": "latin1", "ISO8859-1": "latin1",
    UTF8: "utf8", "UTF-8": "utf8", UTF16: "utf16", "UTF-16": "utf16",
    UTF16LE: "utf16le", "UTF-16LE": "utf16le", UTF16BE: "utf16be", "UTF-16BE": "utf16be",
  };
  if (key.includes("//")) throw new IconvError(`unsupported encoding suffix: ${value}`);
  const result = Object.hasOwn(aliases, key) ? aliases[key] : undefined;
  if (!result) throw new IconvError(`unsupported encoding: ${value}`);
  return result;
}

export function parse(budget: Budget): Parsed {
  const args = budget.arguments();
  let from: string | undefined, to: string | undefined, discard = false, ended = false;
  const files: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    budget.charge(argument.length + 1);
    if (ended || argument === "-" || !argument.startsWith("-")) { files.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    if (argument.startsWith("--")) throw new IconvError(`unsupported option: ${argument}`, 64);
    for (let offset = 1; offset < argument.length; offset++) {
      const flag = argument[offset]!;
      if (flag === "c") { discard = true; continue; }
      if (flag !== "f" && flag !== "t") throw new IconvError(`invalid option -- '${flag}'`, 64);
      const value = argument.slice(offset + 1) || args[++index];
      if (value === undefined) throw new IconvError(`option requires an argument -- '${flag}'`, 64);
      if (flag === "f") from = value; else to = value;
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
  return { from: encoding(from), to: encoding(to), discard, transliterate, files: files.length ? files : ["-"] };
}
