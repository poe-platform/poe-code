import { PublicDiagnostic, UsageError } from "safe-bash-contracts/diagnostics";
import {
  commandRuntimeIdentity,
  type CommandDefinition,
  type VirtualShellPlugin,
} from "safe-bash-contracts";
import { codeOf, diagnostic, output } from "safe-bash-compression-engine/internal";
import { runOperand } from "safe-bash-compression-engine/operand";
import { planOperands, verifyOperandDestinations } from "safe-bash-compression-engine/files";
import { parseOptions, profiles } from "safe-bash-compression-engine/options";
import { CompressedDataError } from "safe-bash-compression-engine/errors";
import { DecodedBudget, type CompressionCommandOptions } from "safe-bash-compression-engine/stream";

export type { CompressionCommandOptions } from "safe-bash-compression-engine/stream";

export interface Bzip2Limits {
  readonly maxDecodedBytes: number;
}

export interface Bzip2CommandsOptions extends CompressionCommandOptions {
  readonly replace?: boolean | undefined;
  readonly limits?: Partial<Bzip2Limits> | undefined;
}

export type Bzip2Options = Bzip2CommandsOptions;

export function settings(options: Bzip2CommandsOptions = {}): Bzip2Limits {
  const maxDecodedBytes = options.limits?.maxDecodedBytes ?? options.maxDecodedBytes ?? Infinity;
  if (maxDecodedBytes !== Infinity && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  return { maxDecodedBytes };
}

const bzip2Profile = profiles.find(p => p.format === "bzip2") ?? {
  format: "bzip2" as const,
  names: ["bzip2", "bunzip2", "bzcat"] as const,
  suffix: ".bz2",
  level: 9,
  minimumLevel: 1,
  keep: false,
};

function createNamedBzip2Command(
  name: "bzip2" | "bunzip2" | "bzcat",
  options: Bzip2CommandsOptions = {}
): CommandDefinition {
  const limits = settings(options);
  return {
    name,
    description: `${name} block-sorting file compressor`,
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      context.signal.throwIfAborted();
      try {
        const parsed = parseOptions(name, context.args);
        if (parsed.help) {
          await output(
            context,
            `Usage: ${name} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-z, --compress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --fast, --best\nDefault compression level: ${parsed.level}.\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`
          );
          return { exitCode: 0 };
        }
        let plans;
        let planningFailed = false;
        try {
          if (parsed.operands.length > 1) {
            plans = [];
            for (const operand of parsed.operands) {
              try {
                plans.push(...await planOperands(context, { ...parsed, operands: [operand] }));
              } catch (error) {
                context.signal.throwIfAborted();
                if (codeOf(error) === "EROFS") throw error;
                planningFailed = true;
                if (parsed.quiet < 2) await diagnostic(context, error);
              }
            }
            if (plans.length > 1) await verifyOperandDestinations(context, plans);
          } else {
            plans = await planOperands(context, parsed);
          }
        } catch (error) {
          context.signal.throwIfAborted();
          if (parsed.quiet < 2) throw error;
          return { exitCode: 1 };
        }
        const decodedBudget = new DecodedBudget(limits.maxDecodedBytes);
        let exitCode = planningFailed ? 1 : 0;
        for (const plan of plans) {
          try {
            const warned = await runOperand(context, plan, parsed, decodedBudget);
            if (warned) {
              if (!parsed.quiet) {
                await diagnostic(context, new PublicDiagnostic(`${plan.source}: decompression OK, trailing garbage ignored`));
              }
              if (exitCode === 0) exitCode = 2;
            }
          } catch (error) {
            context.signal.throwIfAborted();
            if (parsed.quiet < 2) await diagnostic(context, error);
            exitCode = Math.max(exitCode, error instanceof CompressedDataError ? 2 : 1);
            if (decodedBudget.exceeded) break;
          }
        }
        return { exitCode };
      } catch (error) {
        context.signal.throwIfAborted();
        await diagnostic(context, error);
        return { exitCode: error instanceof UsageError ? 2 : 1 };
      }
    },
  };
}

export function createBzip2Command(options: Bzip2CommandsOptions = {}): CommandDefinition {
  return createNamedBzip2Command("bzip2", options);
}

export function createBunzip2Command(options: Bzip2CommandsOptions = {}): CommandDefinition {
  return createNamedBzip2Command("bunzip2", options);
}

export function createBzcatCommand(options: Bzip2CommandsOptions = {}): CommandDefinition {
  return createNamedBzip2Command("bzcat", options);
}

export function createBzip2Commands(options: Bzip2CommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze(
    bzip2Profile.names.map(name => createNamedBzip2Command(name as "bzip2" | "bunzip2" | "bzcat", options))
  );
}

export function bzip2Commands(options: Bzip2CommandsOptions = {}): VirtualShellPlugin {
  const commands = createBzip2Commands(options);
  return {
    name: "bzip2-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
