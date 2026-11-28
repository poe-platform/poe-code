import { commandRuntimeIdentity, getCommandArguments, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { define } from "safe-bash-io-engine/internal";
import { type GzipHelperOptions } from "safe-bash-compression-engine/decoded-input";
import { createGrepCommand, type GrepCommandsOptions } from "safe-bash-command-grep";
import { GREP_SHORT_OPTIONS, GREP_LONG_OPTIONS } from "safe-bash-command-grep/grep";
import { decodedInput } from "safe-bash-compression-engine/decoded-input";
import { options as parseOptions, diagnostic, UsageError } from "safe-bash-io-engine/internal";

export interface ZgrepLimits { readonly maxDecodedBytes: number; }
export interface ZgrepCommandsOptions extends GzipHelperOptions, GrepCommandsOptions {}

export function createZgrepCommand(options: ZgrepCommandsOptions = {}): CommandDefinition {
  const grep = createGrepCommand(options);
  const command = define("zgrep", async context => {
    const carrier = getCommandArguments(context);
    const operands: number[] = [];
    const parsed = parseOptions(context.args, GREP_SHORT_OPTIONS, GREP_LONG_OPTIONS, false, index => operands.push(index));
    if (parsed.flags.has("help")) return grep.execute(context);
    for (const flag of ["r", "R", "d", "D"]) if (parsed.flags.has(flag)) throw new UsageError(`option -${flag} is not supported by zgrep`);
    if (!parsed.flags.has("e") && !parsed.flags.has("f")) {
      if (!operands.length) throw new UsageError("missing pattern");
      operands.shift();
    }
    const fileIndices = new Set(operands);
    const search = carrier.select(context.args.map((_, index) => index).filter(index => !fileIndices.has(index)));
    const files = operands.length ? operands.map(index => context.args[index]!) : ["-"];
    const decode = decodedInput(context, options);
    let status = 1;
    for (const file of files) {
      try {
        let result = 1;
        const prefix = [...(files.length > 1 ? ["-H"] : []), `--label=${file === "-" ? "(standard input)" : file}`];
        const args = carrier.withValues(prefix).concat(search);
        const { stdinInput: ignoredStdinInput, ...rest } = context;
        result = (await grep.execute({ ...rest, args: args.args, argumentValues: args, stdin: decode(file), stdinIsDefault: false })).exitCode;
        if (result > 1) status = 2;
        else if (result === 0 && status !== 2) status = 0;
      } catch (error) {
        context.signal.throwIfAborted();
        await diagnostic(context, error);
        status = 2;
      }
    }
    return { exitCode: status };
  }, 2);
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZgrepCommands(options: ZgrepCommandsOptions = {}): readonly CommandDefinition[] {
  return [createZgrepCommand(options)];
}

export function zgrepCommands(options: ZgrepCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZgrepCommands(options);
  return { name: "zgrep-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
