import { PublicDiagnostic } from "../../../diagnostics.js";
import { type CommandDefinition } from "../../../contracts/index.js";
import { codeOf, define, diagnostic, output } from "../../internal.js";
import { planOperands, verifyOperandDestinations } from "./files.js";
import { parseOptions, profiles } from "safe-bash-compression-engine/options";
import { createXzCommands } from "safe-bash-command-xz";
import { runOperand } from "safe-bash-compression-engine/operand";
import { DecodedBudget, type CompressionCommandOptions } from "./stream.js";
import { CompressedDataError } from "./errors.js";

export function createCompressionCommands(config: CompressionCommandOptions = {}): readonly CommandDefinition[] {
  const maxDecodedBytes = config.maxDecodedBytes;
  if (maxDecodedBytes !== undefined && maxDecodedBytes !== Infinity && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  const commands = profiles.flatMap(profile => profile.names).map((name) => define(name, async (context) => {
    const options = parseOptions(name, context.args);
    if (options.help) {
      await output(context, `Usage: ${name} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n${options.format === "zstd" ? "-1..-9, --best\nHigher levels and --fast[=NUM] are unsupported by the bounded codec.\n" : "-1..-9, --fast, --best\n"}${options.format === "zstd" ? "-q, --quiet (repeat to suppress errors)\n" : ""}${options.format === "gzip" ? "-q, --quiet (suppress warnings)\n-r, --recursive (traverse directories without following symlinks)\n-n, --no-name (always enabled)\n" : `Default compression level: ${options.level}.\n`}-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
      return { exitCode: 0 };
    }
    let plans;
    let planningFailed = false;
    try {
      if (options.operands.length > 1) {
        plans = [];
        for (const name of options.operands) {
          try {
            plans.push(...await planOperands(context, { ...options, operands: [name] }));
          } catch (error) {
            context.signal.throwIfAborted();
            if (codeOf(error) === "EROFS") throw error;
            planningFailed = true;
            if (options.quiet < 2) await diagnostic(context, error);
          }
        }
        if (plans.length > 1) await verifyOperandDestinations(context, plans);
      } else plans = await planOperands(context, options);
    }
    catch (error) {
      context.signal.throwIfAborted();
      if (options.quiet < 2) throw error;
      return { exitCode: 1 };
    }
    const decodedBudget = new DecodedBudget(maxDecodedBytes);
    let exitCode = planningFailed ? 1 : 0;
    for (const plan of plans) {
      try {
        const warned = await runOperand(context, plan, options, decodedBudget);
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
  return [...commands.slice(0, 6), ...createXzCommands(config), ...commands.slice(6)];
}
