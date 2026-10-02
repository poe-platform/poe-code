import { FsError, type CommandDefinition } from "safe-bash-contracts";
import { builtInDirectContextExecutors, isDefaultCommandOptions, syncCommandEvaluators } from "safe-bash-io-engine/internal";
import { integer } from "./options.js";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { RegexExecutor, withRegexSession } from "safe-bash-regex-engine/execution/portable";
import { ExprMatchError } from "safe-bash-regex-engine/execution/protocol";
import { Budget, CsplitError, fsDetail, settings, type CsplitCommandsOptions } from "./internal.js";
import { Lifecycle, Lines, Outputs } from "./io.js";
import { parseOptions, suffixFormatter } from "./options.js";
import { Matcher, preparePatterns } from "./patterns.js";
import { Splitter } from "./split.js";

export type { CsplitCommandsOptions, CsplitLimits } from "./internal.js";


export function evalSyncCsplit(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  let prefix = "xx";
  let suffix: string | undefined;
  let digits = 2;
  let elide = false;
  let quiet = false;
  let suppress = false;
  const operands: string[] = [];
  let ended = false;
  const long: Readonly<Record<string, string>> = {
    prefix: "f", "suffix-format": "b", "keep-files": "k", "elide-empty-files": "z",
    digits: "n", quiet: "q", silent: "s", "suppress-matched": "suppress", help: "help", version: "version",
  };
  for (let i = 0; i < opArgs.length; i++) {
    const arg = opArgs[i]!;
    if (ended || arg === "-" || !arg.startsWith("-")) {
      operands.push(arg);
      continue;
    }
    if (arg === "--") { ended = true; continue; }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = arg.slice(2, eq < 0 ? undefined : eq);
      const candidates = Object.keys(long).filter(k => k.startsWith(name));
      const selected = Object.hasOwn(long, name) ? name : (candidates.length === 1 ? candidates[0] : undefined);
      if (!selected) return undefined;
      const key = long[selected]!;
      if (key === "help" || key === "version") {
        if (eq >= 0) return undefined;
        return key === "version"
          ? "csplit (virtual-bash)\n"
          : "Usage: csplit [OPTION]... FILE PATTERN...\nOptions: -f PREFIX, -b SUFFIX, -k, -z, -n DIGITS, -s, --suppress-matched\nPatterns: INTEGER, /REGEXP/[OFFSET], %REGEXP%[OFFSET], {INTEGER}, {*}\n";
      }
      if ("fbn".includes(key)) {
        const val = eq < 0 ? opArgs[++i] : arg.slice(eq + 1);
        if (val === undefined) return undefined;
        if (key === "f") prefix = val;
        else if (key === "b") suffix = val;
        else if (key === "n") {
          const n = Number(val);
          if (!Number.isSafeInteger(n) || n < 0 || n > 64) return undefined;
          digits = n;
        }
      } else if (eq >= 0) {
        return undefined;
      } else if (key === "z") elide = true;
      else if (key === "q" || key === "s") quiet = true;
      else if (key === "suppress") suppress = true;
    } else {
      for (let off = 1; off < arg.length; off++) {
        const key = arg[off]!;
        if (!"fbknsqz".includes(key)) return undefined;
        if ("fbn".includes(key)) {
          const val = arg.slice(off + 1) || opArgs[++i];
          if (val === undefined) return undefined;
          if (key === "f") prefix = val;
          else if (key === "b") suffix = val;
          else if (key === "n") {
            const n = Number(val);
            if (!Number.isSafeInteger(n) || n < 0 || n > 64) return undefined;
            digits = n;
          }
          break;
        }
        if (key === "z") elide = true;
        else if (key === "q" || key === "s") quiet = true;
      }
    }
  }
  if (!writeFileSync || operands.length < 2) return undefined;
  let formatSuffix: (idx: number) => string = idx => String(idx).padStart(digits, "0");
  if (suffix !== undefined) {
    const m = /^([^%]*?)%(0?)(\d*)([diuoxX])([^%]*)$/.exec(suffix);
    if (!m) return undefined;
    const [, pre, zeroFlag, widthStr, conv, post] = m;
    const w = widthStr ? Number(widthStr) : 0;
    formatSuffix = idx => {
      const raw = conv === "o" ? idx.toString(8) : conv === "x" ? idx.toString(16) : conv === "X" ? idx.toString(16).toUpperCase() : String(idx);
      const padded = w > 0 ? raw.padStart(w, zeroFlag === "0" ? "0" : " ") : raw;
      return `${pre}${padded}${post}`;
    };
  }
  const inputArg = operands[0]!;
  const src = inputArg === "-" ? (inBytes ?? new Uint8Array(0)) : readFileSync?.(inputArg);
  if (!src) return undefined;
  if (src.includes(0)) return undefined;
  const lines: Uint8Array[] = [];
  const lineStrings: string[] = [];
  const lineDec = new TextDecoder("utf-8", { fatal: true });
  let lineStart = 0;
  try {
    for (let i = 0; i < src.length; i++) {
      if (src[i] === 10) {
        const sub = src.subarray(lineStart, i + 1);
        lines.push(sub);
        lineStrings.push(lineDec.decode(src.subarray(lineStart, i)));
        lineStart = i + 1;
      }
    }
    if (lineStart < src.length) {
      const sub = src.subarray(lineStart);
      lines.push(sub);
      lineStrings.push(lineDec.decode(sub));
    }
  } catch {
    return undefined;
  }
  type SyncCsplitPat =
    | { kind: "line"; line: number; repeat: number }
    | { kind: "regex"; re: RegExp; offset: number; skip: boolean; repeat: number | "*" };
  const rawPatterns = operands.slice(1);
  const parsedPatterns: SyncCsplitPat[] = [];
  let lastLine = 0;
  for (let i = 0; i < rawPatterns.length; i++) {
    const p = rawPatterns[i]!;
    if (p.startsWith("{")) return undefined;
    let rep: number | "*" = 0;
    const nextArg = rawPatterns[i + 1];
    if (nextArg?.startsWith("{")) {
      if (!nextArg.endsWith("}")) return undefined;
      if (nextArg === "{*}") {
        rep = "*";
      } else {
        const rc = integer(nextArg.slice(1, -1));
        if (rc === undefined || rc > 1000n) return undefined;
        rep = Number(rc);
      }
      i++;
    }
    if (p.startsWith("/") || p.startsWith("%")) {
      const delim = p[0]!;
      const closeIdx = p.lastIndexOf(delim);
      if (closeIdx <= 0) return undefined;
      const rawRe = p.slice(1, closeIdx);
      const offStr = p.slice(closeIdx + 1);
      let offset = 0;
      if (offStr.length > 0) {
        const offVal = integer(offStr, true);
        if (offVal === undefined) return undefined;
        offset = Number(offVal);
      }
      const jsReStr = rawRe
        .replace(/\\([()+?|])/g, "$1")
        .replace(/\[:alnum:\]/g, "0-9A-Za-z")
        .replace(/\[:alpha:\]/g, "A-Za-z")
        .replace(/\[:digit:\]/g, "0-9")
        .replace(/\[:space:\]/g, "\\s");
      let re: RegExp;
      try { re = new RegExp(jsReStr, "u"); } catch { return undefined; }
      parsedPatterns.push({ kind: "regex", re, offset, skip: delim === "%", repeat: rep });
    } else {
      if (rep === "*") return undefined;
      const ln = integer(p);
      if (ln === undefined || ln <= BigInt(lastLine) || ln > BigInt(lines.length + 1)) return undefined;
      lastLine = Number(ln);
      parsedPatterns.push({ kind: "line", line: Number(ln), repeat: rep });
    }
  }
  const mergeLines = (sliceLines: Uint8Array[]): Uint8Array => {
    const sliceLen = sliceLines.reduce((sum, l) => sum + l.length, 0);
    const mergedSlice = new Uint8Array(sliceLen);
    let sliceOff = 0;
    for (const l of sliceLines) {
      mergedSlice.set(l, sliceOff);
      sliceOff += l.length;
    }
    return mergedSlice;
  };
  let nextIdx = 1;
  let current = 0;
  let foreverFinished = false;
  const pieces: Uint8Array[] = [];
  for (const pat of parsedPatterns) {
    if (foreverFinished) break;
    if (pat.kind === "line") {
      for (let r = 0; r <= pat.repeat; r++) {
        const target = pat.line * (r + 1);
        if (suppress && current + 1 > lines.length) return undefined;
        if (target > lines.length + 1 || nextIdx > lines.length) return undefined;
        const sliceLines: Uint8Array[] = [];
        while (nextIdx < target) {
          sliceLines.push(lines[nextIdx - 1]!);
          current = Math.max(current, nextIdx);
          nextIdx++;
        }
        pieces.push(mergeLines(sliceLines));
        if (!suppress && current + 1 > lines.length) return undefined;
        if (suppress) {
          if (nextIdx > lines.length) return undefined;
          current = Math.max(current, nextIdx);
          nextIdx++;
        }
      }
    } else {
      const maxReps = pat.repeat === "*" ? lines.length + 1 : pat.repeat + 1;
      for (let r = 0; r < maxReps; r++) {
        let matchedLine = -1;
        for (;;) {
          current++;
          if (current > lines.length) break;
          if (pat.re.test(lineStrings[current - 1]!)) {
            matchedLine = current;
            break;
          }
          if (pat.offset >= 0) {
            current = Math.max(current, nextIdx);
          }
        }
        if (matchedLine === -1) {
          if (pat.repeat === "*") {
            if (!pat.skip) {
              const remLines = lines.slice(nextIdx - 1);
              pieces.push(mergeLines(remLines));
            }
            foreverFinished = true;
            break;
          }
          return undefined;
        }
        const target = matchedLine + pat.offset;
        if (nextIdx > lines.length || target < nextIdx || target > lines.length + 1) return undefined;
        const sliceLines: Uint8Array[] = [];
        while (nextIdx < target) {
          sliceLines.push(lines[nextIdx - 1]!);
          current = Math.max(current, nextIdx);
          nextIdx++;
        }
        if (!pat.skip) {
          pieces.push(mergeLines(sliceLines));
        }
        if (pat.offset > 0) current = target;
        if (suppress) {
          if (nextIdx > lines.length) return undefined;
          current = Math.max(current, nextIdx);
          nextIdx++;
        }
      }
    }
  }
  if (!foreverFinished) {
    const restLines = lines.slice(nextIdx - 1);
    pieces.push(mergeLines(restLines));
  }
  const sizes: number[] = [];
  let fileIdx = 0;
  for (const piece of pieces) {
    if (elide && piece.length === 0) continue;
    const name = `${prefix}${formatSuffix(fileIdx++)}`;
    if (!writeFileSync(name, piece)) return undefined;
    sizes.push(piece.length);
  }
  return quiet ? "" : sizes.map(s => `${s}\n`).join("");
}

syncCommandEvaluators.evalSyncCsplit = evalSyncCsplit;

export function createCsplitCommandWithExecutor(executor: RegexExecutor, options: CsplitCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const def: CommandDefinition = { name: "csplit", description: "Split files at bounded line and BRE boundaries",
    filesystemRequirements: [{ id: "split", description: "Atomically mutate owned VFS outputs", capabilities: ["atomicFileMutation"], mutates: true }],
    async execute(context) {
    return withRegexSession(context, executor, async session => {
      const budget = new Budget(context, limits);
      const lifecycle = new Lifecycle(budget);
      let output: Outputs | undefined;
      let failure: { reason: unknown } | undefined;
      let primary: { reason: unknown } | undefined;
      let exitCode = 0;
      try {
        const parsed = parseOptions(budget.arguments(), budget);
        if (parsed.information) {
          await budget.print(parsed.information === "version" ? "csplit (virtual-bash)\n" : "Usage: csplit [OPTION]... FILE PATTERN...\nOptions: -f PREFIX, -b SUFFIX, -k, -z, -n DIGITS, -s, --suppress-matched\nPatterns: INTEGER, /REGEXP/[OFFSET], %REGEXP%[OFFSET], {INTEGER}, {*}\n");
        } else {
          const format = suffixFormatter(parsed, budget);
          const input = new Lines(lifecycle);
          try { await input.open(parsed.operands[0]!); }
          catch (error) {
            if (error instanceof FsError) throw new CsplitError(`cannot open ${budget.quote(parsed.operands[0]!)} for reading: ${fsDetail(error)}`);
            throw error;
          }
          const matcher = new Matcher(session, budget);
          const patterns = await preparePatterns(parsed.operands.slice(1), matcher);
          output = new Outputs(lifecycle, parsed, format, input);
          await new Splitter(input, output, matcher).run(patterns);
          output.succeeded = true;
        }
      } catch (error) {
        primary = { reason: error };
        failure = { reason: error };
        if (output && error instanceof CsplitError && error.preserve) output.preserve = true;
        if (!context.signal.aborted) {
          exitCode = 1;
          try {
            const message = error instanceof ExprMatchError ? error.message : error instanceof FsError ? fsDetail(error) : publicDiagnosticMessage(error, context.onInternalError);
            await budget.print(`csplit: ${message}\n`, true);
            if (error instanceof CsplitError && error.usage) await budget.print("Try 'csplit --help' for more information.\n", true);
            if (!(error instanceof CsplitError && error.preserve)) await output?.finish();
            failure = undefined;
          } catch (reporting) { failure = { reason: new AggregateError([error, reporting], "csplit failure reporting failed") }; }
        }
      }
      try { await lifecycle.close(); }
      catch (cleanup) {
        const previous = failure ?? primary;
        failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "csplit execution and cleanup failed") : cleanup };
      }
      context.signal.throwIfAborted();
      if (failure) throw failure.reason;
      return { exitCode };
    });
  } };
  if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}
