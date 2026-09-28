import { FsError, type CommandDefinition } from "safe-bash-contracts";
import { builtInDirectContextExecutors, isDefaultCommandOptions, syncCommandEvaluators } from "safe-bash-command-io-engine/internal";
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
  if (!writeFileSync || suffix !== undefined || operands.length < 2) return undefined;
  const inputArg = operands[0]!;
  const src = inputArg === "-" ? (inBytes ?? new Uint8Array(0)) : readFileSync?.(inputArg);
  if (!src) return undefined;
  const lines: Uint8Array[] = [];
  let lineStart = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === 10) {
      lines.push(src.subarray(lineStart, i + 1));
      lineStart = i + 1;
    }
  }
  if (lineStart < src.length) lines.push(src.subarray(lineStart));
  const rawPatterns = operands.slice(1);
  const parsedPatterns: { line: number; repeat: number }[] = [];
  let lastLine = 0;
  for (let i = 0; i < rawPatterns.length; i++) {
    const p = rawPatterns[i]!;
    if (p.startsWith("/") || p.startsWith("%") || p.startsWith("{")) return undefined;
    const ln = integer(p);
    if (ln === undefined || ln <= BigInt(lastLine) || ln > BigInt(lines.length + 1)) return undefined;
    lastLine = Number(ln);
    let rep = 0;
    const nextArg = rawPatterns[i + 1];
    if (nextArg?.startsWith("{")) {
      if (nextArg === "{*}" || !nextArg.endsWith("}")) return undefined;
      const rc = integer(nextArg.slice(1, -1));
      if (rc === undefined || rc > 1000n) return undefined;
      rep = Number(rc);
      i++;
    }
    parsedPatterns.push({ line: Number(ln), repeat: rep });
  }
  let nextIdx = 1;
  const pieces: Uint8Array[] = [];
  for (const pat of parsedPatterns) {
    for (let r = 0; r <= pat.repeat; r++) {
      const target = pat.line * (r + 1);
      if (target > lines.length + 1 || nextIdx > lines.length) return undefined;
      const sliceLines: Uint8Array[] = [];
      while (nextIdx < target) {
        sliceLines.push(lines[nextIdx - 1]!);
        nextIdx++;
      }
      const sliceLen = sliceLines.reduce((sum, l) => sum + l.length, 0);
      const mergedSlice = new Uint8Array(sliceLen);
      let sliceOff = 0;
      for (const l of sliceLines) {
        mergedSlice.set(l, sliceOff);
        sliceOff += l.length;
      }
      pieces.push(mergedSlice);
      if (suppress) {
        if (nextIdx > lines.length) return undefined;
        nextIdx++;
      }
    }
  }
  const restLines: Uint8Array[] = [];
  while (nextIdx <= lines.length) {
    restLines.push(lines[nextIdx - 1]!);
    nextIdx++;
  }
  const restLen = restLines.reduce((sum, l) => sum + l.length, 0);
  const mergedRest = new Uint8Array(restLen);
  let restOff = 0;
  for (const l of restLines) {
    mergedRest.set(l, restOff);
    restOff += l.length;
  }
  pieces.push(mergedRest);
  const sizes: number[] = [];
  let fileIdx = 0;
  for (const piece of pieces) {
    if (elide && piece.length === 0) continue;
    const name = `${prefix}${String(fileIdx++).padStart(digits, "0")}`;
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
