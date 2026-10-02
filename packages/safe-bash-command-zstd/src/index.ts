import { commandRuntimeIdentity, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { define } from "safe-bash-io-engine/internal";
import { codeOf, diagnostic, output } from "safe-bash-compression-engine/internal";
import { planOperands, verifyOperandDestinations } from "safe-bash-compression-engine/files";
import { createOptionsParser, formats } from "safe-bash-compression-engine/options";
import { runOperand } from "safe-bash-compression-engine/operand";
import { DecodedBudget, type CompressionCommandOptions } from "safe-bash-compression-engine/stream";

export type { CompressionCommandOptions } from "safe-bash-compression-engine/stream";
export interface ZstdLimits { readonly maxDecodedBytes: number; }
export interface ZstdCommandsOptions extends CompressionCommandOptions {
  readonly limits?: Partial<ZstdLimits> | undefined;
  readonly replace?: boolean | undefined;
}
const names = ["zstd", "unzstd", "zstdcat"] as const;
const parseZstdOptions = createOptionsParser([{ ...formats.zstd, format: "zstd", names }]);

export function createZstdCommand(config: ZstdCommandsOptions = {}, name: typeof names[number] = "zstd"): CommandDefinition {
  const maxDecodedBytes = config.limits?.maxDecodedBytes ?? config.maxDecodedBytes;
  if (maxDecodedBytes !== undefined && maxDecodedBytes !== Infinity && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  const command = define(name, async (context) => {
    const options = parseZstdOptions(name, context.args);
    if (options.help) {
      await output(context, `Usage: ${name} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --best\nHigher levels and --fast[=NUM] are unsupported by the bounded codec.\n-q, --quiet (repeat to suppress errors)\nDefault compression level: ${options.level}.\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
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
  // Normalize the command handler's sync-or-async result for the budget lifetime.
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZstdCommands(options: ZstdCommandsOptions = {}): readonly CommandDefinition[] {
  return names.map(name => createZstdCommand(options, name));
}

export function zstdCommands(options: ZstdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZstdCommands(options);
  return {
    name: "zstd-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
