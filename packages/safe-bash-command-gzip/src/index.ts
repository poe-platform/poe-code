import { withInputByteBudget } from "safe-bash-contracts";
import { planOperands,verifyOperandDestinations } from "safe-bash-compression-engine/files";
import { runOperand } from "safe-bash-compression-engine/operand";
import { parseOptions,profiles } from "safe-bash-compression-engine/options";
import { DecodedBudget,type CompressionCommandOptions } from "safe-bash-compression-engine/stream";
import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { builtInDirectContextExecutors,codeOf,define,diagnostic,output } from "safe-bash-io-engine/internal";
export interface GzipLimits { readonly maxDecodedBytes: number; }
export interface GzipCommandsOptions extends CompressionCommandOptions { readonly replace?: boolean; }
export function createGzipCommands(config: GzipCommandsOptions = {}): readonly CommandDefinition[] {
  const maxDecodedBytes = config.maxDecodedBytes;
  if (maxDecodedBytes !== undefined && maxDecodedBytes !== Infinity && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  const commands = profiles.filter(profile => profile.format === "gzip").flatMap(profile => profile.names.map((name) => {
    const command = define(name, async (context) => {
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
        exitCode = 1;
        if (decodedBudget.exceeded) break;
      }
    }
    return { exitCode };
  });
    return { ...command, execute: withInputByteBudget(async context => command.execute(context)) };
  }));
  if (maxDecodedBytes === undefined || maxDecodedBytes === Infinity) {
    for (const c of commands) builtInDirectContextExecutors.add(c.execute);
  }
  return commands;
}
export function createGzipCommand(options: GzipCommandsOptions = {}): CommandDefinition { return createGzipCommands(options)[0]!; }
export function gzipCommands(options: GzipCommandsOptions = {}): VirtualShellPlugin {
 const commands = createGzipCommands(options);
 return { name: "gzip-commands", setup(host) {
 if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
 for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
