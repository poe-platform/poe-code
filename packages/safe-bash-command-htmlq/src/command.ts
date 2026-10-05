import { readFileStream } from "safe-bash-contracts/filesystem";
import {
  builtInDirectContextExecutors,
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeBytes, type ByteSource } from "safe-bash-contracts/io";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { shellValueByteLength } from "safe-bash-contracts/value";
import type { FileStat } from "safe-bash-contracts/filesystem";
import {
  defaultHtmlLimits,
  HtmlBudget,
  HtmlError,
  invocationOptions,
  type HtmlLimits,
  type HtmlAccounting
} from "./contracts.js";
import { parseHtmlqArguments, type HtmlqArguments } from "./arguments.js";
import { projectHtmlq } from "./behavior.js";
import { htmlqInformation } from "./information.js";
import { publishStagedHtmlq } from "./staged-output.js";
export interface HtmlqCommandOptions {
  readonly limits?: Partial<HtmlLimits>;
  readonly replace?: boolean;
}
/** argv entries are literal, with the same validation as the CLI. */
export interface HtmlqRunOptions extends HtmlqCommandOptions, Partial<HtmlqArguments> {
  readonly argv?: readonly string[];
}
export interface HtmlqResult {
  readonly exitCode: 0 | 1 | 2;
  readonly error?: HtmlError | FsError;
  readonly accounting: HtmlAccounting;
}
function admittedLimits(overrides: Partial<HtmlLimits> = {}): HtmlLimits {
  const limits = { ...defaultHtmlLimits, ...overrides };
  for (const name of Object.keys(defaultHtmlLimits) as (keyof HtmlLimits)[]) {
    if (limits[name] === undefined) limits[name] = defaultHtmlLimits[name];
    const value = limits[name];
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0))
      throw new HtmlError("E_LIMIT", "Limits must be nonnegative safe integers or Infinity", 0, name);
  }
  return Object.freeze(limits);
}
export async function htmlq(
  context: CommandContext,
  configuration: HtmlqRunOptions = {}
): Promise<HtmlqResult> {
  const sdkArgv = configuration.argv;
  const controller = new AbortController();
  const abort = (): void => controller.abort(context.signal.reason);
  const consumerAbort = (): void => controller.abort(stdout?.signal.reason);
  const options = invocationOptions({
    signal: controller.signal,
    limits: admittedLimits(configuration.limits)
  });
  const budget = new HtmlBudget(options);
  let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let task: Promise<HtmlqResult | undefined> = Promise.resolve(undefined),
    closing: Promise<void> | undefined;
  let accepting = true;
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    accepting = false;
    closing = Promise.resolve().then(async () => {
      await Promise.allSettled([task]);
      context.signal.removeEventListener("abort", abort);
      stdout?.signal.removeEventListener("abort", consumerAbort);
      const results = await Promise.allSettled([stdout?.close(), stderr?.close()]);
      const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason);
      if (failures.length) throw new AggregateError(failures, "htmlq output cleanup failed");
    });
    controller.abort(new HtmlError("E_CANCELLED", "htmlq invocation closed"));
    return closing;
  };
  context.registerCleanup?.(cleanup);
  // Snapshot SDK operands synchronously before yielding; bound metadata first.
  let argv: readonly string[] = [],
    snapshotFailure: { error: unknown } | undefined;
  try {
    const argumentKeys = [
      "selector",
      "filename",
      "output",
      "base",
      "detectBase",
      "text",
      "ignoreWhitespace",
      "pretty",
      "help",
      "version",
      "attributes",
      "removeNodes"
    ] as const;
    const typed = argumentKeys.some((key) => configuration[key] !== undefined);
    if (typed && sdkArgv !== undefined)
      throw new HtmlError("E_ARGUMENT", "Use either argv or typed options");
    const carrier = sdkArgv !== undefined || typed ? undefined : getCommandArguments(context);
    function* operands(): Generator<string> {
      for (const [key, flag] of [
        ["filename", "--filename"],
        ["output", "--output"],
        ["base", "--base"],
        ["attributes", "--attributes"],
        ["removeNodes", "--remove-nodes"]
      ] as const) {
        const value = configuration[key];
        if (value === undefined) continue;
        const values = key === "attributes" || key === "removeNodes" ? value : [value];
        if (!Array.isArray(values)) throw new HtmlError("E_ARGUMENT", "Expected option array");
        for (const item of values) {
          if (typeof item !== "string") throw new HtmlError("E_ARGUMENT", "Expected string option");
          budget.bound("tokenBytes", (flag.length + 1 + item.length) * 2);
          budget.charge("retainedBytes", (flag.length + 1 + item.length) * 2);
          yield `${flag}=${item}`;
        }
      }
      for (const [key, flag] of [
        ["detectBase", "--detect-base"],
        ["text", "--text"],
        ["ignoreWhitespace", "--ignore-whitespace"],
        ["pretty", "--pretty"],
        ["help", "--help"],
        ["version", "--version"]
      ] as const) {
        const value = configuration[key];
        if (value !== undefined && typeof value !== "boolean")
          throw new HtmlError("E_ARGUMENT", "Expected boolean option");
        if (value) yield flag;
      }
      if (configuration.selector !== undefined) {
        yield "--";
        yield configuration.selector;
      }
    }
    const incoming = typed ? operands() : (sdkArgv ?? carrier!.args);
    const owned: string[] = [];
    let i = 0;
    for (const value of incoming) {
      if (typeof value !== "string") throw new HtmlError("E_ARGUMENT", "Expected string argv");
      budget.bound("tokenBytes", value.length * 2);
      budget.charge("retainedBytes", value.length * 6 + 32);
      budget.charge("work", value.length + 1);
      if (carrier) {
        const length = shellValueByteLength(carrier.values[i]!);
        budget.charge("retainedBytes", length);
        budget.charge("work", length);
        try {
          const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            carrier.bytes(i)
          );
          budget.charge("decodedBytes", decoded.length * 2);
        } catch (error) {
          if (error instanceof HtmlError) throw error;
          throw new HtmlError("E_ARGUMENT", "argv must be valid UTF-8");
        }
      }
      owned.push(value);
      i++;
    }
    argv = Object.freeze(owned);
  } catch (error) {
    snapshotFailure = { error };
  }
  task = Promise.resolve().then(async () => {
    if (!accepting) throw new HtmlError("E_CANCELLED", "htmlq invocation closed");
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    budget.check();
    stdout = createOutputOperation({ signal: options.signal }, context.stdout);
    stderr = createOutputOperation({ signal: options.signal }, context.stderr);
    try {
      if (snapshotFailure) throw snapshotFailure.error;
      const args = parseHtmlqArguments(argv, options);
      const information = htmlqInformation(args, options);
      if (information !== undefined || args.output === "-") {
        stdout!.signal.addEventListener("abort", consumerAbort, { once: true });
        if (stdout!.signal.aborted) consumerAbort();
        budget.check();
      }
      if (information !== undefined) {
        await writeBytes(stdout!.output, information, options.signal);
        return { exitCode: 0, accounting: budget.snapshot() };
      }
      let source: ByteSource = context.stdin;
      if (args.filename !== "-") {
        const path = args.filename.startsWith("/")
          ? args.filename
          : `${context.cwd}/${args.filename}`;
        source = readFileStream(context.fs, path, { signal: options.signal, chunkSize: Math.max(1, Math.min(65536, options.limits.inputBytes, options.limits.retainedBytes)) });
      }
      let inputBytes = 0;
      // The parser owns cancellation and awaited iterator cleanup. Do not wrap
      // it in readBytes: that rejects foreign realms and ignores abort cleanup.
      const admittedInput: ByteSource = {
        [Symbol.asyncIterator]() {
          const producer = source[Symbol.asyncIterator]();
          let returned: Promise<IteratorResult<Uint8Array>> | undefined;
          return {
            async next() {
              const result = await producer.next();
              budget.check();
              if (!result.done && ArrayBuffer.isView(result.value)) {
                const extent = Object.getOwnPropertyDescriptor(
                  Object.getPrototypeOf(Uint8Array.prototype),
                  "byteLength"
                )!.get!.call(result.value) as number;
                inputBytes += extent;
                context.inputBudget?.check(inputBytes);
              }
              return result;
            },
            return() {
              return (returned ??= Promise.resolve().then(() =>
                producer.return ? producer.return() : { done: true as const, value: undefined }
              ));
            }
          };
        }
      };
      const rendered = projectHtmlq(admittedInput, args, options);
      if (args.output === "-") {
        if (options.limits.outputBytes === Infinity && options.limits.retainedBytes === Infinity) {
          const batch = new Uint8Array(16384);
          let batchOffset = 0;
          let firstChunk = true;
          for await (const bytes of rendered) {
            if (firstChunk) {
              firstChunk = false;
              await writeBytes(stdout!.output, bytes, options.signal);
              continue;
            }
            if (bytes.byteLength >= 8192) {
              if (batchOffset > 0) {
                await writeBytes(stdout!.output, batch.slice(0, batchOffset), options.signal);
                batchOffset = 0;
              }
              await writeBytes(stdout!.output, bytes, options.signal);
              continue;
            }
            if (batchOffset + bytes.byteLength > 16384) {
              await writeBytes(stdout!.output, batch.slice(0, batchOffset), options.signal);
              batchOffset = 0;
            }
            batch.set(bytes, batchOffset);
            batchOffset += bytes.byteLength;
          }
          if (batchOffset > 0) {
            await writeBytes(stdout!.output, batch.slice(0, batchOffset), options.signal);
          }
        } else {
          for await (const bytes of rendered) await writeBytes(stdout!.output, bytes, options.signal);
        }
      } else {
        const path = args.output.startsWith("/") ? args.output : `${context.cwd}/${args.output}`;
        const caps =
          (await context.fs.capabilitiesFor?.(path, { signal: options.signal, stagingResolution: true })) ??
          context.fs.capabilities;
        const streaming = caps.atomicFilePublication
          ? context.fs.publishFileConditional
          : undefined;
        const staged = caps.atomicFileStaging && caps.atomicStagedFileMutation && caps.atomicStagingAncestry
          && caps.retainedStagingWrite && caps.retainedStagingCleanup
          && caps.synchronousStagingResolution && caps.guardedStagingPublication
          && context.fs.prepareStagingResolution && context.fs.createStagedFile
          && context.fs.publishStagedFile && context.fs.removeStagedFile;
        const buffered = (caps.atomicFileMutation || caps.trustedOwnedStaging) ? context.fs.writeFileConditional : undefined;
        if (caps.write === false || caps.readOnly || (!streaming && !staged && !buffered))
          throw new HtmlError(
            "E_UNSUPPORTED",
            "Output requires atomic conditional VFS publication"
          );
        let expected: FileStat | null = null;
        try {
          expected = await context.fs.lstat(path, { signal: options.signal });
        } catch (error) {
          if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
        }
        if (expected && expected.type !== "file")
          throw new HtmlError("E_UNSUPPORTED", "Output must be a regular VFS file");
        const parent = await context.fs.stat(path.slice(0, path.lastIndexOf("/")) || "/", {
          signal: options.signal
        });
        if (streaming) {
          await streaming.call(context.fs, path, rendered, {
            expected,
            parent,
            signal: options.signal,
            maxBytes: options.limits.outputBytes
          });
        } else if (staged) {
          await publishStagedHtmlq(context.fs, path, rendered, options.signal);
        } else {
          // A byte-only atomic provider receives a fully admitted projection.
          // Never use a stat/unconditional write fallback or publish a prefix.
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for await (const chunk of rendered) {
              budget.charge("work", chunk.byteLength + 1);
              budget.charge("retainedBytes", chunk.byteLength + 32);
              chunks.push(chunk.slice());
              size += chunk.byteLength;
            }
            budget.charge("retainedBytes", size);
            budget.charge("work", size);
            const data = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              data.set(chunk, offset);
              offset += chunk.byteLength;
            }
            chunks.length = 0;
            await buffered!.call(context.fs, path, data, {
              expected,
              parent,
              signal: options.signal
            });
          } finally {
            chunks.length = 0;
          }
        }
      }
      return { exitCode: 0, accounting: budget.snapshot() };
    } catch (error) {
      if (options.signal.aborted) throw error;
      if (!(error instanceof HtmlError) && !(error instanceof FsError)) throw error;
      const message = `htmlq: ${error instanceof HtmlError ? error.code : "E_IO"}\n`;
      if (
        budget.remaining("retainedBytes") >= message.length * 3 &&
        budget.remaining("work") >= message.length &&
        budget.remaining("outputBytes") >= message.length
      ) {
        budget.charge("retainedBytes", message.length * 3);
        budget.charge("work", message.length);
        budget.charge("outputBytes", message.length);
        await writeBytes(stderr!.output, new TextEncoder().encode(message), options.signal);
      }
      return {
        exitCode: error instanceof HtmlError && error.code === "E_ARGUMENT" ? 2 : 1,
        error,
        accounting: budget.snapshot()
      };
    }
  });
  let failure: { error: unknown } | undefined, result: HtmlqResult | undefined;
  try {
    result = await task;
  } catch (error) {
    failure = { error };
  }
  try {
    await cleanup();
  } catch (error) {
    if (failure)
      throw new AggregateError([failure.error, error], "htmlq invocation and cleanup failed");
    throw error;
  }
  if (failure) throw failure.error;
  return result!;
}
export function createHtmlqCommand(options: HtmlqCommandOptions = {}): CommandDefinition {
  const configuration = Object.freeze({ limits: admittedLimits(options.limits) });
  const command = Object.freeze({
    name: "htmlq",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Select and project inert HTML byte streams",
    execute(context: CommandContext) {
      return htmlq(context, configuration);
    }
  });
  if (options.limits === undefined) builtInDirectContextExecutors.add(command.execute);
  return command;
}
export const htmlqCommand = createHtmlqCommand();
export function htmlqCommands(options: HtmlqCommandsOptions = {}): VirtualShellPlugin {
  const commands = createHtmlqCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "htmlq",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}

export type HtmlqCommandsOptions = HtmlqCommandOptions;

export function createHtmlqCommands(options: HtmlqCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createHtmlqCommand(options)]);
}
