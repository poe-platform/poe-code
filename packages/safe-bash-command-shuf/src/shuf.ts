import {
  builtInDirectContextExecutors, commandRuntimeIdentity, createBufferedOutput, getCommandArguments, InputByteBudget, isFsError, writeBytes,
  type ByteSource, type CommandContext, type CommandDefinition,
} from "safe-bash-contracts";
import { openFileOutput, type FileOutput } from "./filesystem-output.js";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { countMax, Diagnostic, fileQuote, parse, quote, unicodeLocale } from "./args.js";
import { FileInput, ownedBytes, readAllRecords, records, virtualPath } from "./input.js";
import { settings, type ShufCommandsOptions } from "./options.js";
import { RandomIntegers } from "./random.js";
import { shellValueByteLength } from "safe-bash-contracts/value";

import { textOutputRequirements } from "safe-bash-io-engine/portable-requirements";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { writeDiagnostic } from "safe-bash-contracts/escaping";

const encoder = new TextEncoder();
const errors: Readonly<Record<string, string>> = {
  ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted",
  EISDIR: "Is a directory", ENOTDIR: "Not a directory", EROFS: "Read-only file system",
  EIO: "Input/output error", ENOSPC: "No space left on device", EPIPE: "Broken pipe",
  ELOOP: "Too many levels of symbolic links", EBADF: "Bad file descriptor", ENAMETOOLONG: "File name too long",
  EINVAL: "Invalid argument", EFBIG: "File too large", ENOTSUP: "Operation not supported",
};

export function createShufCommand(options: ShufCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const command = Object.freeze({
    name: "shuf",
    filesystemRequirements: textOutputRequirements,
    runtimeIdentity: commandRuntimeIdentity,
    description: "Write a random permutation of input records",
    async execute(context: CommandContext) {
      const budget = new InputByteBudget(Infinity, context.inputBudget);
      let random: RandomIntegers | undefined;
      let output: FileOutput | undefined;
      let source: AsyncGenerator<Uint8Array> | undefined;
      let inputSource: AsyncGenerator<Uint8Array> | undefined;
      let fileInput: FileInput | undefined;
      const inputController = new AbortController();
      const inputSignal = AbortSignal.any([context.signal, inputController.signal]);
      inheritYieldCheckpoint(context.signal, inputSignal);
      let diagnostic = "read error";
      let openingRootOutput = false;
      let cleanup: Promise<void> | undefined;
      let closed = false;
      let executionFailed = false;
      const close = (): Promise<void> => {
        closed = true;
        inputController.abort(new Error("shuf input is closed"));
        return cleanup ??= (async () => {
          const results = await Promise.allSettled([source?.return(undefined), inputSource?.return(undefined), fileInput?.close(), random?.close()]);
          const failed = results.find(result => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        })();
      };
      context.registerCleanup?.(close);
      try {
        context.signal.throwIfAborted();
        const unicode = unicodeLocale(context);
        const parsed = parse(context);
        if (parsed.action) {
          const { help, version } = await import("./usage.js");
          await writeBytes(context.stdout, encoder.encode(parsed.action === "help" ? help : version), context.signal);
          return { exitCode: 0 };
        }
        await yieldTurn(context.signal);
        const lines: Uint8Array[] = [];
        let totalBytes = 0;
        let size = parsed.count === 0n ? 0n : parsed.range?.size ?? 0n;
        let reservoir = false;
        if (parsed.count !== 0n && parsed.echo) {
          const argumentsOwned = getCommandArguments(context);
          for (const index of parsed.operands) {
            if (lines.length >= limits.maxSampleSize) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
            totalBytes += shellValueByteLength(argumentsOwned.values[index]!) + 1;
            if (totalBytes > limits.maxInputBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
            const bytes = argumentsOwned.bytes(index)!;
            const line = new Uint8Array(bytes.length + 1);
            line.set(bytes);
            line[bytes.length] = parsed.delimiter;
            lines.push(line);
          }
          size = BigInt(lines.length);
        } else if (!parsed.range && !parsed.echo && (parsed.count !== 0n || parsed.repeat)) {
          const name = parsed.count === 0n || !parsed.operands.length ? "-" : Array.from(getCommandArguments(context).bytes(parsed.operands[0]!)!, byte => String.fromCharCode(byte)).join("");
          let inputSize = Infinity;
          {
            inputSignal.throwIfAborted();
            let input: ByteSource;
            if (name === "-") input = context.stdin;
            else {
              diagnostic = fileQuote(name, unicode);
              fileInput = new FileInput({ ...context, signal: inputSignal }, limits.maxInputBytes);
              await fileInput.open(name);
              const stat = fileInput.stat;
              if (stat?.type === "file" && Number.isSafeInteger(stat.size) && stat.size >= 0) inputSize = stat.size;
              input = fileInput;
            }
            inputSource = ownedBytes(input, inputSignal, budget);
            inputSignal.throwIfAborted();
            if (closed) throw new Error("shuf input is closed");
          }
          diagnostic = "read error";
          reservoir = !parsed.repeat && parsed.count < countMax && inputSize > 8 * 1024 * 1024;
          if (!reservoir) {
            totalBytes = await readAllRecords(inputSource!, parsed.delimiter, limits.maxInputBytes, limits.maxSampleSize, context.signal, lines);
            size = BigInt(lines.length);
          } else {
            source = records(inputSource!, parsed.delimiter, limits.maxInputBytes, context.signal);
          }
        }
        random = new RandomIntegers(context, parsed.random, limits.maxInputBytes);
        const count = parsed.repeat || parsed.count < size ? parsed.count : size;
        diagnostic = fileQuote(parsed.random ?? "getrandom", unicode);
        if (reservoir && parsed.count > 0n || parsed.repeat || count > 0n) await random.open();
        if (parsed.repeat && parsed.random === undefined) random.seed();
        diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random, unicode)}: read error`;
        if (reservoir) {
          let seen = 0n;
          while (seen < parsed.count) {
            diagnostic = "read error";
            const next = await source!.next();
            if (next.done) break;
            totalBytes += next.value.length;
            if (totalBytes > limits.maxInputBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
            if (lines.length >= limits.maxSampleSize) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
            lines.push(next.value);
            seen++;
          }
          if (seen === parsed.count) {
            while (true) {
              diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random, unicode)}: read error`;
              const chosen = await random.choose(seen + 1n);
              diagnostic = "read error";
              const next = await source!.next();
              if (next.done) break;
              if (chosen < parsed.count) {
                const index = Number(chosen);
                totalBytes += next.value.length - lines[index]!.length;
                if (totalBytes > limits.maxInputBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
                lines[index] = next.value;
              }
              seen++;
              if (seen % 1024n === 0n) {
                await yieldTurn(context.signal);
              }
            }
          }
          size = BigInt(lines.length);
        }
        const ahead = parsed.repeat || parsed.count < size ? parsed.count : size;
        if (!parsed.repeat) {
          if (Number.isFinite(limits.maxSampleSize) && ahead > BigInt(limits.maxSampleSize)) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
          if (Number.isFinite(limits.maxInputBytes) && ahead * 8n > BigInt(limits.maxInputBytes)) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
        }
        const streamDirect = !parsed.repeat && parsed.output === undefined && parsed.random === undefined;
        const permutation: bigint[] = [];
        const swaps = new Map<bigint, bigint>();
        const sparse = ahead > 0n && (size > 0xffffffffn || size >= 128n * 1024n && size / ahead >= 32n);
        diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random, unicode)}: read error`;
        const useSyncRandom = parsed.random === undefined;
        if (!parsed.repeat && !streamDirect) {
          for (let index = 0n; index < ahead; index++) {
            const chosen = index + (useSyncRandom ? random.chooseSync(size - index) : await random.choose(size - index));
            permutation.push(sparse && chosen === index ? index : swaps.get(chosen) ?? chosen);
            swaps.set(chosen, swaps.get(index) ?? index);
            swaps.delete(index);
            if (index % 1024n === 1023n) {
              await yieldTurn(context.signal);
            }
          }
        }
        if (parsed.output !== undefined) {
          diagnostic = fileQuote(parsed.output, unicode);
          openingRootOutput = parsed.output.length > 0 && Array.from(parsed.output).every(character => character === "/");
          output = await openFileOutput(context, virtualPath(context.cwd, parsed.output), "w");
          openingRootOutput = false;
        }
        if (parsed.repeat && parsed.count > 0n && size === 0n) throw new Diagnostic("shuf: no lines to repeat\n");
        const sink = createBufferedOutput(output?.sink ?? context.stdout, context.signal);
        for (let index = 0n; index < ahead; index++) {
          context.signal.throwIfAborted();
          diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random, unicode)}: read error`;
          let chosen: bigint;
          if (parsed.repeat) {
            chosen = useSyncRandom ? random.chooseSync(size) : await random.choose(size);
          } else if (streamDirect) {
            const pick = index + (useSyncRandom ? random.chooseSync(size - index) : await random.choose(size - index));
            chosen = sparse && pick === index ? index : swaps.get(pick) ?? pick;
            swaps.set(pick, swaps.get(index) ?? index);
            swaps.delete(index);
          } else {
            chosen = permutation[Number(index)]!;
          }
          const line = parsed.range ? encoder.encode(`${parsed.range.low + chosen}${parsed.delimiter === 0 ? "\0" : "\n"}`) : lines[Number(chosen)]!;
          diagnostic = "write error";
          await sink.write(line);
          if (parsed.repeat && parsed.random !== undefined) await sink.flush();
          if (index % 256n === 255n) {
            await yieldTurn(context.signal);
          }
        }
        await sink.flush();
        if (output) await output.finish();
        context.signal.throwIfAborted();
        return { exitCode: 0 };
      } catch (error) {
        executionFailed = true;
        if (output) await output.abort(error);
        context.signal.throwIfAborted();
        budget.assertOpen();
        inputSignal.throwIfAborted();
        if (isFsError(error) && error.code === "EPIPE" && diagnostic === "write error") return { exitCode: 141 };
        if (!(error instanceof Diagnostic) && !isFsError(error)) {
          if ((diagnostic === "write error" || diagnostic === "getrandom") && error instanceof Error) throw error;
          await writeDiagnostic(context.stderr, `${context.command}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
          return { exitCode: 1 };
        }
        const message = error instanceof Diagnostic ? error.message : `shuf: ${diagnostic}: ${openingRootOutput && error.code === "EISDIR" ? "File exists" : errors[error.code] ?? error.code}\n`;
        await writeBytes(context.stderr, error instanceof Diagnostic && error.bytes ? error.bytes : encoder.encode(message), context.signal);
        return { exitCode: 1 };
      } finally {
        try { await close().catch(error => { if (!executionFailed) throw error; }); }
        finally { context.signal.throwIfAborted(); }
      }
    },
  });
  if (limits.maxInputBytes === Infinity && limits.maxSampleSize === Infinity) builtInDirectContextExecutors.add(command.execute);
  return command;
}
