import { createOutputOperation } from "safe-bash-contracts/output";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { optimizeSvg } from "@poe-code/graphviz-ast";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  writeText,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import {
  settings,
  inputReader,
  output,
  diagnostic,
  plugin,
  UsageError,
  type GraphvizLimits,
  type GraphvizCommandsOptions
} from "safe-bash-graphviz-engine";
export type SvgoLimits = GraphvizLimits;
export type SvgoCommandsOptions = GraphvizCommandsOptions;
export function createSvgoCommand(options: SvgoCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "svgo",
    description: "Optimize SVG documents",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      const operation = createOutputOperation(context, { write: async () => {} });
      inheritYieldCheckpoint(context.signal, operation.signal);
      context = {
        ...context,
        signal: operation.signal,
        stdout: operation.child(context.stdout).output
      };
      try {
        context.signal.throwIfAborted();
        const args = getCommandArguments(context).args;
        let input: string | undefined,
          literal: string | undefined,
          outfile: string | undefined,
          precision = 3,
          indent = 2,
          pretty = false,
          multipass = false,
          end = false;
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]!;
          if (!end && arg === "--") {
            end = true;
            continue;
          }
          if (!end && (arg === "--help" || arg === "-h")) {
            await writeText(
              context.stdout,
              "Usage: svgo [INPUT|-] [-i INPUT] [-s STRING] [-o OUTPUT|-]\n            [--multipass] [-p PRECISION] [--pretty] [--indent N] [-q|--quiet]\nFile input is optimized in place unless -o is supplied. Stdin and strings default to stdout.\n"
            );
            return { exitCode: 0 };
          }
          if (
            !end &&
            (arg === "--multipass" || arg === "--pretty" || arg === "-q" || arg === "--quiet")
          ) {
            if (arg === "--multipass") multipass = true;
            if (arg === "--pretty") pretty = true;
            continue;
          }
          if (!end && arg !== "-" && arg.startsWith("-")) {
            if (
              ![
                "-i",
                "--input",
                "-s",
                "--string",
                "-o",
                "--output",
                "-p",
                "--precision",
                "--indent"
              ].includes(arg)
            )
              throw new UsageError(`unknown option: ${arg}`);
            const value = args[++i];
            if (value === undefined) throw new UsageError(`missing value for ${arg}`);
            if (arg === "-i" || arg === "--input") {
              if (input !== undefined) throw new UsageError("multiple inputs");
              input = value;
            } else if (arg === "-s" || arg === "--string") {
              if (literal !== undefined) throw new UsageError("multiple strings");
              literal = value;
            } else if (arg === "-o" || arg === "--output") outfile = value;
            else {
              const n = Number(value);
              if (
                !value.trim() ||
                !Number.isInteger(n) ||
                n < 0 ||
                n > (arg === "--indent" ? 16 : 15)
              )
                throw new UsageError(`invalid ${arg}`);
              if (arg === "--indent") indent = n;
              else precision = n;
            }
          } else {
            if (input !== undefined) throw new UsageError("multiple inputs");
            input = arg;
          }
        }
        if (input !== undefined && literal !== undefined)
          throw new UsageError("choose input or string");
        const source = await inputReader(context, limits)(input, literal);
        await yieldTurn(context.signal);
        let result = source;
        for (let pass = 0; pass < (multipass ? 10 : 1); pass++) {
          await yieldTurn(context.signal);
          const next = optimizeSvg(result, { precision });
          if (next === result) break;
          result = next;
        }
        if (pretty) result = optimizeSvg(result, { precision, pretty, indent });
        await output(
          context,
          new TextEncoder().encode(result),
          outfile ?? (literal !== undefined ? "-" : (input ?? "-")),
          limits
        );
        return { exitCode: 0 };
      } catch (error) {
        return diagnostic(context, error);
      } finally {
        await operation.close();
      }
    }
  };
}
export function createSvgoCommands(
  options: SvgoCommandsOptions = {}
): readonly CommandDefinition[] {
  return [createSvgoCommand(options)];
}
export function svgoCommands(options: SvgoCommandsOptions = {}): VirtualShellPlugin {
  return plugin("svgo-commands", createSvgoCommands(options), options.replace);
}
