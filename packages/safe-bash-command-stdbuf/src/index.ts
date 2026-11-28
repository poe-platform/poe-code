import { FsError, getCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { writeDiagnostic } from "safe-bash-contracts/escaping";

export interface StdbufLimits { readonly maxArgumentBytes: number; }
export interface StdbufCommandsOptions { readonly limits?: Partial<StdbufLimits>; readonly replace?: boolean; }

function validMode(mode: string, input: boolean): boolean {
  if (mode === "L") return !input;
  let end = 0;
  while (end < mode.length && mode[end]! >= "0" && mode[end]! <= "9") end++;
  if (end === 0) return false;
  const suffix = mode.slice(end);
  return suffix === "" || suffix === "b" || suffix === "kB" ||
    [..."KMGTPEZYRQ"].some(unit => suffix === unit || suffix === `${unit}B` || suffix === `${unit}iB`);
}

export function createStdbufCommand(options: StdbufCommandsOptions = {}): CommandDefinition {
  const max = options.limits?.maxArgumentBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("maxArgumentBytes must be a positive safe integer");
  return {
    name: "stdbuf",
    async execute(context) {
      const values = getCommandArguments(context);
      let bytes = 0;
      for (const value of values.values) {
        bytes += shellValueByteLength(value);
        if (bytes > max) throw new FsError("EFBIG", { message: "argument byte limit exceeded" });
      }
      const fail = async (message: string) => {
        await writeDiagnostic(context.stderr, `stdbuf: ${message}\n`, context.signal);
        return { exitCode: 125 };
      };
      let offset = 0;
      let configured = false;
      while (offset < values.args.length) {
        const arg = values.args[offset]!;
        if (arg === "--") { offset++; break; }
        if (!arg.startsWith("-") || arg === "-") break;
        if (arg === "--help" || arg === "--version") {
          await context.stdout.write(new TextEncoder().encode(arg === "--help"
            ? "Usage: stdbuf OPTION... COMMAND [ARG]...\n  -i, --input=MODE   input buffering\n  -o, --output=MODE  output buffering\n  -e, --error=MODE   error buffering\nMODE is L (output only), 0, or a buffer size. Buffering modes are validated but have no effect in the virtual shell.\n"
            : "stdbuf (safe-bash virtual shell)\n"));
          return { exitCode: 0 };
        }
        let stream: string;
        let mode: string | undefined;
        if (arg.startsWith("--")) {
          const equals = arg.indexOf("=");
          const name = equals < 0 ? arg : arg.slice(0, equals);
          stream = name === "--input" ? "i" : name === "--output" ? "o" : name === "--error" ? "e" : "";
          if (!stream) return fail(`unrecognized option '${arg}'`);
          mode = equals < 0 ? values.args[++offset] : arg.slice(equals + 1);
        } else {
          stream = arg[1]!;
          if (!"ioe".includes(stream)) return fail(`invalid option '${arg}'`);
          mode = arg.length > 2 ? arg.slice(2) : values.args[++offset];
        }
        if (mode === undefined) return fail(`option '${arg}' requires an argument`);
        if (!validMode(mode, stream === "i")) return fail(`invalid mode '${mode}'`);
        configured = true;
        offset++;
      }
      const command = values.args[offset];
      if (command === undefined) return fail("missing operand");
      if (!configured) return fail("you must specify a buffering mode option");
      if (!context.invoke) throw new FsError("ENOTSUP", { path: command });
      const argumentValues = values.slice(offset + 1);
      return context.invoke(command, argumentValues.args, {
        argumentValues, externalInvocation: true,
        stdin: context.stdin, stdout: context.stdout, stderr: context.stderr,
        ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
      });
    },
  };
}

export function createStdbufCommands(options: StdbufCommandsOptions = {}): readonly CommandDefinition[] {
  return [createStdbufCommand(options)];
}

export function stdbufCommands(options: StdbufCommandsOptions = {}): VirtualShellPlugin {
  const commands = createStdbufCommands(options);
  return { name: "stdbuf-commands", setup(host) {
    if (!options.replace && host.commands.has("stdbuf")) throw new Error("Command already registered: stdbuf");
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
