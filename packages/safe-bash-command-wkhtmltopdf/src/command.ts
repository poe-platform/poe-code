import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { FsError, type ErrnoCode } from "safe-bash-contracts/errors";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { basename, compareEntries, dirname, resolvePath, type ConditionalWriteFileOptions } from "@poe-code/safe-fs/core";
import { WkhtmltopdfError, type ErrorCode } from "./errors.js";
import { requireRendererFeatures, type RendererProfile } from "./engine.js";
import { ParseBudget, type ParseLimits } from "./limits.js";
import { conversionOutcome, type ConversionCompletion, type ConversionOutcome } from "./outcome.js";
import { parseInvocation, tokenizeBatchLine, type ParsedInvocation } from "./parser.js";
import { withResources, type ResourceLimits, type ResourceUsage } from "./resources.js";

export interface WkhtmltopdfLimits {
  readonly parse: ParseLimits;
  readonly resources: ResourceLimits;
  readonly maxOutputBytes: number;
  readonly maxOutputChunks: number;
  readonly maxBatchJobs: number;
}

/** Trusted first-party static renderer binding, not an engine download or a browser. */
export interface StaticRenderer {
  readonly profile: RendererProfile;
  /** Honor signal and supplied work/output bounds; never use ambient capabilities. */
  open(request: {
    readonly job: ParsedInvocation;
    readonly inputs: readonly Uint8Array[];
    readonly signal: AbortSignal;
    readonly limits: WkhtmltopdfLimits;
  }): Promise<RenderedDocument>;
}

export interface RenderedDocument extends Omit<ConversionCompletion, "mode"> {
  readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  /** Stop pending production and release owned resources, including on cancellation. */
  close(): Promise<void>;
}

export interface WkhtmltopdfCommandOptions {
  readonly limits: WkhtmltopdfLimits;
  /** Explicit trusted binding only. No renderer is supplied by this package. */
  readonly renderer?: StaticRenderer;
}

export type WkhtmltopdfContext = Pick<CommandContext,
  "args" | "argumentValues" | "stdin" | "stdout" | "stderr" | "fs" | "cwd" | "signal" | "inputBudget" | "registerCleanup">;

export type WkhtmltopdfResult =
  | { readonly kind: "information"; readonly exitCode: 0 }
  | { readonly kind: "conversion"; readonly exitCode: 0 | 1 | 2 | 3; readonly jobs: number; readonly outcome: ConversionOutcome; readonly usage: ResourceUsage }
  | { readonly kind: "rejected"; readonly exitCode: 1; readonly code: ErrorCode | ErrnoCode };

export const wkhtmltopdfLimits: WkhtmltopdfLimits = Object.freeze({
  parse: Object.freeze({ maxArguments: 1024, maxTextBytes: 65536, maxObjects: 64, maxWork: 1048576 }),
  resources: Object.freeze({ maxInputBytes: 16777216, maxDecodedBytes: 16777216, maxRetainedBytes: 33554432, maxWork: 67108864, maxResources: 128 }),
  maxOutputBytes: 16777216, maxOutputChunks: 65536, maxBatchJobs: 128,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteType = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;

/** The SDK uses exactly the CLI's literal argument model, signals and destinations. */
export async function runWkhtmltopdf(context: WkhtmltopdfContext, options: WkhtmltopdfCommandOptions): Promise<WkhtmltopdfResult> {
  context.signal.throwIfAborted();
  const controller = new AbortController();
  const signal = controller.signal;
  let opening: Promise<RenderedDocument> | undefined;
  let closing: Promise<void> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let resourceRun: Promise<WkhtmltopdfResult> | undefined;
  let stdout: OutputOperation | undefined;
  let stderr: OutputOperation | undefined;
  const retire = (): Promise<void> => {
    if (!opening) return Promise.resolve();
    closing ??= opening.then(document => document.close(), () => {});
    return closing;
  };
  const onAbort = () => controller.abort(context.signal.reason);
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      controller.abort(new WkhtmltopdfError("INVALID_VALUE", "Invocation has ended"));
      context.signal.removeEventListener("abort", onAbort);
      const drained = await Promise.allSettled([
        retire(), resourceRun?.then(() => {}, () => {}), stdout?.close(), stderr?.close(),
      ]);
      const failures = drained.filter(value => value.status === "rejected").map(value => value.reason);
      if (failures.length) throw new AggregateError(failures, "Invocation cleanup failed");
    })();
    return cleanupPromise;
  };
  // Registration precedes argv copies, input opens, renderer acquisition and output.
  context.registerCleanup?.(cleanup);
  let primary = false;
  let failure: unknown;
  let result: WkhtmltopdfResult | undefined;
  try {
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) onAbort();
    signal.throwIfAborted();
    stdout = createOutputOperation({ signal, registerCleanup: callback => context.registerCleanup?.(callback) }, context.stdout);
    stderr = createOutputOperation({ signal, registerCleanup: callback => context.registerCleanup?.(callback) }, context.stderr);
    const limits: WkhtmltopdfLimits = Object.freeze({
      ...options.limits, parse: Object.freeze({ ...options.limits.parse }), resources: Object.freeze({ ...options.limits.resources }),
    });
    for (const value of [limits.maxOutputBytes, limits.maxOutputChunks, limits.maxBatchJobs]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new WkhtmltopdfError("INVALID_VALUE", "Command limits must be positive safe integers");
    }
    for (const key of ["maxInputBytes", "maxDecodedBytes", "maxRetainedBytes", "maxWork", "maxResources"] as const) {
      if (!Number.isSafeInteger(limits.resources[key]) || limits.resources[key] < 1) {
        throw new WkhtmltopdfError("INVALID_VALUE", "Resource limits must be positive safe integers");
      }
    }
    // Admit text/argument bounds before materializing carrier byte copies.
    const admission = new ParseBudget({ limits: limits.parse, signal });
    admission.admitArguments(context.args.length);
    for (const arg of context.args) admission.admitText(arg);
    const carrier = context.argumentValues === undefined ? undefined : getCommandArguments(context);
    const argv: string[] = [];
    let argumentBytes = 0;
    for (let index = 0; index < context.args.length; index++) {
      signal.throwIfAborted();
      if (carrier === undefined || typeof carrier.values[index] === "string") {
        argv.push(context.args[index]!);
        continue;
      }
      const bytes = carrier.bytes(index)!;
      if (bytes.byteLength > limits.parse.maxTextBytes - argumentBytes) throw new WkhtmltopdfError("LIMIT_EXCEEDED", "CLI argument byte limit exceeded");
      argumentBytes += bytes.byteLength;
      try { argv.push(decoder.decode(bytes)); }
      catch { throw new WkhtmltopdfError("INVALID_VALUE", "CLI arguments must be valid UTF-8"); }
    }
    const parse = (args: readonly string[], batchJob = false) => parseInvocation(args, { limits: limits.parse, signal, endOfOptions: true, batchJob });
    const initial = parse(argv);
    if (initial.mode === "information") {
      let text: string;
      if (initial.global.action === "help" || initial.global.action === "extended-help") {
        text = "Usage: wkhtmltopdf [options] [page|cover input|toc]... output\nStatic first-party renderer requires an explicit binding. Input/output '-' use stdin/stdout.\n";
      } else if (initial.global.action === "version") {
        text = "wkhtmltopdf safe static adapter (source 024b2b2bb459dd904d15b911d04c6df4ff2c9031; Qt compatibility unqualified)\n";
      } else throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "Information action is unavailable in the static profile", initial.global.action);
      if (shellValueByteLength(text) > limits.maxOutputBytes) {
        throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Information output byte limit exceeded");
      }
      await writeBytes(stdout.output, encoder.encode(text), signal);
      result = { kind: "information", exitCode: 0 };
    } else {
      const renderer = options.renderer;
      if (!renderer) throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "A qualified first-party static renderer binding is required");
      requireRendererFeatures(renderer.profile, []);
      let outputBytes = 0;
      let outputChunks = 0;
      let jobs = 0;
      let inputBytes = 0;
      let currentInputs: string[] = [];
      let produced: RenderedDocument | undefined;
      // Capture the drain promise before synchronous host opens can call cleanup.
      resourceRun = Promise.resolve().then(() => withResources({
        limits: limits.resources, signal,
        vfs: async (reference, readSignal) => {
          if (reference === "vfs:output") {
            if (!produced) throw new WkhtmltopdfError("INVALID_VALUE", "No renderer output is active");
            const document = produced;
            return {
              chunks: (async function* () {
                for await (const chunk of document.chunks) {
                  readSignal.throwIfAborted();
                  if (byteType.call(chunk) !== "Uint8Array") throw new WkhtmltopdfError("INVALID_VALUE", "Renderer must produce byte chunks");
                  const length = byteLength.call(chunk) as number;
                  if (++outputChunks > limits.maxOutputChunks || length > limits.maxOutputBytes - outputBytes) {
                    throw new WkhtmltopdfError("LIMIT_EXCEEDED", "PDF output stage limit exceeded");
                  }
                  outputBytes += length;
                  yield chunk;
                }
              })(),
              close: retire,
            };
          }
          const index = Number(reference.slice("vfs:input/".length));
          const input = currentInputs[index];
          if (input === undefined) throw new WkhtmltopdfError("INVALID_VALUE", "Unknown invocation input identity");
          if (input === "-") return {
            chunks: (async function* () {
              for await (const chunk of readBytes(context.stdin, readSignal)) {
                inputBytes += byteLength.call(chunk) as number;
                context.inputBudget?.check(inputBytes);
                yield chunk;
              }
            })(),
            async close() {},
          };
          if (!context.fs.openReadFile) throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "VFS requires bounded read handles");
          const handle = await context.fs.openReadFile(resolvePath(context.cwd, input), { signal: readSignal });
          let position = 0;
          return {
            chunks: (async function* () {
              for (;;) {
                readSignal.throwIfAborted();
                const chunk = await handle.read(position, Math.min(65536, limits.resources.maxInputBytes, limits.resources.maxDecodedBytes, limits.resources.maxRetainedBytes, Math.max(1, context.inputBudget?.maxBytes ?? limits.resources.maxInputBytes)), { signal: readSignal });
                if (byteType.call(chunk) !== "Uint8Array") throw new WkhtmltopdfError("INVALID_VALUE", "VFS must produce byte chunks");
                const length = byteLength.call(chunk) as number;
                if (!length) return;
                inputBytes += length;
                context.inputBudget?.check(inputBytes);
                position += length;
                yield chunk;
              }
            })(),
            close: () => handle.close(),
          };
        },
      }, async resources => {
        const convert = async (job: ParsedInvocation, batch: boolean): Promise<ConversionOutcome> => {
          if (++jobs > limits.maxBatchJobs) throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Batch job limit exceeded");
          currentInputs = job.objects.map(object => {
            if (object.input === null) throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "TOC requires a qualified outline/XSLT engine");
            if (batch && object.input === "-") throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "Batch conversion cannot share stdin with HTML input");
            return object.input;
          });
          let destination: { path: string; condition: ConditionalWriteFileOptions } | undefined;
          if (job.output !== "-") {
            if (!context.fs.writeFileConditional) {
              throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "VFS requires conditional file publication");
            }
            const requested = resolvePath(context.cwd, job.output!);
            const parentPath = await context.fs.realpath(dirname(requested), { signal });
            const path = resolvePath(parentPath, basename(requested));
            const parent = await context.fs.stat(parentPath, { signal });
            let expected = null;
            try { expected = await context.fs.lstat(path, { signal }); }
            catch (error) { if (!(error instanceof FsError && error.code === "ENOENT")) throw error; }
            // Refuse final symlinks rather than granting authority over their target.
            if (expected !== null && expected.type !== "file") {
              throw new WkhtmltopdfError("INVALID_VALUE", "Output must be a regular VFS file or absent");
            }
            for (let index = 0; index < currentInputs.length; index++) {
              const input = currentInputs[index]!;
              if (input === "-") continue;
              const source = await context.fs.realpath(resolvePath(context.cwd, input), { signal });
              currentInputs[index] = source;
              if (source === path || (expected !== null &&
                  await compareEntries(context.fs, source, context.fs, path, { signal }) !== "distinct")) {
                throw new WkhtmltopdfError("INVALID_VALUE", "Input and output VFS identities must be distinct");
              }
            }
            destination = { path, condition: { parent, expected, signal } };
          }
          const inputs: Uint8Array[] = [];
          for (let index = 0; index < currentInputs.length; index++) inputs.push(await resources.load("vfs:input/" + index));
          signal.throwIfAborted();
          opening = Promise.resolve().then(() => {
            signal.throwIfAborted();
            return renderer.open({ job, inputs, signal, limits });
          });
          closing = undefined;
          const document = await opening;
          produced = document;
          signal.throwIfAborted();
          const outcome = conversionOutcome({
            mode: batch ? "batch" : "single", success: document.success, errorCode: document.errorCode,
            ...(document.networkErrorName === undefined ? {} : { networkErrorName: document.networkErrorName }),
          });
          let pdf: Uint8Array | undefined;
          if (outcome.exitCode === 0) {
            // The same ledger covers retained HTML, copied PDF chunks, assembly and work.
            pdf = await resources.load("vfs:output");
          }
          await retire();
          opening = undefined;
          closing = undefined;
          produced = undefined;
          signal.throwIfAborted();
          if (outcome.exitCode === 0) {
            if (job.output === "-") await writeBytes(stdout!.output, pdf!, signal);
            else await context.fs.writeFileConditional!(destination!.path, pdf!, destination!.condition);
          } else await diagnostic({ ...context, stderr: stderr!.output }, outcome, signal);
          return outcome;
        };
        let outcome: ConversionOutcome = { exitCode: 0, diagnostic: null };
        if (initial.mode === "batch") {
          // Shared resource accounting bounds batch text as well as every job input.
          currentInputs = ["-"];
          const bytes = await resources.load("vfs:input/0");
          let text: string;
          try { text = decoder.decode(bytes); }
          catch { throw new WkhtmltopdfError("INVALID_VALUE", "Batch input must be valid UTF-8"); }
          let start = 0;
          for (let end = 0; end <= text.length; end++) {
            signal.throwIfAborted();
            if (end !== text.length && text[end] !== "\n") continue;
            if (end === text.length && start === end) break;
            const args = tokenizeBatchLine(text.slice(start, end), { limits: limits.parse, signal });
            const job = parse([...argv, ...args], true);
            if (job.mode !== "conversion") throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "Batch lines must describe conversion jobs");
            outcome = await convert(job, true);
            if (outcome.exitCode !== 0) break;
            start = end + 1;
          }
        } else outcome = await convert(initial, false);
        return { kind: "conversion", exitCode: outcome.exitCode, jobs, outcome, usage: resources.usage };
      }));
      result = await resourceRun;
    }
  } catch (error) {
    if (context.signal.aborted) { primary = true; failure = context.signal.reason; }
    else if (signal.aborted) { primary = true; failure = signal.reason; }
    else if (error instanceof WkhtmltopdfError || error instanceof FsError) {
      try {
        const option = error instanceof WkhtmltopdfError ? error.option : undefined;
        await writeBytes(stderr!.output, encoder.encode(`wkhtmltopdf: ${error.code}${option ? ` (${option})` : ""}: ${error.message}\n`), signal);
        result = { kind: "rejected", exitCode: 1, code: error.code };
      } catch (writeError) { primary = true; failure = writeError; }
    } else { primary = true; failure = error; }
  } finally {
    try { await cleanup(); }
    catch (error) {
      if (primary) failure = new AggregateError([failure, error], "Invocation and cleanup failed");
      else { primary = true; failure = error; }
    }
  }
  if (primary) throw failure;
  return result!;
}

async function diagnostic(context: WkhtmltopdfContext, outcome: ConversionOutcome, signal: AbortSignal): Promise<void> {
  const value = outcome.diagnostic;
  if (!value) return;
  const message = value.kind === "http" ? `Exit with code ${outcome.exitCode} due to http error: ${value.code} ${value.description}` :
    value.kind === "network" ? `Exit with code 1 due to network error: ${value.name ?? "UnqualifiedNetworkError"}` : "Exit with code 1, due to unknown error.";
  await writeBytes(context.stderr, encoder.encode(message + "\n"), signal);
}

export function createWkhtmltopdfCommand(options: WkhtmltopdfCommandOptions = { limits: wkhtmltopdfLimits }): CommandDefinition {
  return Object.freeze({
    name: "wkhtmltopdf", runtimeIdentity: commandRuntimeIdentity,
    description: "Bounded static HTML-to-PDF adapter with an explicit first-party renderer",
    execute: (context: CommandContext) => runWkhtmltopdf(context, options),
  });
}

export const wkhtmltopdfCommand: CommandDefinition = createWkhtmltopdfCommand();

export function wkhtmltopdfCommands(options: WkhtmltopdfCommandOptions = { limits: wkhtmltopdfLimits }): VirtualShellPlugin {
  const command = createWkhtmltopdfCommand(options);
  return { name: "wkhtmltopdf-commands", setup(host) { host.commands.register(command); } };
}
