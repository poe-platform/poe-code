import type { Budget } from "./budget.js";

/** Iterative fnmatch-style matching, with every transition charged to the walk. */
export function excluded(pattern: string, path: string, budget: Budget): boolean {
  let states = new Set([0]);
  for (let offset = 0; offset < pattern.length; offset++) {
    const token = pattern[offset]!;
    const escaped = token === "\\" && offset + 1 < pattern.length;
    let literal = token;
    let members: { character: string; escaped: boolean }[] | undefined;
    let negate = false;
    if (token === "\\" && offset + 1 < pattern.length) literal = pattern[++offset]!;
    else if (token === "[") {
      let end = offset + 1;
      negate = pattern[end] === "!" || pattern[end] === "^";
      if (negate) end++;
      const parsed: { character: string; escaped: boolean }[] = [];
      while (end < pattern.length) {
        budget.step();
        if (pattern[end] === "]" && parsed.length) break;
        const escapedMember = pattern[end] === "\\" && end + 1 < pattern.length;
        if (escapedMember) end++;
        parsed.push({ character: pattern[end++]!, escaped: escapedMember });
      }
      if (end < pattern.length) { members = parsed; offset = end; }
    }
    const next = new Set<number>();
    if (token === "*" && !escaped) {
      const start = Math.min(...states);
      for (let index = start; index <= path.length; index++) { budget.step(); next.add(index); }
    } else for (const index of states) {
      budget.step();
      if (index === path.length) continue;
      const character = path[index]!;
      let matches = token === "?" && !escaped || character === literal;
      if (members !== undefined) {
        matches = false;
        for (let member = 0; member < members.length; member++) {
          budget.step();
          if (members[member + 1]?.character === "-" && !members[member + 1]!.escaped && member + 2 < members.length) {
            matches ||= character >= members[member]!.character && character <= members[member + 2]!.character;
            member += 2;
          } else matches ||= character === members[member]!.character;
        }
        if (negate) matches = !matches;
      }
      if (matches) next.add(index + 1);
    }
    states = next;
    if (!states.size) return false;
  }
  return states.has(path.length);
}
