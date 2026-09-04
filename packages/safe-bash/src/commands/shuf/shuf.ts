import {
  commandRuntimeIdentity, getCommandArguments, isFsError, toByteSource, writeBytes,
  type ByteSource, type CommandContext, type CommandDefinition,
} from "../../contracts/index.js";
import { openFileOutput, type FileOutput } from "../../contracts/filesystem-output.js";
import { yieldTurn } from "../../contracts/yield.js";
import { countMax, Diagnostic, fileQuote, parse, quote } from "./args.js";
import { ownedBytes, records, virtualPath } from "./input.js";
import { settings, type ShufCommandsOptions } from "./options.js";
import { RandomIntegers } from "./random.js";
import { shellValueByteLength } from "../../contracts/value.js";

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
  return Object.freeze({
    name: "shuf",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Write a random permutation of input records",
    async execute(context: CommandContext) {
      let random: RandomIntegers | undefined;
      let output: FileOutput | undefined;
      let source: AsyncGenerator<Uint8Array> | undefined;
      let inputSource: AsyncGenerator<Uint8Array> | undefined;
      let openingInput: Promise<void> | undefined;
      const inputController = new AbortController();
      const inputSignal = AbortSignal.any([context.signal, inputController.signal]);
      let diagnostic = "read error";
      let openingRootOutput = false;
      let cleanup: Promise<void> | undefined;
      let closed = false;
      let executionFailed = false;
      const close = (): Promise<void> => {
        closed = true;
        inputController.abort(new Error("shuf input is closed"));
        return cleanup ??= (async () => {
          await openingInput?.catch(() => {});
          const results = await Promise.allSettled([source?.return(undefined), inputSource?.return(undefined), random?.close()]);
          const failed = results.find(result => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        })();
      };
      context.registerCleanup?.(close);
      try {
        context.signal.throwIfAborted();
        const parsed = parse(context);
        if (parsed.action) {
          const { help, version } = await import("./usage.js");
          await writeBytes(context.stdout, encoder.encode(parsed.action === "help" ? help : version), context.signal);
          return { exitCode: 0 };
        }
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
        } else if (parsed.count !== 0n && !parsed.range) {
          const name = parsed.operands.length ? context.args[parsed.operands[0]!]! : "-";
          let inputSize = Infinity;
          openingInput = Promise.resolve().then(async () => {
            inputSignal.throwIfAborted();
            let input: ByteSource;
            if (name === "-") input = context.stdin;
            else {
              diagnostic = fileQuote(name);
              const path = virtualPath(context.cwd, name);
              const stat = await context.fs.stat(path, { signal: inputSignal });
              if (stat.type === "file" && Number.isSafeInteger(stat.size) && stat.size >= 0) inputSize = stat.size;
              inputSignal.throwIfAborted();
              await context.fs.access(path, 4, { signal: inputSignal });
              inputSignal.throwIfAborted();
              if (context.fs.readStream) input = context.fs.readStream(path, { signal: inputSignal });
              else {
                const bytes = await context.fs.readFile(path, { signal: inputSignal, maxBytes: limits.maxInputBytes });
                if (bytes.byteLength > limits.maxInputBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
                input = toByteSource(bytes);
              }
            }
            inputSource = ownedBytes(input, inputSignal);
            inputSignal.throwIfAborted();
            if (closed) throw new Error("shuf input is closed");
            source = records(inputSource, parsed.delimiter, limits.maxInputBytes, context.signal);
          });
          await openingInput;
          diagnostic = "read error";
          reservoir = !parsed.repeat && parsed.count < countMax && inputSize > 8 * 1024 * 1024;
          if (!reservoir) {
            for await (const line of source!) {
              totalBytes += line.length;
              if (totalBytes > limits.maxInputBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
              if (lines.length >= limits.maxSampleSize) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
              lines.push(line);
            }
            size = BigInt(lines.length);
          }
        }
        random = new RandomIntegers(context, parsed.random, limits.maxInputBytes);
        const count = parsed.repeat || parsed.count < size ? parsed.count : size;
        diagnostic = fileQuote(parsed.random ?? "getrandom");
        if (reservoir || parsed.repeat || count > 0n) await random.open();
        diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random)}: read error`;
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
              diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random)}: read error`;
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
              if (seen % 1024n === 0n) await yieldTurn(context.signal);
            }
          }
          size = BigInt(lines.length);
        }
        const ahead = parsed.repeat || parsed.count < size ? parsed.count : size;
        const permutation: bigint[] = [];
        diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random)}: read error`;
        if (!parsed.repeat) {
          if (ahead > BigInt(limits.maxSampleSize)) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
          const swaps = new Map<bigint, bigint>();
          for (let index = 0n; index < ahead; index++) {
            const chosen = index + await random.choose(size - index);
            permutation.push(swaps.get(chosen) ?? chosen);
            swaps.set(chosen, swaps.get(index) ?? index);
            swaps.delete(index);
            if (index % 1024n === 1023n) await yieldTurn(context.signal);
          }
        }
        if (parsed.output !== undefined) {
          diagnostic = fileQuote(parsed.output);
          openingRootOutput = parsed.output.length > 0 && Array.from(parsed.output).every(character => character === "/");
          output = await openFileOutput(context, virtualPath(context.cwd, parsed.output), "w");
          openingRootOutput = false;
        }
        if (parsed.repeat && parsed.count > 0n && size === 0n) throw new Diagnostic("shuf: no lines to repeat\n");
        const sink = output?.sink ?? context.stdout;
        for (let index = 0n; index < ahead; index++) {
          context.signal.throwIfAborted();
          diagnostic = parsed.random === undefined ? "getrandom" : `${quote(parsed.random)}: read error`;
          const chosen = parsed.repeat ? await random.choose(size) : permutation[Number(index)]!;
          const line = parsed.range ? encoder.encode(`${parsed.range.low + chosen}${parsed.delimiter === 0 ? "\0" : "\n"}`) : lines[Number(chosen)]!;
          diagnostic = "write error";
          await writeBytes(sink, line, context.signal);
          if (index % 256n === 255n) await yieldTurn(context.signal);
        }
        if (output) await output.finish();
        context.signal.throwIfAborted();
        return { exitCode: 0 };
      } catch (error) {
        executionFailed = true;
        if (output) await output.abort(error);
        context.signal.throwIfAborted();
        if (isFsError(error) && error.code === "EPIPE" && diagnostic === "write error") return { exitCode: 141 };
        if (!(error instanceof Diagnostic) && !isFsError(error)) throw error;
        const message = error instanceof Diagnostic ? error.message : `shuf: ${diagnostic}: ${openingRootOutput && error.code === "EISDIR" ? "File exists" : errors[error.code] ?? error.code}\n`;
        await writeBytes(context.stderr, error instanceof Diagnostic && error.bytes ? error.bytes : encoder.encode(message), context.signal);
        return { exitCode: 1 };
      } finally {
        try { await close().catch(error => { if (!executionFailed) throw error; }); }
        finally { context.signal.throwIfAborted(); }
      }
    },
  });
}
