import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { builtInDirectContextExecutors } from "../internal.js";
import { rgCommand } from "./rg.js";
import type { SearchOptions } from "./options.js";

export type { SearchOptions } from "./options.js";

export function createSearchCommands(options: SearchOptions = {}): readonly CommandDefinition[] {
  const definitions = [rgCommand(options)];
  for (let i = 0; i < definitions.length; i++) builtInDirectContextExecutors.add(definitions[i]!.execute);
  return definitions;
}

export function searchCommands(options: SearchOptions = {}): VirtualShellPlugin {
  return {
    name: "search-commands",
    setup(host) {
      const definitions = createSearchCommands(options);
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}

const syncRgDecoder = new TextDecoder("utf-8", { fatal: false });

export function evalSyncRg(
  stdinBytes: Uint8Array | undefined,
  args: readonly string[],
  readFile?: (path: string) => Uint8Array | undefined,
): string | undefined {
  let fixed = false;
  let ignoreCase = false;
  let invert = false;
  let countOnly = false;
  let lineNumber: boolean | undefined;
  let withFilename: boolean | undefined;
  let filesWithMatches = false;
  let maxCount = Infinity;
  let pattern: string | undefined;
  const paths: string[] = [];
  let endOpts = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!endOpts && a === "--") { endOpts = true; continue; }
    if (!endOpts && (a === "-e" || a === "--regexp")) {
      if (i + 1 >= args.length || pattern !== undefined) return undefined;
      pattern = args[++i]!;
      continue;
    }
    if (!endOpts && (a === "-m" || a === "--max-count")) {
      if (i + 1 >= args.length || !/^\d+$/u.test(args[i + 1]!)) return undefined;
      maxCount = Number(args[++i]!);
      continue;
    }
    if (!endOpts && a.startsWith("--") && a.length > 2) {
      if (a === "--fixed-strings") fixed = true;
      else if (a === "--ignore-case") ignoreCase = true;
      else if (a === "--invert-match") invert = true;
      else if (a === "--count") countOnly = true;
      else if (a === "--line-number") lineNumber = true;
      else if (a === "--no-line-number") lineNumber = false;
      else if (a === "--with-filename") withFilename = true;
      else if (a === "--no-filename") withFilename = false;
      else if (a === "--files-with-matches") filesWithMatches = true;
      else return undefined;
      continue;
    }
    if (!endOpts && a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "F") fixed = true;
        else if (ch === "i") ignoreCase = true;
        else if (ch === "v") invert = true;
        else if (ch === "c") countOnly = true;
        else if (ch === "n") lineNumber = true;
        else if (ch === "N") lineNumber = false;
        else if (ch === "H") withFilename = true;
        else if (ch === "I") withFilename = false;
        else if (ch === "l") filesWithMatches = true;
        else return undefined;
      }
      continue;
    }
    if (pattern === undefined) pattern = a;
    else paths.push(a);
  }
  if (pattern === undefined) return undefined;

  let testLine: (line: string) => boolean;
  if (fixed) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    testLine = (l: string) => (ignoreCase ? l.toLowerCase() : l).includes(needle);
  } else {
    if (!/^[a-zA-Z0-9_ :;,=.+*?^$\-[\]()|/]+$/u.test(pattern) || /\([^)]*[+*][^)]*\)[+*?]/u.test(pattern)) return undefined;
    try {
      const re = new RegExp(pattern, ignoreCase ? "i" : "");
      testLine = (l: string) => re.test(l);
    } catch { return undefined; }
  }

  const targets = paths.length > 0 ? paths : ["-"];
  const showFile = withFilename ?? (targets.length > 1);
  const showLine = lineNumber ?? false;
  const outLines: string[] = [];
  let anyMatched = false;

  for (const t of targets) {
    const b = t === "-" ? stdinBytes : (readFile ? readFile(t) : undefined);
    if (!b || b.byteLength > 65536 || b.includes(0)) return undefined;
    const text = syncRgDecoder.decode(b);
    const rawLines = text.length === 0 ? [] : (text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n"));
    let count = 0;
    for (let idx = 0; idx < rawLines.length; idx++) {
      const line = rawLines[idx]!;
      const ok = testLine(line);
      if (invert ? !ok : ok) {
        count++;
        anyMatched = true;
        if (filesWithMatches) {
          outLines.push(t);
          break;
        }
        if (!countOnly) {
          let prefix = "";
          if (showFile) prefix += `${t}:`;
          if (showLine) prefix += `${idx + 1}:`;
          outLines.push(prefix + line);
        }
        if (count >= maxCount) break;
      }
    }
    if (countOnly && count > 0) {
      outLines.push(showFile ? `${t}:${count}` : String(count));
    }
  }
  if (!anyMatched) return undefined;
  return outLines.length === 0 ? "" : `${outLines.join("\n")}\n`;
}
