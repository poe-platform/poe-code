const syncRgDecoder = new TextDecoder("utf-8", { fatal: true });

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
  let mode: "lines" | "count" | "with" | "without" = "lines";
  let onlyMatching = false;
  let wordRegexp = false;
  let lineRegexp = false;
  let lineNumber: boolean | undefined;
  let withFilename: boolean | undefined;
  let quiet = false;
  let nullTerminated = false;
  let maxCount = Infinity;
  const patterns: string[] = [];
  let explicitPatterns = false;
  const operands: string[] = [];
  let endOpts = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!endOpts && a === "--") { endOpts = true; continue; }
    if (!endOpts && (a === "-e" || a === "--regexp")) {
      if (i + 1 >= args.length) return undefined;
      patterns.push(args[++i]!);
      explicitPatterns = true;
      continue;
    }
    if (!endOpts && a.startsWith("--regexp=")) {
      patterns.push(a.slice(9));
      explicitPatterns = true;
      continue;
    }
    if (!endOpts && (a === "-r" || a === "--replace" || a.startsWith("--replace="))) {
      return undefined;
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
      else if (a === "--no-fixed-strings") fixed = false;
      else if (a === "--ignore-case") { ignoreCase = true; smartCase = false; }
      else if (a === "--case-sensitive") { ignoreCase = false; smartCase = false; }
      else if (a === "--smart-case") { smartCase = true; ignoreCase = false; }
      else if (a === "--invert-match") invert = true;
      else if (a === "--no-invert-match") invert = false;
      else if (a === "--count") mode = "count";
      else if (a === "--only-matching") onlyMatching = true;
      else if (a === "--no-only-matching") onlyMatching = false;
      else if (a === "--word-regexp") { wordRegexp = true; lineRegexp = false; }
      else if (a === "--line-regexp") { lineRegexp = true; wordRegexp = false; }
      else if (a === "--line-number") lineNumber = true;
      else if (a === "--no-line-number") lineNumber = false;
      else if (a === "--with-filename") withFilename = true;
      else if (a === "--no-filename") withFilename = false;
      else if (a === "--files-with-matches") mode = "with";
      else if (a === "--files-without-match") mode = "without";
      else if (a === "--quiet") quiet = true;
      else if (a === "--null") nullTerminated = true;
      else if (a === "--no-null") nullTerminated = false;
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
        else if (ch === "c") mode = "count";
        else if (ch === "o") onlyMatching = true;
        else if (ch === "w") { wordRegexp = true; lineRegexp = false; }
        else if (ch === "x") { lineRegexp = true; wordRegexp = false; }
        else if (ch === "n") lineNumber = true;
        else if (ch === "N") lineNumber = false;
        else if (ch === "H") withFilename = true;
        else if (ch === "I") withFilename = false;
        else if (ch === "l") mode = "with";
        else if (ch === "q") quiet = true;
        else if (ch === "0") nullTerminated = true;
        else if (ch === "e") {
          const rest = a.slice(j + 1);
          if (rest) patterns.push(rest);
          else {
            if (i + 1 >= args.length) return undefined;
            patterns.push(args[++i]!);
          }
          explicitPatterns = true;
          break;
        } else if (ch === "m") {
          const rest = a.slice(j + 1);
          const v = rest || args[++i];
          if (!v || !/^\d+$/u.test(v)) return undefined;
          maxCount = Number(v);
          break;
        } else if (ch === "r") {
          return undefined;
        }
        else return undefined;
      }
      continue;
    }
    operands.push(a);
  }
  if (!explicitPatterns) {
    if (operands.length === 0) return undefined;
    patterns.push(operands.shift()!);
  }
  const paths = operands;
  if (patterns.length === 0) return undefined;
  const countOnly = mode === "count";
  const filesWithMatches = mode === "with";
  const filesWithoutMatch = mode === "without";
  if (nullTerminated && (!allowNullBytes || (!filesWithMatches && !filesWithoutMatch))) return undefined;
  if (onlyMatching && (invert || countOnly || filesWithMatches || filesWithoutMatch)) return undefined;
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

  const targets = paths.length > 0 ? paths : ["-"];
  const showFile = withFilename ?? (targets.length > 1);
  const showLine = lineNumber ?? false;
  const outLines: string[] = [];
  let anyMatched = false;
  let stdinUsed = false;

  if (maxCount === 0) return undefined;
  for (const t of targets) {
    const b = t === "-" ? (stdinUsed ? new Uint8Array(0) : ((stdinUsed = true), stdinBytes)) : (readFile ? readFile(t) : undefined);
    if (!b || b.byteLength > 65536 || b.includes(0) || b.includes(13)) return undefined;
    const label = t === "-" ? "<stdin>" : t;
    let text: string;
    try { text = syncRgDecoder.decode(b); } catch { return undefined; }
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
          outLines.push(label);
          break;
        }
        if (!countOnly) {
          let prefix = "";
          if (showFile) prefix += `${label}:`;
          if (showLine) prefix += `${idx + 1}:`;
          if (onlyMatching) {
            reGlobal.lastIndex = 0;
            let prevEnd = -1;
            let m: RegExpExecArray | null;
            while (reGlobal.lastIndex <= line.length && (m = reGlobal.exec(line)) !== null) {
              if (m[0]!.length === 0 && m.index === prevEnd) {
                reGlobal.lastIndex = m.index + 1;
                continue;
              }
              outLines.push(prefix + m[0]!);
              prevEnd = m.index + m[0]!.length;
              if (m[0]!.length === 0) reGlobal.lastIndex = m.index + 1;
            }
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
        outLines.push(label);
      }
    } else if (countOnly && count > 0) {
      outLines.push(showFile ? `${label}:${count}` : String(count));
    }
  }
  if (!anyMatched) return undefined;
  if (quiet) return "";
  const sep = nullTerminated ? "\0" : "\n";
  return outLines.length === 0 ? "" : `${outLines.join(sep)}${sep}`;
}
