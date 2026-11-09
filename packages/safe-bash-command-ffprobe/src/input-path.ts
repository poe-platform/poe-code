import type { ReadStreamOptions } from "safe-bash-contracts/filesystem";

/** Resolve input protocol options before normalizing the local filename. */
export function resolveInputPath(cwd: string, input: string): { path: string } & ReadStreamOptions {
  if (!input.startsWith("subfile:") && !input.startsWith("subfile,")) return { path: resolvePath(cwd, input) };
  let start = 0, end = 0;
  if (input.startsWith("subfile:")) input = input.slice(8);
  else {
    const separator = input[8];
    if (!separator) throw new Error("Invalid subfile options");
    let position = 9;
    while (true) {
      const keyEnd = input.indexOf(separator, position);
      if (keyEnd < 0) throw new Error("Unterminated subfile options");
      if (keyEnd === position) {
        if (input[keyEnd + 1] !== ":") throw new Error("Invalid subfile filename");
        input = input.slice(keyEnd + 2);
        break;
      }
      const valueEnd = input.indexOf(separator, keyEnd + 1);
      if (valueEnd < 0) throw new Error("Unterminated subfile options");
      const key = input.slice(position, keyEnd), text = input.slice(keyEnd + 1, valueEnd);
      const value = Number(text);
      if (!text.trim() || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid subfile ${key}`);
      if (key === "start") start = value;
      else if (key === "end") end = value;
      else throw new Error(`Unknown subfile option: ${key}`);
      position = valueEnd + 1;
    }
  }
  if (end !== 0 && end <= start) throw new Error("Subfile end must be greater than start");
  if (!input || !input.startsWith("file:") && input.includes(":")) throw new Error("Subfile input requires a local file");
  return { path: resolvePath(cwd, input), start, ...(end === 0 ? {} : { endExclusive: end }) };
}

export function resolvePath(cwd: string, p: string): string {
  if (p.startsWith("file:")) p = p.slice(5);
  if (!p.startsWith("/")) p = `${cwd.endsWith("/") ? cwd : `${cwd}/`}${p}`;
  const stack: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}
