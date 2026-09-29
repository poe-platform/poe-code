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
  allowNullBytes = false,
): string | undefined {
  let fixed = false;
  let ignoreCase = false;
  let smartCase = false;
  let invert = false;
  let countOnly = false;
  let onlyMatching = false;
  let wordRegexp = false;
  let lineRegexp = false;
  let replaceSpec: string | undefined;
  let lineNumber: boolean | undefined;
  let withFilename: boolean | undefined;
  let filesWithMatches = false;
  let filesWithoutMatch = false;
  let quiet = false;
  let nullTerminated = false;
  let maxCount = Infinity;
  const patterns: string[] = [];
  let positionalPatternConsumed = false;
  const paths: string[] = [];
  let endOpts = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!endOpts && a === "--") { endOpts = true; continue; }
    if (!endOpts && (a === "-e" || a === "--regexp")) {
      if (i + 1 >= args.length) return undefined;
      patterns.push(args[++i]!);
      positionalPatternConsumed = true;
      continue;
    }
    if (!endOpts && a.startsWith("--regexp=")) {
      patterns.push(a.slice(9));
      positionalPatternConsumed = true;
      continue;
    }
    if (!endOpts && (a === "-r" || a === "--replace")) {
      if (i + 1 >= args.length) return undefined;
      replaceSpec = args[++i]!;
      continue;
    }
    if (!endOpts && a.startsWith("--replace=")) {
      replaceSpec = a.slice(10);
      continue;
    }
    if (!endOpts && (a === "-m" || a === "--max-count")) {
      if (i + 1 >= args.length || !/^\d+$/u.test(args[i + 1]!)) return undefined;
      maxCount = Number(args[++i]!);
      continue;
    }
    if (!endOpts && a.startsWith("--max-count=")) {
      const v = a.slice(12);
      if (!/^\d+$/u.test(v)) return undefined;
      maxCount = Number(v);
      continue;
    }
    if (!endOpts && a.startsWith("--") && a.length > 2) {
      if (a === "--fixed-strings") fixed = true;
      else if (a === "--ignore-case") { ignoreCase = true; smartCase = false; }
      else if (a === "--case-sensitive") { ignoreCase = false; smartCase = false; }
      else if (a === "--smart-case") { smartCase = true; ignoreCase = false; }
      else if (a === "--invert-match") invert = true;
      else if (a === "--count") countOnly = true;
      else if (a === "--only-matching") onlyMatching = true;
      else if (a === "--word-regexp") wordRegexp = true;
      else if (a === "--line-regexp") lineRegexp = true;
      else if (a === "--line-number") lineNumber = true;
      else if (a === "--no-line-number") lineNumber = false;
      else if (a === "--with-filename") withFilename = true;
      else if (a === "--no-filename") withFilename = false;
      else if (a === "--files-with-matches") filesWithMatches = true;
      else if (a === "--files-without-match") filesWithoutMatch = true;
      else if (a === "--quiet") quiet = true;
      else if (a === "--null") nullTerminated = true;
      else return undefined;
      continue;
    }
    if (!endOpts && a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "F") fixed = true;
        else if (ch === "i") { ignoreCase = true; smartCase = false; }
        else if (ch === "s") { ignoreCase = false; smartCase = false; }
        else if (ch === "S") { smartCase = true; ignoreCase = false; }
        else if (ch === "v") invert = true;
        else if (ch === "c") countOnly = true;
        else if (ch === "o") onlyMatching = true;
        else if (ch === "w") wordRegexp = true;
        else if (ch === "x") lineRegexp = true;
        else if (ch === "n") lineNumber = true;
        else if (ch === "N") lineNumber = false;
        else if (ch === "H") withFilename = true;
        else if (ch === "I") withFilename = false;
        else if (ch === "l") filesWithMatches = true;
        else if (ch === "q") quiet = true;
        else if (ch === "0") nullTerminated = true;
        else if (ch === "e") {
          const rest = a.slice(j + 1);
          if (rest) patterns.push(rest);
          else {
            if (i + 1 >= args.length) return undefined;
            patterns.push(args[++i]!);
          }
          positionalPatternConsumed = true;
          break;
        } else if (ch === "m") {
          const rest = a.slice(j + 1);
          const v = rest || args[++i];
          if (!v || !/^\d+$/u.test(v)) return undefined;
          maxCount = Number(v);
          break;
        } else if (ch === "r") {
          const rest = a.slice(j + 1);
          if (rest) replaceSpec = rest;
          else {
            if (i + 1 >= args.length) return undefined;
            replaceSpec = args[++i]!;
          }
          break;
        }
        else return undefined;
      }
      continue;
    }
    if (!positionalPatternConsumed) {
      patterns.push(a);
      positionalPatternConsumed = true;
    } else {
      paths.push(a);
    }
  }
  if (patterns.length === 0) return undefined;
  if (nullTerminated && (!allowNullBytes || (!filesWithMatches && !filesWithoutMatch))) return undefined;
  if ((onlyMatching || replaceSpec !== undefined) && (invert || countOnly || filesWithMatches || filesWithoutMatch)) return undefined;
  const effectiveIgnoreCase = ignoreCase || (smartCase && !patterns.some(p => /[A-Z]/u.test(p)));

  const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rawSources: string[] = [];
  for (const pat of patterns) {
    if (fixed) {
      rawSources.push(escapeRegex(pat));
    } else {
      if (!/^[a-zA-Z0-9_ :;,=.+*?^$\-[\]()|/{}\\]+$/u.test(pat) || /\([^)]*[+*][^)]*\)[+*?]/u.test(pat)) return undefined;
      rawSources.push(pat);
    }
  }
  const combinedSource = rawSources.length === 1 ? rawSources[0]! : rawSources.map(s => `(?:${s})`).join("|");
  const wrappedSource = lineRegexp
    ? `^(?:${combinedSource})$`
    : wordRegexp
      ? `(?<![a-zA-Z0-9_])(?:${combinedSource})(?![a-zA-Z0-9_])`
      : combinedSource;

  let reTest: RegExp;
  let reGlobal: RegExp;
  try {
    reTest = new RegExp(wrappedSource, effectiveIgnoreCase ? "i" : "");
    reGlobal = new RegExp(wrappedSource, effectiveIgnoreCase ? "gi" : "g");
  } catch {
    return undefined;
  }

  const applyReplace = (m: RegExpExecArray): string => {
    if (replaceSpec === undefined) return m[0]!;
    let res = "";
    for (let k = 0; k < replaceSpec.length; k++) {
      if (replaceSpec[k] === "$") {
        const nxt = replaceSpec[k + 1];
        if (nxt === "$") { res += "$"; k++; continue; }
        if (nxt === "0" || nxt === "&") { res += m[0] ?? ""; k++; continue; }
        if (nxt !== undefined && nxt >= "1" && nxt <= "9") {
          const gIdx = Number(nxt);
          res += m[gIdx] ?? "";
          k++;
          continue;
        }
        if (nxt === "{") {
          const close = replaceSpec.indexOf("}", k + 2);
          if (close > k + 2) {
            const key = replaceSpec.slice(k + 2, close);
            res += (/^\d+$/.test(key) ? m[Number(key)] : m.groups?.[key]) ?? "";
            k = close;
            continue;
          }
        }
      }
      res += replaceSpec[k]!;
    }
    return res;
  };

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
      const ok = reTest.test(line);
      if (invert ? !ok : ok) {
        count++;
        if (filesWithoutMatch) {
          break;
        }
        anyMatched = true;
        if (filesWithMatches) {
          outLines.push(t);
          break;
        }
        if (!countOnly) {
          let prefix = "";
          if (showFile) prefix += `${t}:`;
          if (showLine) prefix += `${idx + 1}:`;
          if (onlyMatching) {
            reGlobal.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = reGlobal.exec(line)) !== null) {
              outLines.push(prefix + applyReplace(m));
              if (m[0]!.length === 0) reGlobal.lastIndex++;
            }
          } else if (replaceSpec !== undefined) {
            reGlobal.lastIndex = 0;
            let rebuilt = "";
            let lastEnd = 0;
            let m: RegExpExecArray | null;
            while ((m = reGlobal.exec(line)) !== null) {
              rebuilt += line.slice(lastEnd, m.index) + applyReplace(m);
              lastEnd = m.index + m[0]!.length;
              if (m[0]!.length === 0) {
                if (reGlobal.lastIndex < line.length) rebuilt += line[reGlobal.lastIndex]!;
                reGlobal.lastIndex++;
                lastEnd = reGlobal.lastIndex;
              }
            }
            rebuilt += line.slice(lastEnd);
            outLines.push(prefix + rebuilt);
          } else {
            outLines.push(prefix + line);
          }
        }
        if (count >= maxCount) break;
      }
    }
    if (filesWithoutMatch) {
      if (count === 0) {
        anyMatched = true;
        outLines.push(t);
      }
    } else if (countOnly && count > 0) {
      outLines.push(showFile ? `${t}:${count}` : String(count));
    }
  }
  if (!anyMatched) return undefined;
  if (quiet) return "";
  const sep = nullTerminated ? "\0" : "\n";
  return outLines.length === 0 ? "" : `${outLines.join(sep)}${sep}`;
}
