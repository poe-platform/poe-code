import { PublicDiagnostic } from "../../../diagnostics.js";
import { readBytes, writeBytes, type CommandDefinition } from "../../../contracts/index.js";
import { define, diagnostic, output } from "../../internal.js";
import { planOperands, sourceBytes, unchangedSource, writeFileOperand } from "./files.js";
import { parseOptions, profiles } from "./options.js";
import { DecodedBudget, transform, type CompressionCommandOptions } from "./stream.js";
import { CompressedDataError } from "./errors.js";
import { FileOperation } from "./file-operation.js";

export function createCompressionCommands(config: CompressionCommandOptions = {}): readonly CommandDefinition[] {
  const maxDecodedBytes = config.maxDecodedBytes;
  if (maxDecodedBytes !== undefined && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer");
  }
  return profiles.flatMap(profile => profile.names).map((name) => define(name, async (context) => {
    const options = parseOptions(name, context.args);
    if (options.help) {
      await output(context, `Usage: ${name} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n${options.format === "zstd" ? "-1..-9, --best\nHigher levels and --fast[=NUM] are unsupported by the bounded codec.\n" : "-1..-9, --fast, --best\n"}${options.format === "zstd" ? "-q, --quiet (repeat to suppress errors)\n" : ""}${options.format === "gzip" ? "-q, --quiet (suppress warnings)\n-r, --recursive (traverse directories without following symlinks)\n-n, --no-name (always enabled)\n" : `Default compression level: ${options.level}.\n`}-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
      return { exitCode: 0 };
    }
    let plans;
    try { plans = await planOperands(context, options); }
    catch (error) {
      context.signal.throwIfAborted();
      if (options.quiet < 2) throw error;
      return { exitCode: 1 };
    }
    const decodedBudget = new DecodedBudget(maxDecodedBytes);
    let exitCode = 0;
    for (const plan of plans) {
      try {
        let warned: boolean;
        if (plan.destination) warned = await writeFileOperand(context, plan, options, decodedBudget);
        else {
          const operation = new FileOperation(context);
          try {
            await operation.run(() => unchangedSource({ ...context, fs: operation.fs, signal: operation.signal }, plan));
            const source = plan.source === "-" ? context.stdin
              : (signal: AbortSignal) => operation.ownSource(sourceBytes(context, plan, signal));
            warned = await operation.run(() => transform(source, async (bytes, signal) => {
              for await (const chunk of readBytes(bytes, signal)) {
                if (!options.test) await writeBytes(context.stdout, chunk, signal);
              }
            }, { ...options, force: options.force && (options.stdout || options.test || plan.source === "-") }, operation.signal, Infinity, decodedBudget));
          } finally { await operation.close(); context.signal.throwIfAborted(); }
        }
        if (warned) {
          if (!options.quiet) await diagnostic(context, new PublicDiagnostic(`${plan.source}: decompression OK, trailing garbage ignored`));
          if (exitCode === 0) exitCode = 2;
        }
      } catch (error) {
        context.signal.throwIfAborted();
        if (options.quiet < 2) await diagnostic(context, error);
        const failureCode = options.format === "bzip2" && error instanceof CompressedDataError ? 2 : 1;
        exitCode = options.format === "bzip2" ? Math.max(exitCode, failureCode) : failureCode;
        if (decodedBudget.exceeded) break;
      }
    }
    return { exitCode };
  }));
}
