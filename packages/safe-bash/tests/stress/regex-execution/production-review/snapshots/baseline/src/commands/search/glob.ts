import { SearchError } from "./options.js";

const quote = (character: string) => character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");

function compile(source: string, literalUnclosedClass: boolean): string {
  let output = "";
  let braces = 0;
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset]!;
    if (character === "\\") {
      const next = source[++offset];
      if (next === undefined) throw new SearchError("trailing glob escape");
      output += quote(next);
    } else if (character === "*") {
      if (source[offset + 1] === "*") {
        while (source[offset + 1] === "*") offset++;
        if (source[offset + 1] === "/") { offset++; output += "(?:.*/)?"; }
        else output += ".*";
      } else output += "[^/]*";
    } else if (character === "?") output += "[^/]";
    else if (character === "[") {
      const opening = offset;
      let contents = "";
      if (source[offset + 1] === "!" || source[offset + 1] === "^") { contents = "^"; offset++; }
      let closed = false;
      while (++offset < source.length) {
        if (source[offset] === "]" && contents !== "" && contents !== "^") { closed = true; break; }
        contents += source[offset] === "\\" ? "\\\\" : source[offset] === "]" ? "\\]" : source[offset];
      }
      if (!closed) {
        if (!literalUnclosedClass) throw new SearchError("unclosed glob character class");
        output += "\\["; offset = opening; continue;
      }
      output += `[${contents}]`;
    } else if (character === "{") {
      if (++braces > 8) throw new SearchError("glob nesting limit exceeded");
      output += "(?:";
    } else if (character === "}") {
      if (!braces--) throw new SearchError("unmatched glob brace");
      output += ")";
    } else if (character === "," && braces) output += "|";
    else output += quote(character);
  }
  if (braces) throw new SearchError("unclosed glob brace");
  return output;
}

export class Glob {
  private readonly regex: RegExp;
  private readonly directory: boolean;
  constructor(source: string, insensitive = false, literalUnclosedClass = false) {
    if (!source || source.length > 8192) throw new SearchError("empty or excessive glob");
    this.directory = source.endsWith("/");
    if (this.directory) source = source.slice(0, -1);
    const anchored = source.startsWith("/") || source.includes("/");
    if (source.startsWith("/")) source = source.slice(1);
    try { this.regex = new RegExp(`${anchored ? "^" : "(?:^|/)"}${compile(source, literalUnclosedClass)}$`, insensitive ? "ui" : "u"); }
    catch (error) { throw new SearchError(`invalid glob: ${error instanceof Error ? error.message : String(error)}`); }
  }
  matches(path: string, directory: boolean, ancestors = true): boolean {
    if ((!this.directory || directory) && this.regex.test(path)) return true;
    if (!ancestors) return false;
    let slash = path.lastIndexOf("/");
    while (slash >= 0) { if (this.regex.test(path.slice(0, slash))) return true; slash = path.lastIndexOf("/", slash - 1); }
    return false;
  }
}

export interface IgnoreRule { readonly base: string; readonly priority: number; readonly include: boolean; readonly glob: Glob }

export function ignoreRules(contents: string, base: string, priority: number): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (let source of contents.split(/\r?\n/u)) {
    if (!source || source.startsWith("#")) continue;
    while (source.endsWith(" ")) {
      let backslashes = 0;
      for (let offset = source.length - 2; offset >= 0 && source[offset] === "\\"; offset--) backslashes++;
      if (backslashes % 2) break;
      source = source.slice(0, -1);
    }
    if (!source) continue;
    const include = source.startsWith("!");
    if (include) source = source.slice(1);
    if (source) rules.push({ base, priority, include, glob: new Glob(source, false, true) });
    if (rules.length > 10000) throw new SearchError("ignore rule count limit exceeded");
  }
  return rules;
}
