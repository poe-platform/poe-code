import { PublicDiagnostic } from "safe-bash-contracts/public-diagnostic";
import type { EreLedger } from "./ere/limits.js";
import type { EreFragment } from "./ere/types.js";

function invalid(message: string): never { throw new PublicDiagnostic(`invalid glob: ${message}`); }

export async function globFragments(source: string, literalUnclosedClass: boolean, ledger: EreLedger, signal: AbortSignal): Promise<EreFragment[]> {
  const output: EreFragment[] = [];
  let braces = 0;
  const add = (text: string, literal = false) => {
    ledger.charge("allocationUnits", text.length + 4, signal);
    output.push({ text, literal });
  };
  const anchored = source.startsWith("/") || source.slice(0, -1).includes("/");
  if (source.startsWith("/")) source = source.slice(1);
  if (source.endsWith("/")) source = source.slice(0, -1);
  add(anchored ? "^" : "(^|/)");
  for (let offset = 0; offset < source.length; offset++) {
    ledger.charge("work", 1, signal);
    await ledger.checkpoint(signal);
    const character = source[offset]!;
    if (character === "\\") {
      const next = source[++offset];
      if (next === undefined) invalid("trailing glob escape");
      add(next, true);
    } else if (character === "*") {
      if (source[offset + 1] === "*") {
        while (source[offset + 1] === "*") { offset++; ledger.charge("work", 1, signal); }
        if (source[offset + 1] === "/") { offset++; add("(.*/)?"); }
        else add(".*");
      } else add("[^/]*");
    } else if (character === "?") add("[^/]");
    else if (character === "[") {
      const opening = offset;
      let end = offset + 1;
      if (source[end] === "!" || source[end] === "^") end++;
      if (source[end] === "]") end++;
      while (end < source.length && source[end] !== "]") { end++; ledger.charge("work", 1, signal); await ledger.checkpoint(signal); }
      if (end === source.length) {
        if (!literalUnclosedClass) invalid("unclosed glob character class");
        add("[", true); offset = opening;
      } else {
        let contents = source.slice(offset + 1, end);
        if (contents.startsWith("!")) contents = "^" + contents.slice(1);
        add("[" + contents + "]"); offset = end;
      }
    } else if (character === "{") {
      braces++;
      add("(");
    } else if (character === "}") {
      if (braces-- === 0) invalid("unmatched glob brace");
      add(")");
    } else if (character === "," && braces) add("|");
    else add(character, true);
  }
  if (braces) invalid("unclosed glob brace");
  add("$");
  return output;
}

export function parseIgnorePatterns(contents: string): {pattern: string; include: boolean}[] {
  const rules: {pattern: string; include: boolean}[] = [];
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
    if (source) rules.push({ pattern: source, include });
  }
  return rules;
}
