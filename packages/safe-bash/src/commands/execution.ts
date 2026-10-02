import { equalBytes } from "../byte-encoding.js";
import { createEnvCommand } from "./env/index.js";
import { getCommandArguments, readBytes, type ByteSource, type CommandDefinition, type CommandHandler } from "../contracts/index.js";
import { writeDiagnostic } from "../escaping.js";
import { shellValueByteLength } from "../contracts/value.js";
import { builtInDirectContextExecutors, define, emptyInput, encoder, escapeBytes, integer, input as fileInput, options, pathOf, syncCommandEvaluators, UsageError, value } from "./internal.js";
import type { EnvSplitLimits } from "./env-split.js";
import { delimitedArguments, replaceXargsArguments, xargsDisplay } from "./xargs-bytes.js";

export type { EnvSplitLimits } from "./env-split.js";

export interface ExecutionCommandsOptions {
  readonly maxParallelProcesses?: number;
  readonly envSplitLimits?: EnvSplitLimits;
}

export function directExecutor(fallback: CommandHandler): CommandHandler {
  return async context => {
    context.signal.throwIfAborted();
    const argumentValues = getCommandArguments(context);
    const invoke = context.invoke;
    if (invoke) return invoke(context.command, argumentValues.args, {
      argumentValues, externalInvocation: true,
      ...(context.argv0 === undefined ? {} : { argv0: context.argv0 }),
      stdin: context.stdin, cwd: context.cwd, env: context.env, stdout: context.stdout, stderr: context.stderr,
      ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
    });
    return fallback({ ...context, args: argumentValues.args, argumentValues });
  };
}

async function* argumentsFrom(source: ByteSource, signal: AbortSignal, replacement = false, lines = false): AsyncGenerator<Uint8Array | null> {
  const current: number[] = [];
  const pendingBlanks: number[] = [];
  let active = false;
  let escaped = false;
  let quote = 0;
  let lineActive = false;
  let trailingBlank = false;
  for await (const chunk of readBytes(source, signal)) {
    signal.throwIfAborted();
    for (const byte of chunk) {
      if (byte === 0) throw new UsageError("NUL in non-NUL-delimited input is not supported");
      const blank = byte === 32 || byte === 9;
      if (byte === 10 && !quote && !escaped) {
        pendingBlanks.length = 0;
        if (active) { yield Uint8Array.from(current); current.length = 0; active = false; }
        if (lines && lineActive && !trailingBlank) { yield null; lineActive = false; }
        trailingBlank = false;
        continue;
      }
      if (!blank || quote || escaped) lineActive = true;
      trailingBlank = blank && !quote && !escaped;
      if (replacement && blank && !quote && !escaped) {
        if (active) pendingBlanks.push(byte);
        continue;
      }
      if (pendingBlanks.length) { for (const byte of pendingBlanks) current.push(byte); pendingBlanks.length = 0; }
      if (escaped) { current.push(byte); active = true; escaped = false; }
      else if (quote) {
        if (byte === 10) throw new UsageError("unmatched quote in input");
        if (byte === quote) quote = 0;
        else current.push(byte);
      } else if (byte === 92) { escaped = true; active = true; }
      else if (byte === 39 || byte === 34) { quote = byte; active = true; }
      else if (byte === 10 || !replacement && (byte === 32 || byte === 9 || byte === 13 || byte === 11 || byte === 12)) {
        if (active) { yield Uint8Array.from(current); current.length = 0; active = false; }
      } else if (replacement && !active && blank) continue;
      else { current.push(byte); active = true; }
    }
  }
  if (quote || escaped) throw new UsageError(quote ? "unmatched quote in input" : "trailing backslash in input");
  if (active) yield Uint8Array.from(current);
}

export function executionCommands(execute: CommandHandler, configuration: ExecutionCommandsOptions = {}): CommandDefinition[] {
  const configured = configuration.maxParallelProcesses;
  const maxParallelProcesses = configured === undefined ? Infinity : configured;
  if (maxParallelProcesses !== Infinity && (!Number.isSafeInteger(maxParallelProcesses) || maxParallelProcesses < 1)) throw new RangeError("maxParallelProcesses must be a positive safe integer or Infinity");
  const defs = [
    createEnvCommand({ execute, envSplitLimits: configuration.envSplitLimits }),
    define("xargs", async context => {
      const rawArgumentValues = getCommandArguments(context);
      const normalizedValues = [...rawArgumentValues.values];
      const shortOptions = "0rn:s:I:d:tP:xE:a:L:";
      let expectOptionValue = false;
      for (let i = 0; i < normalizedValues.length; i++) {
        const arg = rawArgumentValues.args[i]!;
        if (expectOptionValue) { expectOptionValue = false; continue; }
        if (arg === "--" || !arg.startsWith("-") || arg === "-") break;
        if (arg === "-i" || arg === "--replace") { normalizedValues[i] = "-I{}"; continue; }
        if (arg.startsWith("-i") && !arg.startsWith("--")) { normalizedValues[i] = "-I" + arg.slice(2); continue; }
        if (arg === "-l" || arg === "--max-lines") { normalizedValues[i] = "-L1"; continue; }
        if (arg.startsWith("-l") && !arg.startsWith("--")) { normalizedValues[i] = "-L" + arg.slice(2); continue; }
        if (arg === "-e" || arg === "--eof") { normalizedValues[i] = "--eof="; continue; }
        if (arg.startsWith("-e") && !arg.startsWith("--")) { normalizedValues[i] = "-E" + arg.slice(2); continue; }
        if (!arg.startsWith("--")) {
          for (let offset = 1; offset < arg.length; offset++) {
            const specification = shortOptions.indexOf(arg[offset]!);
            if (specification < 0 || shortOptions[specification + 1] !== ":") continue;
            expectOptionValue = offset + 1 === arg.length;
            break;
          }
        } else if (["--arg-file", "--max-args", "--max-chars", "--delimiter", "--max-procs", "--process-slot-var"].includes(arg)) {
          expectOptionValue = true;
        }
      }
      const argumentValues = rawArgumentValues.withValues(normalizedValues);
      const operandIndices: number[] = [];
      let replacementOrigin: { index: number; offset: number } | undefined;
      let batching: string | undefined;
      let lastDelimMode: "0" | "d" | undefined;
      const longOptions = { "arg-file": "a", "max-lines": "L", null: "0", "no-run-if-empty": "r", "max-args": "n", "max-chars": "s", replace: "I", delimiter: "d", verbose: "t", "max-procs": "P", exit: "x", eof: "E", "process-slot-var": "process-slot-var:" };
      const parsed = options(argumentValues.args, shortOptions, longOptions, true, index => { operandIndices.push(index); },
        (key, index, offset) => { if (key === "I") replacementOrigin = { index, offset }; },
        (key, optionValue) => {
          if (key === "I" || key === "L" || key === "n" && !(batching === "I" && integer(optionValue!, 1) === 1)) batching = key;
          if (key === "0" || key === "d") lastDelimMode = key;
        });
      const requested = integer(value(parsed, "P") ?? "1");
      const parallelism = requested === 0 ? maxParallelProcesses : Math.min(requested, maxParallelProcesses);
      const slotVariable = value(parsed, "process-slot-var");
      if (slotVariable !== undefined && (!slotVariable || slotVariable.includes("=") || slotVariable.includes("\0"))) throw new UsageError("invalid environment variable name");
      const replacement = batching === "I" ? value(parsed, "I") : undefined;
      if (replacement === "") throw new UsageError("replacement string cannot be empty");
      let replacementPattern: Uint8Array | undefined;
      if (batching === "I" && replacementOrigin) {
        const { index, offset } = replacementOrigin;
        replacementPattern = argumentValues.bytes(index)!.subarray(offset);
      }
      const maxLines = batching === "L" ? integer(value(parsed, "L")!, 1) : undefined;
      const argumentFile = value(parsed, "a");
      const childInput = argumentFile === undefined ? emptyInput() : context.stdin;
      const childInputIsDefault = argumentFile === undefined ? true : context.stdinIsDefault;
      const maxArgs = replacement !== undefined ? 1 : batching === "n" ? integer(value(parsed, "n")!, 1) : Infinity;
      const size = value(parsed, "s");
      const maxBytes = size === undefined || size === "Infinity" ? Infinity : integer(size, 1);
      let delimiter = parsed.flags.has("0") ? "\0" : undefined;
      const suppliedDelimiter = value(parsed, "d");
      if (suppliedDelimiter !== undefined) {
        const bytes = escapeBytes(suppliedDelimiter).bytes;
        if (bytes.length !== 1 || bytes[0]! > 127) throw new UsageError("delimiter must be one ASCII byte");
        if (lastDelimMode === "d") delimiter = String.fromCharCode(bytes[0]!);
      }
      const command = parsed.operands[0] ?? "echo";
      const initial = argumentValues.select(operandIndices).slice(1);
      const baseBytes = encoder.encode(command).length + 1 + initial.values.reduce((sum, argument) => sum + shellValueByteLength(argument) + 1, 0);
      if (baseBytes >= maxBytes) throw new UsageError("initial arguments exceed command size limit");
      let batch: (string | Uint8Array)[] = [];
      let bytes = baseBytes;
      let lines = 0;
      let executed = false;
      let status = 0;
      let stop = false;
      let terminal = false;
      let failure: { reason: unknown } | undefined;
      let finishing = false;
      let cleanupPromise: Promise<void> | undefined;
      let inputIterator: AsyncIterator<Uint8Array> | undefined;
      let inputFinished = false;
      let inputReturn: Promise<IteratorResult<Uint8Array>> | undefined;
      let wake: (() => void) | undefined;
      const active = new Set<Promise<void>>();
      const slots = new Set<number>();
      const children = new AbortController();
      const input = new AbortController();
      const inputStopped = new Error("xargs input admission closed");
      const childSignal = AbortSignal.any([context.signal, children.signal]);
      const inputSignal = AbortSignal.any([context.signal, input.signal]);
      const notify = () => { const waiting = wake; wake = undefined; waiting?.(); };
      const stopInput = () => { stop = true; input.abort(inputStopped); notify(); };
      const closeInput = (): Promise<IteratorResult<Uint8Array>> => {
        inputReturn ??= Promise.resolve().then(() => inputFinished ? { done: true, value: undefined } : inputIterator?.return?.() ?? { done: true, value: undefined });
        return inputReturn;
      };
      const fail = (reason: unknown) => {
        failure ??= { reason };
        stopInput();
        children.abort(reason);
      };
      const cancelled = () => { stopInput(); children.abort(context.signal.reason); };
      const cleanup = (): Promise<void> => {
        if (!cleanupPromise) {
          stopInput();
          if (!finishing) children.abort(inputStopped);
          cleanupPromise = Promise.resolve().then(async () => {
            try {
              const results = await Promise.allSettled([closeInput(), ...active]);
              for (const result of results) if (result.status === "rejected") throw result.reason;
            } finally { context.signal.removeEventListener("abort", cancelled); }
          });
        }
        return cleanupPromise;
      };
      context.registerCleanup?.(cleanup);
      context.signal.addEventListener("abort", cancelled, { once: true });
      if (context.signal.aborted) cancelled();
      const source: ByteSource = { [Symbol.asyncIterator]() {
        inputSignal.throwIfAborted();
        inputIterator = (argumentFile === undefined ? context.stdin : fileInput({ ...context, signal: inputSignal }, pathOf(context, argumentFile)))[Symbol.asyncIterator]();
        return {
          async next() {
            const result = await inputIterator!.next();
            inputFinished = result.done === true;
            return result;
          },
          return: closeInput,
        };
      } };
      const capacity = async () => {
        while (!stop && active.size >= parallelism) await new Promise<void>(resolve => { wake = resolve; });
      };
      const dispatch = async () => {
        if (stop) return;
        const childArguments = initial.withValues(replacementPattern === undefined || parsed.operands.length === 0 ? [...initial.values, ...batch] : await replaceXargsArguments(initial.values, replacementPattern, batch[0] ?? "", maxBytes - encoder.encode(command).length - 1, context.signal));
        const args = childArguments.args;
        const size = encoder.encode(command).length + 1 + childArguments.values.reduce((sum, argument) => sum + shellValueByteLength(argument) + 1, 0);
        if (size > maxBytes) throw new UsageError("expanded arguments exceed command size limit");
        if (parsed.flags.has("t")) await writeDiagnostic(context.stderr, [command, ...childArguments.values].map(xargsDisplay).join(" ") + "\n", context.signal);
        if (stop) return;
        context.signal.throwIfAborted();
        executed = true;
        batch = []; bytes = baseBytes; lines = 0;
        let slot = 0;
        while (slots.has(slot)) slot++;
        slots.add(slot);
        const pending = Promise.resolve().then(() => {
          childSignal.throwIfAborted();
          const env = slotVariable === undefined ? context.env : { ...context.env, [slotVariable]: String(slot) };
          if (context.invoke) return context.invoke(command, args, {
            argumentValues: childArguments, externalInvocation: true, stdin: childInput, ...(childInputIsDefault === undefined ? {} : { stdinIsDefault: childInputIsDefault }),
            cwd: context.cwd, env, stdout: context.stdout, stderr: context.stderr, signal: childSignal,
          });
          return execute({ ...context, command, args, argumentValues: childArguments, stdin: childInput, ...(childInputIsDefault === undefined ? {} : { stdinIsDefault: childInputIsDefault }), env, signal: childSignal });
        }).then(result => {
          const exitCode = result.exitCode;
          if (!terminal && (exitCode === 255 || exitCode === 126 || exitCode === 127)) {
            terminal = true;
            status = exitCode === 255 ? 124 : exitCode;
            stopInput();
          } else if (!terminal && exitCode !== 0) status = 123;
        }).catch(fail).then(() => { slots.delete(slot); active.delete(pending); notify(); });
        active.add(pending);
      };
      const eof = value(parsed, "E");
      const eofBytes = eof !== undefined && eof !== "" ? encoder.encode(eof) : undefined;
      try {
        if (delimiter !== undefined && eof !== undefined && eof !== "") await writeDiagnostic(context.stderr, "xargs: warning: the -E option has no effect if -0 or -d is used.\n\n", context.signal);
        const incoming = delimiter === undefined
          ? argumentsFrom(source, inputSignal, replacement !== undefined, maxLines !== undefined && replacement === undefined)
          : delimitedArguments(source, inputSignal, context.signal, delimiter.charCodeAt(0), replacement === undefined ? maxBytes - baseBytes - 1 : maxBytes - 1);
        for await (const argument of incoming) {
          if (argument === null) {
            if (++lines === maxLines && batch.length) {
              await dispatch();
              await capacity();
              if (stop) break;
            }
            continue;
          }
          if (stop || delimiter === undefined && eofBytes !== undefined && equalBytes(typeof argument === "string" ? encoder.encode(argument) : argument, eofBytes)) break;
          const size = (typeof argument === "string" ? shellValueByteLength(argument) : argument.byteLength) + 1;
          if (replacement === undefined && baseBytes + size > maxBytes) throw new UsageError("single argument exceeds command size limit");
          if (batch.length && (batch.length === maxArgs || bytes + size > maxBytes)) {
            if ((parsed.flags.has("x") || maxLines !== undefined) && batch.length < maxArgs) throw new UsageError("command size limit exceeded");
            await dispatch();
            await capacity();
            if (stop) break;
          }
          batch.push(argument); bytes += size;
          if (batch.length === maxArgs || delimiter !== undefined && maxLines !== undefined && ++lines === maxLines) {
            await dispatch();
            await capacity();
            if (stop) break;
          }
        }
        if (!stop && (batch.length || !executed && !parsed.flags.has("r") && replacement === undefined)) await dispatch();
      } catch (error) {
        if (error !== inputStopped) fail(error);
      } finally {
        finishing = true;
        try { await cleanup(); }
        catch (error) { failure ??= { reason: error }; }
      }
      context.signal.throwIfAborted();
      if (failure) throw failure.reason;
      return { exitCode: status };
    }),
  ];
  if (configuration.maxParallelProcesses === undefined && configuration.envSplitLimits === undefined) {
    for (const def of defs) builtInDirectContextExecutors.add(def.execute);
  }
  return defs;
}


function splitEnvStringSync(raw: string, vars: Readonly<Record<string, string | undefined>>): string[] | undefined {
  const tokens: string[] = [];
  let cur = "";
  let active = false;
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (!quote && (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v")) {
      if (active) { tokens.push(cur); cur = ""; active = false; }
      continue;
    }
    if (!quote && ch === "#") {
      if (!active) {
        while (i < raw.length && raw[i] !== "\n") i++;
        continue;
      }
    }
    if (ch === "'" && quote !== "\"") {
      quote = quote === "'" ? null : "'";
      active = true;
      continue;
    }
    if (ch === "\"" && quote !== "'") {
      quote = quote === "\"" ? null : "\"";
      active = true;
      continue;
    }
    if (ch === "\\") {
      const nxt = raw[++i];
      if (nxt === undefined) return undefined;
      if (quote === "'") {
        if (nxt === "'" || nxt === "\\") cur += nxt;
        else cur += "\\" + nxt;
      } else {
        if (nxt === "n") cur += "\n";
        else if (nxt === "t") cur += "\t";
        else if (nxt === "r") cur += "\r";
        else if (nxt === "f") cur += "\f";
        else if (nxt === "v") cur += "\v";
        else if (nxt === "c") return tokens.concat(active ? [cur] : []);
        else if (nxt === "_" ) {
          if (!quote && active) { tokens.push(cur); cur = ""; active = false; }
          else if (quote) cur += " ";
        } else cur += nxt;
      }
      active = true;
      continue;
    }
    if (ch === "$" && quote !== "'") {
      if (raw[i + 1] === "{") {
        const close = raw.indexOf("}", i + 2);
        if (close < 0) return undefined;
        const vName = raw.slice(i + 2, close);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(vName)) return undefined;
        cur += vars[vName] ?? "";
        active = true;
        i = close;
        continue;
      }
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.slice(i + 1));
      if (!m) return undefined;
      cur += vars[m[0]] ?? "";
      active = true;
      i += m[0].length;
      continue;
    }
    cur += ch;
    active = true;
  }
  if (quote) return undefined;
  if (active) tokens.push(cur);
  return tokens;
}

export function evalSyncEnv(
  rawOpArgs: readonly string[],
  exported: ReadonlySet<string>,
  variables: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const opArgs = [...rawOpArgs];
  let ignoreEnv = false;
  let nullDelim = false;
  const unsetNames: string[] = [];
  let i = 0;
  while (i < opArgs.length) {
    const a = opArgs[i]!;
    if (a === "--") { i++; break; }
    if (a === "-") { ignoreEnv = true; i++; continue; }
    if (!a.startsWith("-")) break;
    if (a === "-i" || a === "--ignore-environment") {
      ignoreEnv = true;
      i++;
      continue;
    }
    if (a === "-0" || a === "--null") {
      nullDelim = true;
      i++;
      continue;
    }
    if (a === "-u" || a === "--unset") {
      const v = opArgs[++i];
      if (!v || v.includes("=") || v.includes("\0")) return undefined;
      unsetNames.push(v);
      i++;
      continue;
    }
    if (a.startsWith("--unset=")) {
      const v = a.slice(8);
      if (!v || v.includes("=") || v.includes("\0")) return undefined;
      unsetNames.push(v);
      i++;
      continue;
    }
    if (a === "-S" || a === "--split-string" || a.startsWith("--split-string=") || (a.startsWith("-S") && a.length > 2)) {
      const rawSplit = a.startsWith("--split-string=") ? a.slice(15) : (a.startsWith("-S") && a.length > 2 ? a.slice(2) : opArgs[++i]);
      if (rawSplit === undefined) return undefined;
      const expanded = splitEnvStringSync(rawSplit, variables);
      if (!expanded) return undefined;
      opArgs.splice(i, 1, ...expanded);
      continue;
    }
    if (!a.startsWith("--") && a.length > 1) {
      let ok = true;
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "i") ignoreEnv = true;
        else if (ch === "0") nullDelim = true;
        else if (ch === "u") {
          const rest = a.slice(j + 1);
          const v = rest.length > 0 ? rest : opArgs[++i];
          if (!v || v.includes("=") || v.includes("\0")) { ok = false; break; }
          unsetNames.push(v);
          break;
        } else {
          ok = false;
          break;
        }
      }
      if (!ok) return undefined;
      i++;
      continue;
    }
    return undefined;
  }
  const env: Record<string, string> = Object.create(null);
  if (!ignoreEnv) {
    for (const k of exported) {
      const v = variables[k];
      if (v !== undefined) env[k] = v;
    }
  }
  for (const u of unsetNames) delete env[u];
  const inheritedNames = Object.keys(env);
  const addedNames: string[] = [];
  while (i < opArgs.length && opArgs[i]!.includes("=")) {
    const assign = opArgs[i++]!;
    const eq = assign.indexOf("=");
    const name = assign.slice(0, eq);
    const val = assign.slice(eq + 1);
    if (!name || name.includes("\0") || val.includes("\0")) return undefined;
    if (!Object.hasOwn(env, name)) addedNames.push(name);
    env[name] = val;
  }
  const names = [...addedNames.reverse(), ...inheritedNames];
  if (i === opArgs.length) {
    const sep = nullDelim ? "\0" : "\n";
    let out = "";
    for (const name of names) out += `${name}=${env[name]}${sep}`;
    return out;
  }
  if (nullDelim) return undefined;
  const cmd = opArgs[i]!;
  const cmdArgs = opArgs.slice(i + 1);
  if (cmd === "printenv") {
    let sep = "\n";
    let pIdx = 0;
    while (pIdx < cmdArgs.length) {
      const pa = cmdArgs[pIdx]!;
      if (pa === "--") { pIdx++; break; }
      if (pa === "--null" || /^-0+$/.test(pa)) { sep = "\0"; pIdx++; continue; }
      if (pa.startsWith("-")) return undefined;
      break;
    }
    const pNames = cmdArgs.slice(pIdx);
    if (pNames.length === 0) {
      let out = "";
      for (const name of names) out += `${name}=${env[name]}${sep}`;
      return out;
    }
    let out = "";
    for (const k of pNames) {
      if (k.includes("=") || !Object.hasOwn(env, k)) return undefined;
      out += `${env[k]}${sep}`;
    }
    return out;
  }
  if (cmd === "echo") {
    let noNl = false;
    let start = 0;
    if (cmdArgs[0] === "-n") { noNl = true; start = 1; }
    if (cmdArgs.slice(start).every(a => !a.startsWith("-"))) {
      return cmdArgs.slice(start).join(" ") + (noNl ? "" : "\n");
    }
  }
  if (cmd === "true") return "";
  return undefined;
}

const syncXargsDecoder = new TextDecoder("utf-8", { fatal: true });

export function evalSyncXargs(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let noRunIfEmpty = false;
    let maxArgs: number | undefined;
    let maxLines: number | undefined;
    let replaceStr: string | undefined;
    let delimChar: string | undefined;
    let eofStr: string | undefined;
    let argFile: string | undefined;
    let i = 0;
    while (i < opArgs.length) {
      const a = opArgs[i]!;
      if (a === "--") { i++; break; }
      if (!a.startsWith("-") || a === "-") break;
      if (a === "-r" || a === "--no-run-if-empty") { noRunIfEmpty = true; i++; continue; }
      if (a === "-0" || a === "--null") { delimChar = "\0"; i++; continue; }
      if (a === "-i" || a === "--replace") { replaceStr = "{}"; maxArgs = undefined; maxLines = undefined; i++; continue; }
      if (a.startsWith("--replace=")) { replaceStr = a.slice(10) || "{}"; maxArgs = undefined; maxLines = undefined; i++; continue; }
      if (a.startsWith("--max-args=")) {
        const v = a.slice(11);
        if (!/^[1-9][0-9]*$/.test(v)) return undefined;
        if (replaceStr === undefined || Number(v) !== 1) { maxArgs = Number(v); replaceStr = undefined; maxLines = undefined; }
        i++; continue;
      }
      if (a.startsWith("--max-lines=")) {
        const v = a.slice(12);
        if (!/^[1-9][0-9]*$/.test(v)) return undefined;
        maxLines = Number(v); maxArgs = undefined; replaceStr = undefined; i++; continue;
      }
      if (a.startsWith("-I")) {
        const v = a.length > 2 ? a.slice(2) : opArgs[++i];
        if (!v) return undefined;
        replaceStr = v;
        maxArgs = undefined;
        maxLines = undefined;
        i++;
        continue;
      }
      if (a.startsWith("-n") || a === "--max-args") {
        const v = a.startsWith("-n") && a.length > 2 ? a.slice(2) : opArgs[++i];
        if (!v || !/^[1-9][0-9]*$/.test(v)) return undefined;
        if (replaceStr === undefined || Number(v) !== 1) {
          maxArgs = Number(v);
          replaceStr = undefined;
          maxLines = undefined;
        }
        i++;
        continue;
      }
      if (a.startsWith("-L") || a === "--max-lines" || a === "-l") {
        const v = a === "-l" ? "1" : (a.startsWith("-L") && a.length > 2 ? a.slice(2) : opArgs[++i]);
        if (!v || !/^[1-9][0-9]*$/.test(v)) return undefined;
        maxLines = Number(v);
        replaceStr = undefined;
        maxArgs = undefined;
        i++;
        continue;
      }
      if (a.startsWith("-d") || a === "--delimiter") {
        const v = a.startsWith("-d") && a.length > 2 ? a.slice(2) : opArgs[++i];
        if (v === undefined) return undefined;
        const parsed = v === "\\n" ? "\n" : v === "\\t" ? "\t" : v.length === 1 ? v : undefined;
        if (!parsed) return undefined;
        delimChar = parsed;
        i++;
        continue;
      }
      if (a.startsWith("-E") || a === "--eof") {
        const v = a.startsWith("-E") && a.length > 2 ? a.slice(2) : opArgs[++i];
        if (v === undefined) return undefined;
        eofStr = v || undefined;
        i++;
        continue;
      }
      if (a.startsWith("-a") || a === "--arg-file") {
        const v = a.startsWith("-a") && a.length > 2 ? a.slice(2) : opArgs[++i];
        if (!v) return undefined;
        argFile = v;
        i++;
        continue;
      }
      if (!a.startsWith("--") && a.length > 1) {
        let ok = true;
        for (let j = 1; j < a.length; j++) {
          const ch = a[j]!;
          if (ch === "r") noRunIfEmpty = true;
          else if (ch === "0") delimChar = "\0";
          else if (ch === "i") { replaceStr = "{}"; maxArgs = undefined; maxLines = undefined; }
          else if (ch === "n") {
            const rest = a.slice(j + 1);
            const v = rest.length > 0 ? rest : opArgs[++i];
            if (!v || !/^[1-9][0-9]*$/.test(v)) { ok = false; break; }
            if (replaceStr === undefined || Number(v) !== 1) { maxArgs = Number(v); replaceStr = undefined; maxLines = undefined; }
            break;
          } else if (ch === "L") {
            const rest = a.slice(j + 1);
            const v = rest.length > 0 ? rest : opArgs[++i];
            if (!v || !/^[1-9][0-9]*$/.test(v)) { ok = false; break; }
            maxLines = Number(v); replaceStr = undefined; maxArgs = undefined;
            break;
          } else if (ch === "I") {
            const rest = a.slice(j + 1);
            const v = rest.length > 0 ? rest : opArgs[++i];
            if (!v) { ok = false; break; }
            replaceStr = v; maxArgs = undefined; maxLines = undefined;
            break;
          } else {
            ok = false;
            break;
          }
        }
        if (ok) { i++; continue; }
      }
      return undefined;
    }
    const cmd = opArgs[i] ?? "echo";
    if (cmd !== "echo" && cmd !== "printf" && cmd !== "basename" && cmd !== "dirname" && cmd !== "cat" && cmd !== "wc" && cmd !== "head" && cmd !== "tail" && cmd !== "true") return undefined;
    const initialArgs = opArgs.slice(i + 1);
    let echoNoNewline = false;
    let initOffset = 0;
    if (cmd === "echo" && initialArgs[0] === "-n") {
      echoNoNewline = true;
      initOffset = 1;
    }
    if (cmd === "echo" || cmd === "dirname") {
      for (let k = initOffset; k < initialArgs.length; k++) {
        if (initialArgs[k]!.startsWith("-")) return undefined;
      }
    }
    const baseInitial = initialArgs.slice(initOffset);
    let sourceBytes = inBytes;
    if (argFile !== undefined) {
      if (!readFileSync) return undefined;
      sourceBytes = readFileSync(argFile);
    }
    if (!sourceBytes || sourceBytes.byteLength > 16384 || (delimChar !== "\0" && sourceBytes.includes(0))) return undefined;
    const text = syncXargsDecoder.decode(sourceBytes);
    const items: (string | null)[] = [];
    if (delimChar !== undefined) {
      if (text.length > 0) {
        const parts = text.endsWith(delimChar) ? text.slice(0, -delimChar.length).split(delimChar) : text.split(delimChar);
        for (const p of parts) items.push(p);
      }
    } else if (replaceStr !== undefined) {
      for (const rawLine of text.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        if (eofStr !== undefined && trimmed === eofStr) break;
        items.push(trimmed);
      }
    } else {
      let cur = "";
      let active = false;
      let quote = "";
      let escaped = false;
      let lineHasToken = false;
      for (let p = 0; p < text.length; p++) {
        const ch = text[p]!;
        if (escaped) {
          cur += ch;
          active = true;
          lineHasToken = true;
          escaped = false;
          continue;
        }
        if (quote) {
          if (ch === "\n") return undefined;
          if (ch === quote) quote = "";
          else cur += ch;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          active = true;
          lineHasToken = true;
          continue;
        }
        if (ch === "\"" || ch === "'") {
          quote = ch;
          active = true;
          lineHasToken = true;
          continue;
        }
        if (ch === "\n" || ch === " " || ch === "\t" || ch === "\r") {
          if (active) {
            if (eofStr !== undefined && cur === eofStr) break;
            items.push(cur);
            cur = "";
            active = false;
          }
          if (ch === "\n" && maxLines !== undefined && lineHasToken) {
            items.push(null);
            lineHasToken = false;
          }
          continue;
        }
        cur += ch;
        active = true;
        lineHasToken = true;
      }
      if (quote || escaped) return undefined;
      if (active) {
        if (eofStr === undefined || cur !== eofStr) items.push(cur);
      }
    }
    const tokens = items.filter((x): x is string => x !== null);
    if (tokens.length === 0) {
      if (noRunIfEmpty || replaceStr !== undefined || maxLines !== undefined) return "";
      return baseInitial.join(" ") + (echoNoNewline ? "" : "\n");
    }
    let out = "";
    const evalBatchCmd = (args: string[]): string | undefined => {
      if (cmd === "echo") return args.join(" ") + (echoNoNewline ? "" : "\n");
      if (cmd === "true") return "";
      if (cmd === "cat") return syncCommandEvaluators.evalSyncCat?.(undefined, args, readFileSync);
      if (cmd === "wc") return syncCommandEvaluators.evalSyncWc?.(undefined, args, true, readFileSync);
      if (cmd === "head" || cmd === "tail") return syncCommandEvaluators.evalSyncHeadTail?.(cmd, undefined, args, readFileSync);
      if (cmd === "dirname") {
        if (args.length === 0) return undefined;
        return args.map(p => {
          const s = p.replace(/\/+$/, "");
          if (!s) return "/";
          const sl = s.lastIndexOf("/");
          if (sl < 0) return ".";
          const pref = s.slice(0, sl).replace(/\/+$/, "");
          return pref || "/";
        }).join("\n") + "\n";
      }
      if (cmd === "basename") {
        let multi = false;
        let suffix: string | undefined;
        const ops: string[] = [];
        for (let k = 0; k < args.length; k++) {
          const a = args[k]!;
          if (a === "-a" || a === "--multiple") multi = true;
          else if ((a === "-s" || a === "--suffix") && k + 1 < args.length) { multi = true; suffix = args[++k]!; }
          else if (a.startsWith("-s") && a.length > 2) { multi = true; suffix = a.slice(2); }
          else if (a.startsWith("--suffix=")) { multi = true; suffix = a.slice(9); }
          else if (a.startsWith("-")) return undefined;
          else ops.push(a);
        }
        if (ops.length === 0 || (!multi && ops.length > 2)) return undefined;
        if (!multi && ops.length === 2) suffix = ops.pop();
        return ops.map(p => {
          const clean = p.replace(/\/+$/, "");
          if (!clean) return "/";
          const sl = clean.lastIndexOf("/");
          let base = sl < 0 ? clean : clean.slice(sl + 1);
          if (suffix && base.length > suffix.length && base.endsWith(suffix)) base = base.slice(0, -suffix.length);
          return base;
        }).join("\n") + "\n";
      }
      if (cmd === "printf") {
        if (args.length === 0) return undefined;
        const fmt = args[0]!;
        const vals = args.slice(1);
        let vIdx = 0;
        let res = "";
        const applyOnce = (): boolean => {
          for (let k = 0; k < fmt.length; k++) {
            if (fmt[k] === "\\") {
              const nxt = fmt[++k];
              if (nxt === "n") res += "\n";
              else if (nxt === "t") res += "\t";
              else if (nxt === "\\") res += "\\";
              else return false;
            } else if (fmt[k] === "%") {
              const nxt = fmt[++k];
              if (nxt === "%") res += "%";
              else if (nxt === "s") res += vals[vIdx++] ?? "";
              else if (nxt === "d") {
                const raw = vals[vIdx++] ?? "0";
                if (!/^-?[0-9]+$/.test(raw)) return false;
                res += String(Number(raw));
              } else return false;
            } else {
              res += fmt[k]!;
            }
          }
          return true;
        };
        if (vals.length === 0) {
          if (!applyOnce()) return undefined;
        } else {
          while (vIdx < vals.length) {
            const before = vIdx;
            if (!applyOnce()) return undefined;
            if (vIdx === before) break;
          }
        }
        return res;
      }
      return undefined;
    };
    let failedCmd = false;
    const runEcho = (batch: string[]) => {
      if (failedCmd) return;
      let args: string[];
      if (replaceStr !== undefined) {
        const val = batch[0]!;
        if (baseInitial.some(a => a.includes(replaceStr!))) {
          args = baseInitial.map(a => a.split(replaceStr!).join(val));
        } else {
          args = [...baseInitial, val];
        }
      } else {
        args = [...baseInitial, ...batch];
      }
      const chunk = evalBatchCmd(args);
      if (chunk === undefined) { failedCmd = true; return; }
      out += chunk;
    };
    if (replaceStr !== undefined) {
      for (const tok of tokens) runEcho([tok]);
    } else if (maxLines !== undefined) {
      let batch: string[] = [];
      let linesSeen = 0;
      for (const it of items) {
        if (it === null) {
          linesSeen++;
          if (linesSeen >= maxLines && batch.length > 0) {
            runEcho(batch);
            batch = [];
            linesSeen = 0;
          }
        } else {
          batch.push(it);
        }
      }
      if (batch.length > 0) runEcho(batch);
    } else {
      const limit = maxArgs ?? Infinity;
      for (let k = 0; k < tokens.length; k += limit) {
        runEcho(tokens.slice(k, k + limit));
      }
    }
    if (failedCmd) return undefined;
    return out;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.executionCommands = executionCommands;
syncCommandEvaluators.evalSyncEnv = evalSyncEnv;
syncCommandEvaluators.evalSyncXargs = evalSyncXargs;
