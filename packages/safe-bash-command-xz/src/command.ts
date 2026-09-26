import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import type { CommandDefinition } from "safe-bash-contracts";
import { codeOf, diagnostic, output } from "safe-bash-compression-engine/internal";
import { UsageError } from "safe-bash-contracts/diagnostics";
import { runOperand } from "safe-bash-compression-engine/operand";
import { planOperands, verifyOperandDestinations } from "safe-bash-compression-engine/files";
import { parseOptions, xzProfile } from "./options.js";
import { DecodedBudget, type CompressionCommandOptions } from "safe-bash-compression-engine/stream";
import { inspectXz, listingRatio, listingChecks, humanListing, type XzListing } from "./xz-list.js";

export function createXzCommands(config: CompressionCommandOptions = {}): readonly CommandDefinition[] {
  const maxDecodedBytes = config.maxDecodedBytes;
  if (maxDecodedBytes !== undefined && maxDecodedBytes !== Infinity && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  return xzProfile.names.map<CommandDefinition>(name => ({ name, async execute(context) {
    context.signal.throwIfAborted();
    try {
      const options = parseOptions(name, context.args);
      options.onXzAdjust = async dictionary => {
        if (!options.quiet) await diagnostic(context, new PublicDiagnostic(`Adjusted LZMA${options.xzFormat === "lzma" ? "1" : "2"} dictionary size to ${dictionary / 1024 ** 2} MiB to not exceed the memory usage limit`));
      };
      if (options.help) {
        await output(context, `Usage: ${name} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --fast, --best\nDefault compression level: ${options.level}.\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
        return { exitCode: 0 };
      }
      let plans;
      let planningFailed = false;
      const listingNames: string[] = [];
      try {
        if (options.xzList || options.operands.length > 1) {
          plans = [];
          for (const name of options.operands) {
            try {
              plans.push(...await planOperands(context, { ...options, operands: [name] }));
              listingNames.push(name);
            } catch (error) {
              context.signal.throwIfAborted();
              if (codeOf(error) === "EROFS") throw error;
              planningFailed = true;
              if (options.quiet < 2) await diagnostic(context, error);
            }
          }
          if (!options.xzList && plans.length > 1) await verifyOperandDestinations(context, plans);
        } else plans = await planOperands(context, options);
      }
      catch (error) {
        context.signal.throwIfAborted();
        if (options.quiet < 2) throw error;
        return { exitCode: 1 };
      }
      const decodedBudget = new DecodedBudget(maxDecodedBytes);
      const totals: XzListing = { streams: 0, blocks: 0, compressed: 0, uncompressed: 0, padding: 0, checks: new Set() };
      let listed = 0;
      if (options.xzList && !options.xzRobot) await output(context, "Strms  Blocks   Compressed Uncompressed  Ratio  Check   Filename\n");
      let exitCode = planningFailed ? 1 : 0;
      for (const plan of plans) {
        try {
          if (options.xzList) {
            const value = await inspectXz(context, plan, options);
            const name = listingNames[plans.indexOf(plan)] ?? plan.source;
            if (options.xzRobot) await output(context, `name\t${name}\nfile\t${value.streams}\t${value.blocks}\t${value.compressed}\t${value.uncompressed}\t${listingRatio(value)}\t${listingChecks(value)}\t${value.padding}\n`);
            else await output(context, humanListing(value, name));
            for (const key of ["streams", "blocks", "compressed", "uncompressed", "padding"] as const) totals[key] += value[key];
            for (const check of value.checks) totals.checks.add(check);
            listed++;
            continue;
          }
          const warned = await runOperand(context, plan, options, decodedBudget);
          if (warned) {
            if (!options.quiet) await diagnostic(context, new PublicDiagnostic(`${plan.source}: decompression OK, trailing garbage ignored`));
            if (exitCode === 0) exitCode = 2;
          }
        } catch (error) {
          context.signal.throwIfAborted();
          if (options.quiet < 2) await diagnostic(context, error);
          exitCode = 1;
          if (decodedBudget.exceeded) break;
        }
      }
      if (options.xzList && options.xzRobot) await output(context, `totals\t${totals.streams}\t${totals.blocks}\t${totals.compressed}\t${totals.uncompressed}\t${listingRatio(totals)}\t${listingChecks(totals)}\t${totals.padding}\t${listed}\n`);
      else if (options.xzList && listed > 1) await output(context, "-".repeat(79) + "\n" + humanListing(totals, `${listed} files`));
      return { exitCode };
    } catch (error) {
      context.signal.throwIfAborted();
      await diagnostic(context, error);
      return { exitCode: error instanceof UsageError ? 2 : 1 };
    }
  } }));
}
