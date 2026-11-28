import {
  commandRuntimeIdentity, getCommandArguments,
  type CommandDefinition, type VirtualShellPlugin,
} from "safe-bash-contracts";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { writeDiagnostic } from "safe-bash-contracts/escaping";

export interface StdbufLimits {
  readonly maxArgumentBytes: number;
}

export interface StdbufCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<StdbufLimits>;
}

function validSize(mode: string): boolean {
  let end = 0;
  while (end < mode.length && " \t\n\r\v\f".includes(mode[end]!)) end++;
  const signed = mode[end] === "+";
  if (signed) end++;
  const start = end;
  while (end < mode.length && mode[end]! >= "0" && mode[end]! <= "9") end++;
  if (end === start && (signed || end === mode.length)) return false;
  const suffix = mode.slice(end);
  let multiplier = 1n;
  if (suffix) {
    const power = "KMGTPEZYRQ".indexOf(suffix[0] === "k" ? "K" : suffix[0]!) + 1;
    if (!power || !["", "B", "iB"].includes(suffix.slice(1))) return false;
    multiplier = (suffix.slice(1) === "B" ? 1000n : 1024n) ** BigInt(power);
  }
  // Buffer sizes are validated only; the virtual shell never allocates them.
  let size = end === start ? 1n : 0n;
  for (let index = start; index < end; index++) {
    size = size * 10n + BigInt(mode[index]!);
    if (size > 18446744073709551615n) return false;
  }
  return size * multiplier <= 18446744073709551615n;
}

export function createStdbufCommand(options: StdbufCommandsOptions = {}): CommandDefinition {
  const maxArgumentBytes = options.limits?.maxArgumentBytes ?? Infinity;
  if (maxArgumentBytes !== Infinity && (!Number.isSafeInteger(maxArgumentBytes) || maxArgumentBytes < 1)) {
    throw new RangeError("maxArgumentBytes must be positive");
  }
  return {
    name: "stdbuf",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      context.signal.throwIfAborted();
      const fail = async (message: string) => {
        await writeDiagnostic(context.stderr, `stdbuf: ${message}\n`, context.signal);
        return { exitCode: 125 };
      };
      const arguments_ = getCommandArguments(context);
      let bytes = 0;
      for (const value of arguments_.values) {
        bytes += shellValueByteLength(value);
        if (bytes > maxArgumentBytes) return fail("argument byte limit exceeded");
      }
      const args = arguments_.args;
      let offset = 0;
      let hasMode = false;
      while (offset < args.length) {
        const arg = args[offset]!;
        if (arg === "--") { offset++; break; }
        if (arg === "-" || !arg.startsWith("-")) break;
        if (arg === "--help" || arg === "--version") {
          await writeDiagnostic(context.stdout, arg === "--help"
            ? "Usage: stdbuf OPTION... COMMAND [ARG]...\n  -i, --input=MODE\n  -o, --output=MODE\n  -e, --error=MODE\nValidate buffering modes and run COMMAND; virtual streams are unchanged.\n"
            : "stdbuf (safe-bash)\n", context.signal);
          return { exitCode: 0 };
        }
        let stream: string;
        let mode: string | undefined;
        if (arg.startsWith("--")) {
          const equals = arg.indexOf("=");
          const prefix = equals < 0 ? arg.slice(2) : arg.slice(2, equals);
          const name = prefix && ["input", "output", "error"].find(name => name.startsWith(prefix));
          if (!name) return fail(`unrecognized option '${arg}'`);
          stream = name[0]!;
          mode = equals < 0 ? args[++offset] : arg.slice(equals + 1);
        } else {
          stream = arg[1]!;
          if (!["i", "o", "e"].includes(stream)) return fail(`invalid option -- '${stream}'`);
          mode = arg.length === 2 ? args[++offset] : arg.slice(2);
        }
        if (mode === undefined) return fail(`option '${arg}' requires an argument`);
        if (mode === "L" && stream === "i") return fail("line buffering stdin is meaningless");
        if (mode !== "L" && !validSize(mode)) return fail(`invalid mode '${mode}'`);
        hasMode = true;
        offset++;
      }
      const command = args[offset];
      if (command === undefined) return fail("missing operand");
      if (!hasMode) return fail("you must specify a buffering mode option");
      if (!context.invoke) return fail("command invocation is unavailable");
      const argumentValues = arguments_.slice(offset + 1);
      return context.invoke(command, argumentValues.args, {
        argumentValues, externalInvocation: true, signal: context.signal,
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
  return {
    name: "stdbuf-commands",
    setup(host) {
      if (!options.replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
