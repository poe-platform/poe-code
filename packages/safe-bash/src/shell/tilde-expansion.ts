import type { Budget, State } from "./runtime.js";
import type { WordPart } from "./parser.js";

export function resolveTildePrefix(prefix: string, state: State, budget: Budget): string | undefined {
  if (prefix === "") return state.variables.HOME;
  if (prefix === "+") return state.variables.PWD;
  if (prefix === "-") return state.variables.OLDPWD;
  let position = 0;
  for (let digit = prefix[0] === "+" || prefix[0] === "-" ? 1 : 0; digit < prefix.length; digit++) {
    if (digit % 1024 === 0) budget.cpuCheckpoint();
    const code = prefix.charCodeAt(digit);
    if (code < 48 || code > 57) return undefined;
    position = position * 10 + code - 48;
  }
  const entries = state.directoryStack?.entries;
  if (prefix[0] === "-") position = (entries?.length ?? 0) - position;
  return position === 0 ? state.variables.PWD : entries?.[position - 1];
}

/** Expand lexical prefixes before parameter expansion, preserving their quoting. */
export function expandTildes(parts: readonly WordPart[], state: State, budget: Budget, assignmentStart?: number, colonEndsInitialTilde = false): WordPart[] {
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
      while (end < part.value.length && part.value[end] !== "/" && !((assignmentStart !== undefined || (colonEndsInitialTilde && initial)) && part.value[end] === ":")) {
        if (end % 1024 === 0) budget.cpuCheckpoint();
        end++;
      }
      // A quoted or expanded continuation belongs to the prefix, even when empty.
      if (end === part.value.length && index + 1 < parts.length) continue;
      const prefix = part.value.slice(offset + 1, end);
      const home = resolveTildePrefix(prefix, state, budget);
      if (home === undefined) continue;
      if (retained < offset) result.push({ ...part, value: part.value.slice(retained, offset) });
      result.push({ kind: "text", value: home, quoted: true });
      retained = end;
      offset = end - 1;
    }
    if (retained === 0) result.push(part);
    else if (retained < part.value.length) result.push({ ...part, value: part.value.slice(retained) });
  }
  return result;
}
