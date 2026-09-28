import type { Budget } from "./budget.js";

// Character classes use the C/POSIX character repertoire.
const characterClasses: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  alnum: [[48, 57], [65, 90], [97, 122]], alpha: [[65, 90], [97, 122]],
  blank: [[9, 9], [32, 32]], cntrl: [[0, 31], [127, 127]], digit: [[48, 57]],
  graph: [[33, 126]], lower: [[97, 122]], print: [[32, 126]],
  punct: [[33, 47], [58, 64], [91, 96], [123, 126]], space: [[9, 13], [32, 32]],
  upper: [[65, 90]], xdigit: [[48, 57], [65, 70], [97, 102]],
};

/** Iterative fnmatch-style matching, with every transition charged to the walk. */
export function excluded(pattern: string, path: string, budget: Budget): boolean {
  let states = new Set([0]);
  for (let index = 0; index < path.length; index++) {
    budget.step();
    if (path[index] === "/") states.add(index + 1);
  }
  for (let offset = 0; offset < pattern.length; offset++) {
    const token = pattern[offset]!;
    const escaped = token === "\\" && offset + 1 < pattern.length;
    let literal = token;
    let members: { character: string; escaped: boolean; ranges?: readonly (readonly [number, number])[] }[] | undefined;
    let negate = false;
    if (token === "\\" && offset + 1 < pattern.length) literal = pattern[++offset]!;
    else if (token === "[") {
      let end = offset + 1;
      negate = pattern[end] === "!" || pattern[end] === "^";
      if (negate) end++;
      const parsed: NonNullable<typeof members> = [];
      while (end < pattern.length) {
        budget.step();
        if (pattern[end] === "]" && parsed.length) break;
        if (pattern[end] === "[" && pattern[end + 1] === ":") {
          let close = end + 2;
          while (close < pattern.length && !(pattern[close] === ":" && pattern[close + 1] === "]")) { budget.step(); close++; }
          const name = pattern.slice(end + 2, close);
          const ranges = Object.hasOwn(characterClasses, name) ? characterClasses[name] : undefined;
          if (close < pattern.length && ranges) {
            parsed.push({ character: "", escaped: false, ranges });
            end = close + 2;
            continue;
          }
        }
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
          const ranges = members[member]!.ranges;
          if (ranges) {
            for (const [low, high] of ranges) {
              budget.step();
              matches ||= character.charCodeAt(0) >= low && character.charCodeAt(0) <= high;
            }
          } else if (members[member + 1]?.character === "-" && !members[member + 1]!.escaped && member + 2 < members.length && !members[member + 2]!.ranges) {
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
