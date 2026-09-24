import type { Budget } from "./runtime.js";
import type { WordPart } from "./parser.js";

/** Expand lexical prefixes before parameter expansion, preserving their quoting. */
export function expandTildes(parts: readonly WordPart[], variables: Readonly<Record<string, string>>, budget: Budget, assignmentStart?: number, protect = true): WordPart[] {
  const result: WordPart[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.kind !== "text" || part.quoted || part.byteValue || !part.value.includes("~")) { result.push(part); continue; }
    let retained = 0;
    for (let offset = 0; offset < part.value.length; offset++) {
      if (offset % 1024 === 0) budget.cpuCheckpoint();
      if (part.value[offset] !== "~") continue;
      const initial = index === 0 && offset === (assignmentStart ?? 0);
      if (!initial && !(assignmentStart !== undefined && offset > 0 && part.value[offset - 1] === ":")) continue;
      let end = offset + 1;
      while (end < part.value.length && part.value[end] !== "/" && !(assignmentStart !== undefined && part.value[end] === ":")) {
        if (end % 1024 === 0) budget.cpuCheckpoint();
        end++;
      }
      // A quoted or expanded continuation belongs to the prefix, even when empty.
      if (end === part.value.length && index + 1 < parts.length) continue;
      const prefix = part.value.slice(offset + 1, end);
      const home = prefix === "" ? variables.HOME : prefix === "+" ? variables.PWD : prefix === "-" ? variables.OLDPWD : undefined;
      if (home === undefined) continue;
      if (retained < offset) result.push({ ...part, value: part.value.slice(retained, offset) });
      result.push({ kind: "text", value: home, quoted: protect });
      retained = end;
      offset = end - 1;
    }
    if (retained === 0) result.push(part);
    else if (retained < part.value.length) result.push({ ...part, value: part.value.slice(retained) });
  }
  return result;
}
