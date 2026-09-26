import { createOutputOperation, FsError, type ByteSource, type CommandContext, type CommandDefinition } from "../contracts/index.js";
import { openFileOutput, type FileOutput } from "../contracts/filesystem-output.js";
import { outputFailure } from "../contracts/io.js";
import { assertCommandRequirements, type CommandFileSystemRequirement } from "../contracts/command-requirements.js";
import { inputRequirements } from "./portable-requirements.js";
import { followTail, parseTailFollow } from "./tail-follow.js";
import { wcDisplayWidth } from "./wc-width.js";
import { RecordBuffer } from "./record-buffer.js";
import { PublicDiagnostic } from "../diagnostics.js";
import {
  assertInputRequirements, bufferLimit, concatenate, define, diagnostic, encoder, input,
  lines, options, output, pathOf, RESOLVED_EXIT_ZERO, UsageError, value,
} from "./internal.js";

const syncResolved = Symbol.for("safe-bash.syncResolved");
function isSyncResolved(promise: unknown): boolean {
  return Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

const sharedTrOutBuffer = new Uint8Array(64 * 1024);
let sharedTrOutInUse = false;
interface TrCompiledConfig {
  readonly deleting: boolean;
  readonly squeezing: boolean;
  readonly mapping: Uint8Array;
  readonly removed: Uint8Array;
  readonly squeezed: Uint8Array;
}
const trConfigCache = new Map<string, TrCompiledConfig>();
let lastTrArg0: string | undefined;
let lastTrArg1: string | undefined;
let lastTrConfig: TrCompiledConfig | undefined;
const STDIN_REQUIREMENT_MODES = ["stdin"] as const;

function compileTrConfig(args: readonly string[]): TrCompiledConfig {
  if (args.length === 2 && args[0] === lastTrArg0 && args[1] === lastTrArg1 && lastTrConfig !== undefined) {
    return lastTrConfig;
  }
  const cacheKey = args.length <= 4 ? args.join("\0") : undefined;
  if (cacheKey !== undefined) {
    const cached = trConfigCache.get(cacheKey);
    if (cached) return cached;
  }
  const parsed = options(args, "dscCt", { delete: "d", "squeeze-repeats": "s", complement: "c", "truncate-set1": "t" });
  const deleting = parsed.flags.has("d");
  const squeezing = parsed.flags.has("s");
  const translating = !deleting && parsed.operands.length === 2;
  if (parsed.operands.length < 1 || parsed.operands.length > 2 || !deleting && !squeezing && parsed.operands.length !== 2
    || deleting && !squeezing && parsed.operands.length !== 1 || deleting && squeezing && parsed.operands.length !== 2) throw new UsageError("invalid number of character sets");
  const firstSet = characterSet(parsed.operands[0]!);
  let first = firstSet.bytes;
  let firstCaseOffsets = firstSet.caseOffsets;
  if (parsed.flags.has("c") || parsed.flags.has("C")) {
    const selected = new Set(first);
    first = Array.from({ length: 256 }, (_, offset) => offset).filter(byte => !selected.has(byte));
    firstCaseOffsets = new Set();
  }
  const secondSet = parsed.operands[1] === undefined ? { bytes: [] as number[], caseOffsets: new Set<number>(), endsWithClass: false } : characterSet(parsed.operands[1], translating ? first.length : undefined, translating);
  const second = secondSet.bytes;
  if (translating) {
    if (!parsed.flags.has("t") && secondSet.endsWithClass && first.length > second.length) {
      throw new PublicDiagnostic("when translating with string1 longer than string2, the latter string must not end with a character class");
    }
    for (const offset of secondSet.caseOffsets) {
      if (!firstCaseOffsets.has(offset)) throw new PublicDiagnostic("misaligned [:upper:] and/or [:lower:] construct");
    }
  }
  if (translating && parsed.flags.has("t")) first = first.slice(0, second.length);
  if (translating && !second.length && !parsed.flags.has("t")) throw new UsageError("second character set must not be empty");
  const mapping = new Uint8Array(256);
  for (let offset = 0; offset < 256; offset++) mapping[offset] = offset;
  if (translating) first.forEach((byte, index) => { mapping[byte] = second[Math.min(index, second.length - 1)]!; });
  const removed = new Uint8Array(256);
  if (deleting) for (const byte of first) removed[byte] = 1;
  const squeezed = new Uint8Array(256);
  if (squeezing) for (const byte of (parsed.operands.length === 2 ? second : first)) squeezed[byte] = 1;
  const config: TrCompiledConfig = { deleting, squeezing, mapping, removed, squeezed };
  if (cacheKey !== undefined) {
    if (trConfigCache.size >= 32) trConfigCache.clear();
    trConfigCache.set(cacheKey, config);
  }
  if (args.length === 2) {
    lastTrArg0 = args[0];
    lastTrArg1 = args[1];
    lastTrConfig = config;
  }
  return config;
}

const inspectedInputRequirements: readonly CommandFileSystemRequirement[] = inputRequirements.map(mode => mode.id === "file" ? { ...mode, capabilities: ["stat", "access"] } : mode);
const countRequirements: readonly CommandFileSystemRequirement[] = [
  ...inputRequirements,
  { id: "width", description: "Inspect file sizes for column widths", capabilities: ["stat"] },
];
const teeRequirements: readonly CommandFileSystemRequirement[] = [
  { id: "stdout", description: "Copy standard input to standard output", capabilities: [] },
  { id: "overwrite", description: "Write output files", capabilities: [], anyOf: [["streamingWrite"], ["write", "append"]], mutates: true },
  { id: "append", description: "Append to output files", capabilities: [], anyOf: [["streamingAppend"], ["append"]], mutates: true },
];
const streamRequirements: Readonly<Record<string, readonly CommandFileSystemRequirement[]>> = {
  cat: inputRequirements, head: inspectedInputRequirements, tail: inspectedInputRequirements,
  wc: countRequirements, tee: teeRequirements, tr: [],
};

async function* combinedInput(context: CommandContext, names: readonly string[], state: { exitCode: number }): ByteSource {
  for (const name of names.length ? names : ["-"]) {
    try { yield* input(context, name); }
    catch (error) { await diagnostic(context, error); state.exitCode = 1; }
  }
}

function prefixSyncOrAsync(context: CommandContext, source: ByteSource, count: number, bytes: boolean, skip: boolean, delimiter: number): Promise<void> | undefined {
  let remaining = count;
  if (!remaining && !skip) return undefined;
  const iter = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
    syncReturn?: () => void;
  };
  if (typeof iter.tryNextSync === "function") {
    const syncSink = !(context.stdout as { isPipeStage?: boolean }).isPipeStage
      ? (context.stdout as { writeSync?: (chunk: Uint8Array) => boolean })
      : undefined;
    const canWriteSync = typeof syncSink?.writeSync === "function";
    let done = false;
    try {
      while (true) {
        const step = iter.tryNextSync();
        if (step === undefined) {
          return prefixContinueAsync(context, iter, remaining, bytes, skip, delimiter, canWriteSync, syncSink);
        }
        if (step.done) { done = true; return undefined; }
        const chunk = step.value;
        context.signal.throwIfAborted();
        let offset = 0;
        if (remaining) {
          if (bytes) { offset = Math.min(chunk.length, remaining); remaining -= offset; }
          else {
            for (; offset < chunk.length && remaining; offset++) if (chunk[offset] === delimiter) remaining--;
          }
        }
        if (skip) {
          if (!remaining && offset < chunk.length) {
            const slice = chunk.subarray(offset);
            if (!canWriteSync || syncSink!.writeSync!(slice) === false) {
              const p = output(context, slice);
              if (!isSyncResolved(p)) {
                return p.then(() => prefixContinueAsync(context, iter, remaining, bytes, skip, delimiter, canWriteSync, syncSink));
              }
            }
          }
        } else {
          if (offset) {
            const slice = chunk.subarray(0, offset);
            if (!canWriteSync || syncSink!.writeSync!(slice) === false) {
              const p = output(context, slice);
              if (!isSyncResolved(p)) {
                if (!remaining) {
                  done = true;
                  return p.finally(() => {
                    if (typeof iter.syncReturn === "function") iter.syncReturn();
                    else return iter.return?.();
                  });
                }
                return p.then(() => prefixContinueAsync(context, iter, remaining, bytes, skip, delimiter, canWriteSync, syncSink));
              }
            }
          }
          if (!remaining) {
            done = true;
            if (typeof iter.syncReturn === "function") {
              iter.syncReturn();
              return undefined;
            }
            return iter.return ? iter.return().then(() => undefined) : undefined;
          }
        }
      }
    } catch (err) {
      if (!done && typeof iter.syncReturn === "function") iter.syncReturn();
      throw err;
    }
  }
  return prefix(context, source, count, bytes, skip, delimiter);
}

async function prefixContinueAsync(
  context: CommandContext,
  iter: AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined; syncReturn?: () => void },
  remaining: number,
  bytes: boolean,
  skip: boolean,
  delimiter: number,
  canWriteSync: boolean,
  syncSink: { writeSync?: (chunk: Uint8Array) => boolean } | undefined,
): Promise<void> {
  let done = false;
  try {
    while (true) {
      let step = iter.tryNextSync!();
      if (step === undefined) step = await iter.next();
      if (step.done) { done = true; break; }
      const chunk = step.value;
      context.signal.throwIfAborted();
      let offset = 0;
      if (remaining) {
        if (bytes) { offset = Math.min(chunk.length, remaining); remaining -= offset; }
        else {
          for (; offset < chunk.length && remaining; offset++) if (chunk[offset] === delimiter) remaining--;
        }
      }
      if (skip) {
        if (!remaining && offset < chunk.length) {
          const slice = chunk.subarray(offset);
          if (!canWriteSync || syncSink!.writeSync!(slice) === false) {
            const p = output(context, slice);
            if (!isSyncResolved(p)) await p;
          }
        }
      } else {
        if (offset) {
          const slice = chunk.subarray(0, offset);
          if (!canWriteSync || syncSink!.writeSync!(slice) === false) {
            const p = output(context, slice);
            if (!isSyncResolved(p)) await p;
          }
        }
        if (!remaining) return;
      }
    }
  } finally {
    if (!done) {
      if (typeof iter.syncReturn === "function") iter.syncReturn();
      else await iter.return?.();
    }
  }
}

async function prefix(context: CommandContext, source: ByteSource, count: number, bytes: boolean, skip: boolean, delimiter: number): Promise<void> {
  let remaining = count;
  if (!remaining && !skip) return;
  const iter = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
    syncReturn?: () => void;
  };
  const canTrySync = typeof iter.tryNextSync === "function";
  const syncSink = !(context.stdout as { isPipeStage?: boolean }).isPipeStage
    ? (context.stdout as { writeSync?: (chunk: Uint8Array) => boolean })
    : undefined;
  const canWriteSync = typeof syncSink?.writeSync === "function";
  let done = false;
  try {
    while (true) {
      let step = canTrySync ? iter.tryNextSync!() : undefined;
      if (step === undefined) step = await iter.next();
      if (step.done) { done = true; break; }
      const chunk = step.value;
      context.signal.throwIfAborted();
      let offset = 0;
      if (remaining) {
        if (bytes) { offset = Math.min(chunk.length, remaining); remaining -= offset; }
        else {
          for (; offset < chunk.length && remaining; offset++) if (chunk[offset] === delimiter) remaining--;
        }
      }
      if (skip) {
        if (!remaining && offset < chunk.length) {
          const slice = chunk.subarray(offset);
          if (!canWriteSync || syncSink!.writeSync!(slice) === false) {
            const p = output(context, slice);
            if (!isSyncResolved(p)) await p;
          }
        }
      } else {
        if (offset) {
          const slice = chunk.subarray(0, offset);
          if (!canWriteSync || syncSink!.writeSync!(slice) === false) {
            const p = output(context, slice);
            if (!isSyncResolved(p)) await p;
          }
        }
        if (!remaining) return;
      }
    }
  } finally {
    if (!done) {
      if (typeof iter.syncReturn === "function") iter.syncReturn();
      else await iter.return?.();
    }
  }
}

async function suffix(context: CommandContext, source: ByteSource, count: number, bytes: boolean, omit: boolean, delimiter: number): Promise<void> {
  if (!bytes) {
    const delimiterByte = Uint8Array.of(delimiter);
    let pendingLines: { bytes: Uint8Array; terminated: boolean }[] = [];
    let start = 0;
    let size = 0;
    const pending = new RecordBuffer(bufferLimit);
    const pushLine = async (lineBytes: Uint8Array, terminated: boolean): Promise<void> => {
      const lineLength = lineBytes.length + (terminated ? 1 : 0);
      pendingLines.push({ bytes: lineBytes, terminated });
      size += lineLength;
      while (pendingLines.length - start > count) {
        const first = pendingLines[start++]!;
        size -= first.bytes.length + (first.terminated ? 1 : 0);
        if (omit) await output(context, first.terminated ? concatenate([first.bytes, delimiterByte]) : first.bytes);
      }
      if (size > bufferLimit) throw new FsError("EFBIG", { message: "tail buffer limit exceeded" });
      if (start > 1024) { pendingLines = pendingLines.slice(start); start = 0; }
    };
    try {
      for await (const chunk of source) {
        context.signal.throwIfAborted();
        let lineStart = 0;
        for (let offset = chunk.indexOf(delimiter); offset !== -1; offset = chunk.indexOf(delimiter, lineStart)) {
          await pushLine(pending.finish(undefined, chunk, lineStart, offset), true);
          lineStart = offset + 1;
        }
        if (lineStart < chunk.length) pending.append(chunk, lineStart);
      }
      if (pending.size) {
        context.signal.throwIfAborted();
        await pushLine(pending.finish(), false);
      }
    } finally {
      pending.clear();
    }
    if (!omit) {
      for (let index = start; index < pendingLines.length; index++) {
        const line = pendingLines[index]!;
        await output(context, line.terminated ? concatenate([line.bytes, delimiterByte]) : line.bytes);
      }
    }
    return;
  }
  let pending: Uint8Array[] = [];
  let start = 0;
  let size = 0;
  const records: ByteSource = bytes ? source : (async function* () {
    for await (const line of lines(source, delimiter)) yield line.terminated ? concatenate([line.bytes, Uint8Array.of(delimiter)]) : line.bytes;
  })();
  for await (const chunk of records) {
    context.signal.throwIfAborted();
    if (bytes && !chunk.length) continue;
    pending.push(new Uint8Array(chunk));
    size += chunk.length;
    if (bytes) {
      let excess = Math.max(0, size - count);
      while (excess && start < pending.length) {
        const first = pending[start]!;
        const consume = Math.min(excess, first.length);
        if (omit) await output(context, first.subarray(0, consume));
        if (consume === first.length) delete pending[start++];
        else {
          const remaining = first.subarray(consume);
          pending[start] = remaining.length * 2 <= first.buffer.byteLength ? new Uint8Array(remaining) : remaining;
        }
        size -= consume; excess -= consume;
      }
    } else while (pending.length - start > count) {
      const first = pending[start++]!;
      size -= first.length;
      if (omit) await output(context, first);
    }
    if (size > bufferLimit) throw new FsError("EFBIG", { message: "tail buffer limit exceeded" });
    if (start > 1024) { pending = pending.slice(start); start = 0; }
  }
  if (!omit) for (const chunk of pending.slice(start)) await output(context, chunk);
}

function wcUtf8(consume: (point: number | undefined) => void) {
  let remaining = 0;
  let lead = 0;
  let point = 0;
  let first = false;
  return {
    write(bytes: Uint8Array): void {
      for (const byte of bytes) {
        if (remaining) {
          const continuation = byte >= 0x80 && byte <= 0xbf
            && (!first || (lead !== 0xe0 || byte >= 0xa0) && (lead !== 0xed || byte <= 0x9f)
              && (lead !== 0xf0 || byte >= 0x90) && (lead !== 0xf4 || byte <= 0x8f));
          if (continuation) {
            point = point * 64 + (byte & 0x3f);
            first = false;
            if (--remaining === 0) consume(point);
            continue;
          }
          consume(undefined);
          remaining = 0;
        }
        if (byte < 0x80) consume(byte);
        else if (byte >= 0xc2 && byte <= 0xf4) {
          lead = byte;
          remaining = byte < 0xe0 ? 1 : byte < 0xf0 ? 2 : 3;
          point = byte & (remaining === 1 ? 0x1f : remaining === 2 ? 0x0f : 0x07);
          first = true;
        } else consume(undefined);
      }
    },
    finish(): void { if (remaining) consume(undefined); remaining = 0; },
  };
}

function wcSpace(point: number, posix: boolean): boolean {
  return point === 32 || point >= 9 && point <= 13 || point === 0x1680
    || point >= 0x2000 && point <= 0x200a && point !== 0x2007 || point === 0x2028 || point === 0x2029
    || point === 0x205f || point === 0x3000
    || !posix && (point === 0xa0 || point === 0x2007 || point === 0x202f || point === 0x2060);
}

function headTailArguments(name: "head" | "tail", arguments_: readonly string[]): string[] {
  const args: string[] = [];
  let ended = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    if (argument === "--") ended = true;
    let offset = 1;
    while (offset < argument.length && argument[offset]! >= "0" && argument[offset]! <= "9") offset++;
    if (!ended && (argument[0] === "-" || name === "tail" && index === 0 && argument[0] === "+") && offset > 1) {
      const remainder = argument.slice(offset);
      let unitFlag = "-n";
      let unitSuffix = "";
      let rest = remainder;
      if (rest[0] === "c") { unitFlag = "-c"; rest = rest.slice(1); }
      else if (rest[0] === "b") { unitFlag = "-c"; unitSuffix = "b"; rest = rest.slice(1); }
      else if (rest[0] === "k") { unitFlag = "-c"; unitSuffix = "K"; rest = rest.slice(1); }
      else if (rest[0] === "m") { unitFlag = "-c"; unitSuffix = "M"; rest = rest.slice(1); }
      else if (rest[0] === "l") { unitFlag = "-n"; rest = rest.slice(1); }
      const allowedFlags = name === "tail" ? "qvzfF" : "qvz";
      if (Array.from(rest).every(ch => allowedFlags.includes(ch))) {
        args.push(unitFlag, `${argument[0] === "+" ? "+" : ""}${argument.slice(1, offset)}${unitSuffix}`);
        for (const ch of rest) args.push(`-${ch}`);
        continue;
      }
    }
    args.push(argument);
    // Keep option values intact, especially modern negative counts.
    if (!ended && (["--lines", "--bytes", "--max-idle", "--sleep-interval", "--max-unchanged-stats"].includes(argument)
      || argument.startsWith("-") && !argument.startsWith("--") && (argument.endsWith("n") || argument.endsWith("c") || argument.endsWith("s")))) {
      if (arguments_[index + 1] !== undefined) args.push(arguments_[++index]!);
    }
  }
  return args;
}

function headTailCount(amount: string): number {
  const text = amount.startsWith("+") || amount.startsWith("-") ? amount.slice(1) : amount;
  let offset = 0;
  while (offset < text.length && text[offset]! >= "0" && text[offset]! <= "9") offset++;
  const suffix = text.slice(offset);
  let multiplier = 1n;
  if (suffix === "b") multiplier = 512n;
  else if (suffix) {
    const power = "KMGTPEZYRQ".indexOf(suffix[0] === "k" ? "K" : suffix[0]!) + 1;
    const ending = suffix.slice(1);
    if (!power || !["", "B", "iB"].includes(ending)) throw new UsageError(`invalid number '${amount}'`);
    multiplier = (ending === "B" ? 1000n : 1024n) ** BigInt(power);
  }
  if (!offset && !suffix) throw new UsageError(`invalid number '${amount}'`);
  const count = (offset ? BigInt(text.slice(0, offset)) : 1n) * multiplier;
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new UsageError(`invalid number '${amount}'`);
  return Number(count);
}

async function executeHeadTailSlow(
  name: "head" | "tail",
  maxTailFollowHandles: number,
  context: CommandContext,
): Promise<{ exitCode: number }> {
    const args = headTailArguments(name, context.args);
    const follow = name === "tail" ? parseTailFollow(args) : undefined;
    let lastMode = "n" as "n" | "c";
    let lastHeader: "q" | "v" | undefined;
    const parsed = options(follow?.args ?? args, "n:c:qvz", { lines: "n", bytes: "c", quiet: "q", silent: "q", verbose: "v", "zero-terminated": "z" }, false, undefined, undefined, key => {
      if (key === "n" || key === "c") lastMode = key;
      if (key === "q" || key === "v") lastHeader = key;
    });
    const bytes = lastMode === "c";
    const delimiter = parsed.flags.has("z") ? 0 : 10;
    const amount = value(parsed, bytes ? "c" : "n") ?? "10";
    const positive = amount.startsWith("+");
    const negative = amount.startsWith("-");
    const count = headTailCount(amount);
    const names = parsed.operands.length ? parsed.operands : ["-"];
    const showHeaders = lastHeader === "v" || lastHeader !== "q" && names.length > 1;
    if (follow?.mode) return followTail(context, {
      names, mode: follow.mode, idleMs: follow.idleMs, count, bytes, positive,
      retry: follow.retry, sleepMs: follow.sleepMs, maxUnchangedStats: follow.maxUnchangedStats,
      headers: showHeaders,
    }, maxTailFollowHandles, (target, source) => positive
      ? prefix(target, source, Math.max(0, count - 1), bytes, true, delimiter)
      : suffix(target, source, count, bytes, false, delimiter));
    const req = assertInputRequirements(context, names);
    if (req) await req;
    assertCommandRequirements(context, inspectedInputRequirements, [names.some(name => name !== "-") ? "file" : "stdin"]);
    let exitCode = 0;
    let headerWritten = false;
    for (const file of names) {
      try {
        if (file !== "-") {
          const path = pathOf(context, file);
          assertCommandRequirements(context, inspectedInputRequirements, ["file"], await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities);
          if ((await context.fs.stat(path, { signal: context.signal })).type === "directory") throw new FsError("EISDIR", { path });
          await context.fs.access(path, 4, { signal: context.signal });
        }
        if (showHeaders) {
          await output(context, `${headerWritten ? "\n" : ""}==> ${file === "-" ? "standard input" : file} <==\n`);
          headerWritten = true;
        }
        if (name === "head" && !negative) await prefix(context, input(context, file), count, bytes, false, delimiter);
        else if (name === "tail" && positive) await prefix(context, input(context, file), Math.max(0, count - 1), bytes, true, delimiter);
        else await suffix(context, input(context, file), count, bytes, name === "head", delimiter);
      } catch (error) { await diagnostic(context, error); exitCode = 1; }
    }
    return { exitCode };
}

function headTail(name: "head" | "tail", maxTailFollowHandles = 64): CommandDefinition {
  return define(name, context => {
    if (name === "head") {
      const a = context.args;
      let fastCount = -1;
      if (a.length === 0) {
        fastCount = 10;
      } else if (a.length === 2 && a[0] === "-n" && a[1]!.length > 0 && a[1]!.length <= 8) {
        const s = a[1]!;
        let n = 0;
        for (let i = 0; i < s.length; i++) {
          const d = s.charCodeAt(i) - 48;
          if (d < 0 || d > 9) { n = -1; break; }
          n = n * 10 + d;
        }
        fastCount = n;
      } else if (a.length === 1 && a[0]!.startsWith("-n") && a[0]!.length > 2 && a[0]!.length <= 10) {
        const s = a[0]!;
        let n = 0;
        for (let i = 2; i < s.length; i++) {
          const d = s.charCodeAt(i) - 48;
          if (d < 0 || d > 9) { n = -1; break; }
          n = n * 10 + d;
        }
        fastCount = n;
      }
      if (fastCount >= 0) {
        assertCommandRequirements(context, inspectedInputRequirements, STDIN_REQUIREMENT_MODES);
        try {
          const p = prefixSyncOrAsync(context, input(context, "-"), fastCount, false, false, 10);
          if (p === undefined) return RESOLVED_EXIT_ZERO;
          return p.then(
            () => ({ exitCode: 0 }),
            async error => { await diagnostic(context, error); return { exitCode: 1 }; },
          );
        } catch (error) {
          return diagnostic(context, error).then(() => ({ exitCode: 1 }));
        }
      }
    }
    return executeHeadTailSlow(name, maxTailFollowHandles, context);
  });
}

const TR_CHARACTER_CLASSES: Readonly<Record<string, number[]>> = (() => {
  const lower = Array.from({ length: 26 }, (_, offset) => 97 + offset);
  const upper = Array.from({ length: 26 }, (_, offset) => 65 + offset);
  const digit = Array.from({ length: 10 }, (_, offset) => 48 + offset);
  const space = [9, 10, 11, 12, 13, 32];
  const blank = [9, 32];
  const cntrl = [...Array.from({ length: 32 }, (_, offset) => offset), 127];
  const graph = Array.from({ length: 94 }, (_, offset) => 33 + offset);
  const print = Array.from({ length: 95 }, (_, offset) => 32 + offset);
  const alpha = [...upper, ...lower];
  const alnum = [...digit, ...alpha];
  const xdigit = [...digit, ...upper.slice(0, 6), ...lower.slice(0, 6)];
  const punct = graph.filter(byte => !alnum.includes(byte));
  return { lower, upper, digit, space, blank, cntrl, graph, print, alpha, alnum, xdigit, punct };
})();
const TR_CONTROLS: Readonly<Record<string, number>> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92 };

function characterSet(specification: string, repeatLength?: number, translatingSecond = false): { bytes: number[]; caseOffsets: Set<number>; endsWithClass: boolean } {
  const classes = TR_CHARACTER_CLASSES;
  const tokens: { bytes: number[]; literal: boolean; repeat?: number; className?: string }[] = [];
  const readCharacter = (offset: number) => {
    if (specification[offset] === "\\") {
      const start = offset + 1;
      if (start === specification.length) return { bytes: [92], end: start, literal: false };
      const next = specification[start]!;
      let end = start;
      while (end < specification.length && end - start < 3 && "01234567".includes(specification[end]!)) end++;
      if (end > start) {
        if (end - start === 3 && specification[start]! >= "4") end--;
        return { bytes: [Number.parseInt(specification.slice(start, end), 8)], end, literal: false };
      }
      // tr quotes unknown escapes; echo's stop-output escape has no meaning here.
      const controls = TR_CONTROLS;
      const character = String.fromCodePoint(specification.codePointAt(start)!);
      return { bytes: controls[next] === undefined ? [...encoder.encode(character)] : [controls[next]], end: start + character.length, literal: false };
    }
    const character = String.fromCodePoint(specification.codePointAt(offset)!);
    return { bytes: [...encoder.encode(character)], end: offset + character.length, literal: character === "-" };
  };
  for (let offset = 0; offset < specification.length;) {
    const classEnd = specification.startsWith("[:", offset) ? specification.indexOf(":]", offset + 2) : -1;
    if (classEnd !== -1 && specification.indexOf("]", offset + 2) === classEnd + 1) {
      const name = specification.slice(offset + 2, classEnd);
      const bytes = Object.hasOwn(classes, name) ? classes[name] : undefined;
      if (!bytes) throw new UsageError(`unknown character class '${name}'`);
      if (translatingSecond && name !== "upper" && name !== "lower") {
        throw new PublicDiagnostic("when translating, the only character classes that may appear in string2 are 'upper' and 'lower'");
      }
      tokens.push({ bytes, literal: false, className: name }); offset = classEnd + 2; continue;
    }
    if (specification[offset] === "[" && offset + 1 < specification.length) {
      const equivalent = specification[offset + 1] === "=";
      const characterOffset = offset + 1;
      if (characterOffset < specification.length) {
        const character = readCharacter(characterOffset);
        if (equivalent && offset + 2 < specification.length) {
          const member = readCharacter(offset + 2);
          if (specification.startsWith("=]", member.end)) {
            if (member.bytes.length !== 1) throw new UsageError("equivalence expression requires one byte");
            tokens.push({ bytes: member.bytes, literal: false }); offset = member.end + 2; continue;
          }
        }
        if (specification[character.end] === "*") {
          const end = specification.indexOf("]", character.end + 1);
          if (end !== -1) {
            const count = specification.slice(character.end + 1, end);
            const digits = count.startsWith("0") ? "01234567" : "0123456789";
            if (character.bytes.length !== 1 || ![...count].every(digit => digits.includes(digit))) throw new UsageError("invalid repeat expression");
            const parsedRepeat = count ? Number.parseInt(count, count.startsWith("0") ? 8 : 10) : 0;
            if (parsedRepeat === 0 && repeatLength === undefined) throw new UsageError("the [c*] construct may appear in string2 only when translating");
            // Only positions used by translation matter; retain the byte for squeezing.
            const repeat = parsedRepeat ? Math.min(parsedRepeat, repeatLength === undefined ? 65536 : Math.max(1, repeatLength)) : 0;
            tokens.push({ bytes: character.bytes, literal: false, repeat }); offset = end + 1; continue;
          }
        }
      }
    }
    const character = readCharacter(offset);
    tokens.push(character); offset = character.end;
  }
  const expanded: { bytes: number[]; repeat?: number; className?: string }[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const current = tokens[index]!;
    if (current.repeat === undefined && current.bytes.length === 1 && tokens[index + 1]?.literal && tokens[index + 2]?.repeat === undefined && tokens[index + 2]?.bytes.length === 1) {
      const first = current.bytes[0]!;
      const last = tokens[index + 2]!.bytes[0]!;
      if (last < first) throw new UsageError("range endpoints are in reverse order");
      expanded.push({ bytes: Array.from({ length: last - first + 1 }, (_, offset) => first + offset) });
      index += 2;
    } else expanded.push(current);
  }
  const fills = expanded.filter(token => token.repeat === 0);
  if (fills.length > 1) throw new UsageError("only one indefinite repeat expression is allowed");
  const length = expanded.reduce((length, token) => length + (token.repeat ?? token.bytes.length), 0);
  const result: number[] = [];
  const caseOffsets = new Set<number>();
  for (const token of expanded) {
    if (token.className === "upper" || token.className === "lower") caseOffsets.add(result.length);
    if (token.repeat === undefined) result.push(...token.bytes);
    else for (let index = 0; index < (token.repeat || Math.max(0, (repeatLength ?? 0) - length)); index++) result.push(token.bytes[0]!);
  }
  const endsWithClass = expanded.length > 0 && expanded.at(-1)!.className !== undefined;
  return { bytes: result, caseOffsets, endsWithClass };
}

export function streamCommands(maxTeeTargets = 64, maxTailFollowHandles = 64): CommandDefinition[] {
  if (!Number.isSafeInteger(maxTeeTargets) || maxTeeTargets < 0) {
    throw new RangeError("maxTeeTargets must be a nonnegative safe integer");
  }
  if (!Number.isSafeInteger(maxTailFollowHandles) || maxTailFollowHandles < 0) {
    throw new RangeError("maxTailFollowHandles must be a nonnegative safe integer");
  }
  return [
    define("cat", async context => {
      const parsed = options(context.args, "nbsvETAute", { help: false, number: "n", "number-nonblank": "b", "squeeze-blank": "s", "show-ends": "E", "show-tabs": "T", "show-nonprinting": "v", "show-all": "A" });
      if (parsed.flags.has("help")) {
        await output(context, `Usage: cat [OPTION]... [FILE]...
Concatenate FILEs to standard output. With no FILE, or FILE -, read standard input.

  -n, --number             Number all output lines
  -b, --number-nonblank    Number nonempty output lines (overrides -n)
  -s, --squeeze-blank      Suppress repeated empty output lines
  -E, --show-ends          Display $ at each line end
  -T, --show-tabs          Display TAB characters as ^I
  -v, --show-nonprinting   Display nonprinting characters
  -A, --show-all           Equivalent to -vET
  -e                      Equivalent to -vE
  -t                      Equivalent to -vT
  -u                      Accepted for compatibility; ignored
      --help              Display this help and exit
      --                  End options; remaining arguments are filenames
`);
        return { exitCode: 0 };
      }
      const reqPromise = assertInputRequirements(context, parsed.operands);
      if (reqPromise) await reqPromise;
      if (parsed.flags.has("A")) for (const flag of ["v", "E", "T"]) parsed.flags.add(flag);
      if (parsed.flags.has("e")) { parsed.flags.add("v"); parsed.flags.add("E"); }
      if (parsed.flags.has("t")) { parsed.flags.add("v"); parsed.flags.add("T"); }
      const caller = context;
      const needOperation = parsed.operands.length > 0 && !parsed.operands.includes("-") && (
        Boolean(context.stdout.ownedOutput) ||
        !(parsed.flags.size === 0 || (parsed.flags.size === 1 && parsed.flags.has("u")))
      );
      const operation = needOperation ? createOutputOperation(context, context.stdout) : undefined;
      if (operation) context = Object.assign(Object.create(context), { signal: operation.signal, stdout: operation.output });
      try {
        const state = { exitCode: 0 };
        if (parsed.flags.size === 0 || (parsed.flags.size === 1 && parsed.flags.has("u"))) {
          for (const name of parsed.operands.length ? parsed.operands : ["-"]) {
            try {
              const iter = input(context, name)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
                tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
              };
              if (typeof iter.tryNextSync === "function") {
                let done = false;
                try {
                  while (true) {
                    const syncRes = iter.tryNextSync();
                    if (syncRes !== undefined) {
                      if (syncRes.done) { done = true; break; }
                      const p = output(context, syncRes.value);
                      if (!isSyncResolved(p)) await p;
                      continue;
                    }
                    const asyncRes = await iter.next();
                    if (asyncRes.done) { done = true; break; }
                    const p = output(context, asyncRes.value);
                    if (!isSyncResolved(p)) await p;
                  }
                } finally {
                  if (!done) await iter.return?.();
                }
              } else {
                for await (const chunk of { [Symbol.asyncIterator]: () => iter }) {
                  const p = output(context, chunk);
                  if (!isSyncResolved(p)) await p;
                }
              }
            } catch (error) {
              await diagnostic(context, error);
              state.exitCode = 1;
            }
          }
          return state;
        }
        const source = combinedInput(context, parsed.operands, state);
        operation?.registerCleanup(async () => { await source[Symbol.asyncIterator]().return?.(); });
        if (![...parsed.flags].some(flag => flag !== "u")) {
          for await (const chunk of source) await output(context, chunk);
          return state;
        }
        let lineStart = true;
        let blankCount = 0;
        let number = 1;
        let pendingCr = false;
        const showEndsOnlyCr = parsed.flags.has("E") && !parsed.flags.has("v");
        for await (const chunk of source) {
          const transformed: number[] = [];
          const append = (text: string) => { for (const byte of encoder.encode(text)) transformed.push(byte); };
          for (const byte of chunk) {
            if (pendingCr) {
              pendingCr = false;
              if (byte === 10) append("^M");
              else transformed.push(13);
            }
            if (lineStart && byte === 10 && parsed.flags.has("s") && blankCount > 0) continue;
            if (lineStart && (parsed.flags.has("b") ? byte !== 10 : parsed.flags.has("n"))) append(`${String(number++).padStart(6)}\t`);
            if (byte === 10) {
              if (parsed.flags.has("E")) transformed.push(36);
              transformed.push(10);
              blankCount = lineStart ? blankCount + 1 : 0;
              lineStart = true;
            } else {
              lineStart = false; blankCount = 0;
              if (byte === 13 && showEndsOnlyCr) {
                pendingCr = true;
              } else if (byte === 9) {
                if (parsed.flags.has("T")) append("^I");
                else transformed.push(byte);
              } else if (parsed.flags.has("v")) {
                let visible = byte;
                if (visible >= 128) { append("M-"); visible -= 128; }
                if (visible < 32) append(`^${String.fromCharCode(visible + 64)}`);
                else if (visible === 127) append("^?");
                else transformed.push(visible);
              } else transformed.push(byte);
            }
            if (transformed.length >= 8192) { await output(context, Uint8Array.from(transformed)); transformed.length = 0; }
          }
          if (transformed.length) await output(context, Uint8Array.from(transformed));
        }
        if (pendingCr) await output(context, Uint8Array.of(13));
        return state;
      } catch (error) {
        caller.signal.throwIfAborted();
        if (operation?.signal.aborted && operation.signal.reason instanceof FsError && operation.signal.reason.code === "EPIPE") return { exitCode: 141 };
        throw error;
      } finally { await operation?.close(); }
    }),
    headTail("head"), headTail("tail", maxTailFollowHandles),
    define("wc", context => {
      if (context.args.length === 1 && (context.args[0] === "-l" || context.args[0] === "-c")) {
        const countLines = context.args[0] === "-l";
        const syncBytes = (context.stdin as { tryReadAllSync?: () => Uint8Array | undefined }).tryReadAllSync?.();
        if (syncBytes !== undefined && !context.signal.aborted) {
          let count = 0;
          if (countLines) {
            for (let pos = syncBytes.indexOf(10); pos !== -1; pos = syncBytes.indexOf(10, pos + 1)) count++;
          } else {
            count = syncBytes.length;
          }
          const p = output(context, `${count}\n`);
          if (isSyncResolved(p)) return RESOLVED_EXIT_ZERO;
          return p.then(() => RESOLVED_EXIT_ZERO);
        }
      }
      return (async () => {
      if (context.args.length === 1 && (context.args[0] === "-l" || context.args[0] === "-c")) {
        const countLines = context.args[0] === "-l";
        const req = assertInputRequirements(context, ["-"]);
        if (req) await req;
        let count = 0;
        try {
          const iter = input(context, "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
            tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
            syncReturn?: () => void;
          };
          let done = false;
          try {
            while (true) {
              let chunk: Uint8Array;
              const syncRes = typeof iter.tryNextSync === "function" ? iter.tryNextSync() : undefined;
              if (syncRes !== undefined) {
                if (syncRes.done) { done = true; break; }
                chunk = syncRes.value;
              } else {
                const asyncRes = await iter.next();
                if (asyncRes.done) { done = true; break; }
                chunk = asyncRes.value;
              }
              context.signal.throwIfAborted();
              if (countLines) {
                for (let pos = chunk.indexOf(10); pos !== -1; pos = chunk.indexOf(10, pos + 1)) count++;
              } else {
                count += chunk.length;
              }
            }
          } finally {
            if (!done) {
              if (typeof iter.syncReturn === "function") iter.syncReturn();
              else await iter.return?.();
            }
          }
          const p = output(context, `${count}\n`);
          if (!isSyncResolved(p)) await p;
          return { exitCode: 0 };
        } catch (error) {
          await diagnostic(context, error);
          return { exitCode: 1 };
        }
      }
      const parsed = options(context.args, "lwcmL", { lines: "l", words: "w", bytes: "c", chars: "m", "max-line-length": "L", total: "total:" });
      const totalMode = value(parsed, "total") ?? "auto";
      if (!["auto", "always", "only", "never"].includes(totalMode)) throw new UsageError(`invalid argument '${totalMode}' for '--total'`);
      if (!["l", "w", "m", "c", "L"].some(flag => parsed.flags.has(flag))) for (const flag of ["l", "w", "c"]) parsed.flags.add(flag);
      const selected = ["l", "w", "m", "c", "L"].filter(flag => parsed.flags.has(flag));
      const names = parsed.operands.length ? parsed.operands : ["-"];
      const req = assertInputRequirements(context, names);
      if (req) await req;
      const totals: Record<string, number> = { l: 0, w: 0, m: 0, c: 0, L: 0 };
      const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C.UTF-8";
      const singleByte = locale === "C" || locale === "POSIX";
      const posix = Object.hasOwn(context.env, "POSIXLY_CORRECT");
      let width = 1;
      if (totalMode !== "only" && (names.length > 1 || selected.length > 1)) {
        let totalSize = 0n;
        for (const name of names) {
          if (name === "-") { width = Math.max(width, 7); continue; }
          assertCommandRequirements(context, countRequirements, ["width"]);
          try {
            const stat = await context.fs.stat(pathOf(context, name), { signal: context.signal });
            if (stat.type !== "file") width = Math.max(width, 7);
            else if (Number.isSafeInteger(stat.size) && stat.size >= 0) totalSize += BigInt(stat.size);
          } catch { context.signal.throwIfAborted(); }
        }
        width = Math.max(width, totalSize.toString().length);
      }
      let exitCode = 0;
      const print = async (counts: Record<string, number>, name?: string) => {
        const p = output(context, selected.map(flag => String(counts[flag]).padStart(width)).join(" ") + (name === undefined ? "" : ` ${name}`) + "\n");
        if (!isSyncResolved(p)) await p;
      };
      for (const name of names) {
        const counts: Record<string, number> = { l: 0, w: 0, m: 0, c: 0, L: 0 };
        let columns = 0;
        const lineWidth = (point: number) => {
          if (point === 10 || point === 13 || point === 12) {
            counts.L = Math.max(counts.L!, columns);
            columns = 0;
          } else if (point === 9) columns += 8 - columns % 8;
          else columns += singleByte ? Number(point >= 32 && point < 127) : wcDisplayWidth(point);
        };
        let inWord = false;
        const word = (whitespace: boolean, printable: boolean) => {
          if (whitespace) inWord = false;
          else if (printable) {
            if (!inWord) counts.w!++;
            inWord = true;
          }
        };
        const needsText = parsed.flags.has("w") || parsed.flags.has("m") || parsed.flags.has("L");
        const needsLines = parsed.flags.has("l");
        const utf8 = (needsText && !singleByte) ? wcUtf8(point => {
          if (point !== undefined) counts.m!++;
          word(point !== undefined && wcSpace(point, posix), point !== undefined && point >= 32 && !(point >= 127 && point < 160));
          if (parsed.flags.has("L") && point !== undefined) lineWidth(point);
        }) : undefined;
        try {
          const iter = input(context, name)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
            tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
            syncReturn?: () => void;
          };
          const canTrySync = typeof iter.tryNextSync === "function";
          let done = false;
          try {
          while (true) {
            let step = canTrySync ? iter.tryNextSync!() : undefined;
            if (step === undefined) step = await iter.next();
            if (step.done) { done = true; break; }
            const chunk = step.value;
            context.signal.throwIfAborted();
            counts.c! += chunk.length;
            if (!needsText) {
              if (needsLines) {
                for (let pos = chunk.indexOf(10); pos !== -1; pos = chunk.indexOf(10, pos + 1)) counts.l!++;
              }
              continue;
            }
            for (const byte of chunk) {
              if (byte === 10) counts.l!++;
              if (singleByte) word(byte === 32 || byte >= 9 && byte <= 13, byte >= 32 && byte < 127);
              if (singleByte && parsed.flags.has("L")) lineWidth(byte);
            }
            if (singleByte) counts.m! += chunk.length;
            else utf8!.write(chunk);
          }
          } finally {
            if (!done) {
              if (typeof iter.syncReturn === "function") iter.syncReturn();
              else await iter.return?.();
            }
          }
          if (needsText && !singleByte) utf8!.finish();
          counts.L = Math.max(counts.L!, columns);
          for (const field of ["l", "w", "m", "c"]) totals[field]! += counts[field]!;
          totals.L = Math.max(totals.L!, counts.L!);
          if (totalMode !== "only") await print(counts, parsed.operands.length ? name : undefined);
        } catch (error) {
          await diagnostic(context, error);
          if (totalMode !== "only" && error instanceof FsError && error.code === "EISDIR") await print(counts, parsed.operands.length ? name : undefined);
          exitCode = 1;
        }
      }
      if (totalMode === "only") await print(totals);
      else if (totalMode === "always" || (totalMode === "auto" && names.length > 1)) await print(totals, "total");
      return { exitCode };
      })();
    }),
    define("tee", async context => {
      const args: string[] = [];
      let ended = false;
      for (const argument of context.args) {
        if (argument === "--") ended = true;
        if (!ended && argument === "--output-error") args.push("--output-error=warn-nopipe");
        else if (!ended && argument.startsWith("-") && !argument.startsWith("--") && argument.includes("p")) {
          for (const flag of argument.slice(1)) args.push(flag === "p" ? "--output-error=warn-nopipe" : `-${flag}`);
        } else args.push(argument);
      }
      const parsed = options(args, "ai", { append: "a", "ignore-interrupts": "i", "output-error": "output-error:" });
      const errorMode = value(parsed, "output-error");
      for (const mode of parsed.values.get("output-error") ?? []) {
        if (!["warn", "warn-nopipe", "exit", "exit-nopipe"].includes(mode)) {
          throw new UsageError(`invalid argument '${mode}' for '--output-error'`);
        }
      }
      // Virtual commands have no process SIGINT handler; host cancellation remains authoritative.
      const exitOnError = errorMode === "exit" || errorMode === "exit-nopipe";
      if (parsed.operands.length > maxTeeTargets) {
        throw new UsageError(`too many tee targets (limit ${maxTeeTargets})`);
      }
      const targets = new Set<FileOutput>();
      let exitCode = 0;
      try {
        for (const operand of parsed.operands) {
          try {
            const path = pathOf(context, operand);
            const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
            assertCommandRequirements(context, teeRequirements, [parsed.flags.has("a") ? "append" : "overwrite"],
              context.fs.capabilities.readOnly === true ? { ...capabilities, readOnly: true } : capabilities);
            targets.add(await openFileOutput(context, path, parsed.flags.has("a") ? "a" : "w"));
          }
          catch (error) {
            context.signal.throwIfAborted();
            await diagnostic(context, error);
            exitCode = 1;
            if (exitOnError) return { exitCode };
          }
        }
        for await (const chunk of input(context)) {
          await output(context, chunk);
          for (const target of targets) {
            try { await target.sink.write(chunk); }
            catch (error) {
              context.signal.throwIfAborted();
              await target.abort(error);
              targets.delete(target);
              exitCode = 1;
              await diagnostic(context, error);
              if (exitOnError) return { exitCode };
            }
          }
        }
        for (const target of targets) {
          try { await target.finish(); }
          catch (error) {
            context.signal.throwIfAborted();
            await diagnostic(context, error);
            exitCode = 1;
          }
          targets.delete(target);
        }
        return { exitCode };
      } catch (error) {
        await context.stdout[outputFailure]?.(error);
        throw error;
      } finally {
        await Promise.allSettled([...targets].map(target => target.abort(context.signal.aborted ? context.signal.reason : new FsError("ECANCELED"))));
      }
    }),
    define("tr", context => {
      const { deleting, squeezing, mapping, removed, squeezed } = compileTrConfig(context.args);
      let previous = -1;
      const iter = input(context)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
        tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
        syncReturn?: () => void;
      };
      const canTrySync = typeof iter.tryNextSync === "function";
      if (canTrySync && !sharedTrOutInUse) {
        sharedTrOutInUse = true;
        let released = false;
        try {
          while (true) {
            const step = iter.tryNextSync!();
            if (step === undefined) {
              released = true;
              return executeTrAsync(context, iter, deleting, squeezing, mapping, removed, squeezed, previous, true);
            }
            if (step.done) {
              return RESOLVED_EXIT_ZERO;
            }
            const chunk = step.value;
            context.signal.throwIfAborted();
            if (!chunk.length) continue;
            const useShared = chunk.length <= sharedTrOutBuffer.length;
            const buf = useShared ? sharedTrOutBuffer : new Uint8Array(chunk.length);
            if (!deleting && !squeezing) {
              for (let index = 0; index < chunk.length; index++) buf[index] = mapping[chunk[index]!]!;
              const p = output(context, useShared ? buf.subarray(0, chunk.length) : buf);
              if (!isSyncResolved(p)) {
                released = true;
                return p.then(() => executeTrAsync(context, iter, deleting, squeezing, mapping, removed, squeezed, previous, true));
              }
              continue;
            }
            let count = 0;
            for (let index = 0; index < chunk.length; index++) {
              const byte = chunk[index]!;
              if (removed[byte]) continue;
              const translated = mapping[byte]!;
              if (translated === previous && squeezed[translated]) continue;
              buf[count++] = translated;
              previous = translated;
            }
            if (count) {
              const p = output(context, buf.subarray(0, count));
              if (!isSyncResolved(p)) {
                released = true;
                return p.then(() => executeTrAsync(context, iter, deleting, squeezing, mapping, removed, squeezed, previous, true));
              }
            }
          }
        } catch (err) {
          if (typeof iter.syncReturn === "function") iter.syncReturn();
          throw err;
        } finally {
          if (!released) sharedTrOutInUse = false;
        }
      }
      return executeTrAsync(context, iter, deleting, squeezing, mapping, removed, squeezed, previous, false);
    }),
  ].map(command => ({ ...command, filesystemRequirements: streamRequirements[command.name]! }));
}

async function executeTrAsync(
  context: CommandContext,
  iter: AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined; syncReturn?: () => void },
  deleting: boolean,
  squeezing: boolean,
  mapping: Uint8Array,
  removed: Uint8Array,
  squeezingTable: Uint8Array,
  initialPrevious: number,
  alreadyOwnsShared: boolean,
): Promise<{ exitCode: number }> {
      const squeezed = squeezingTable;
      let previous = initialPrevious;
      const canTrySync = typeof iter.tryNextSync === "function";
      const ownsShared = alreadyOwnsShared || !sharedTrOutInUse;
      if (!alreadyOwnsShared && ownsShared) sharedTrOutInUse = true;
      let done = false;
      try {
        while (true) {
          let step = canTrySync ? iter.tryNextSync!() : undefined;
          if (step === undefined) step = await iter.next();
          if (step.done) { done = true; break; }
          const chunk = step.value;
          context.signal.throwIfAborted();
          if (!chunk.length) continue;
          const useShared = ownsShared && chunk.length <= sharedTrOutBuffer.length;
          const buf = useShared ? sharedTrOutBuffer : new Uint8Array(chunk.length);
          if (!deleting && !squeezing) {
            for (let index = 0; index < chunk.length; index++) buf[index] = mapping[chunk[index]!]!;
            const p = output(context, useShared ? buf.subarray(0, chunk.length) : buf);
            if (!isSyncResolved(p)) await p;
            continue;
          }
          let count = 0;
          for (let index = 0; index < chunk.length; index++) {
            const byte = chunk[index]!;
            if (removed[byte]) continue;
            const translated = mapping[byte]!;
            if (translated === previous && squeezed[translated]) continue;
            buf[count++] = translated; previous = translated;
          }
          if (count) {
            const p = output(context, buf.subarray(0, count));
            if (!isSyncResolved(p)) await p;
          }
        }
      } finally {
        if (ownsShared) sharedTrOutInUse = false;
        if (!done) {
          if (typeof iter.syncReturn === "function") iter.syncReturn();
          else await iter.return?.();
        }
      }
      return { exitCode: 0 };
}
