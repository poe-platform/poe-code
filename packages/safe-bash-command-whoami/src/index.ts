import { shellValueByteLength } from "safe-bash-contracts/value";
import { isFsError } from "safe-bash-contracts/errors";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface WhoamiLimits {
  readonly maxArgumentBytes: number;
  readonly maxPasswdBytes: number;
}

export interface WhoamiCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly user?: string | undefined;
  readonly uid?: number | undefined;
  readonly euid?: number | undefined;
  readonly limits?: Partial<WhoamiLimits> | undefined;
}

export type WhoamiOptions = WhoamiCommandsOptions;

export function settings(options: WhoamiCommandsOptions = {}): WhoamiLimits {
  const limits: WhoamiLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
    maxPasswdBytes: options.limits?.maxPasswdBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: whoami [OPTION]...
Print the user name associated with the current effective user ID.
Same as id -un.

      --help        display this help and exit
      --version     output version information and exit

GNU coreutils online help: <https://www.gnu.org/software/coreutils/>
Report any translation bugs to <https://translationproject.org/team/>
Full documentation <https://www.gnu.org/software/coreutils/whoami>
or available locally via: info '(coreutils) whoami invocation'
`;

const VERSION_TEXT = `whoami (Sandbox VFS-ish/GNU coreutils) 9.7
Packaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)
`;

async function resolvePasswdUser(context: CommandContext, euid: number, maxBytes: number): Promise<string | undefined> {
  try {
    const bytes = await context.fs.readFile("/etc/passwd", { signal: context.signal });
    context.signal.throwIfAborted();
    if (bytes.byteLength > maxBytes) throw new RangeError("/etc/passwd exceeds size limit");
    const text = new TextDecoder().decode(bytes);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split(":");
      if (parts.length >= 3 && Number(parts[2]) === euid) {
        return parts[0]!;
      }
    }
  } catch (error) {
    context.signal.throwIfAborted();
    if (!isFsError(error, "ENOENT")) throw error;
  }
  return undefined;
}

export function createWhoamiCommand(options: WhoamiCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "whoami",
    description: "Print effective username (Sandbox VFS-ish/GNU)",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      const argv = getCommandArguments(context);
      let argBytes = 0;
      for (const arg of argv.values) {
        argBytes += shellValueByteLength(arg);
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "whoami: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let endOfOptions = false;
      let operand: number | undefined;
      const hint = "\nTry 'whoami --help' for more information.\n";
      for (const [i, arg] of argv.args.entries()) {
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
        } else if (endOfOptions || arg === "-" || !arg.startsWith("-")) {
          operand ??= i;
          if (context.env.POSIXLY_CORRECT !== undefined) break;
        } else if (arg.startsWith("--")) {
          const prefix = arg.split("=", 1)[0]!;
          const option = ["--help", "--version"].find(name => name.startsWith(prefix));
          if (option && prefix !== "--") {
            if (prefix === arg) {
              await writeText(context.stdout, option === "--help" ? HELP_TEXT : VERSION_TEXT);
              return { exitCode: 0 };
            }
            await writeText(context.stderr, `whoami: option '${option}' doesn't allow an argument${hint}`);
          } else {
            const ambiguous = prefix === "--";
            await writeText(context.stderr, ambiguous ? "whoami: option '" : "whoami: unrecognized option '");
            await context.stderr.write(argv.bytes(i)!);
            await writeText(context.stderr, (ambiguous ? "' is ambiguous; possibilities: '--help' '--version'" : "'") + hint);
          }
          return { exitCode: 1 };
        } else {
          await writeText(context.stderr, "whoami: invalid option -- '");
          await context.stderr.write(argv.bytes(i)!.subarray(1, 2));
          await writeText(context.stderr, "'" + hint);
          return { exitCode: 1 };
        }
      }
      if (operand !== undefined) {
        let quoted = "";
        for (const b of argv.bytes(operand)!) {
          if (b === 39 || b === 92) quoted += "\\" + String.fromCharCode(b);
          else if (b >= 7 && b <= 13) quoted += "\\" + "abtnvfr"[b - 7];
          else if (b >= 32 && b < 127) quoted += String.fromCharCode(b);
          else quoted += "\\" + b.toString(8).padStart(3, "0");
        }
        await writeText(context.stderr, `whoami: extra operand '${quoted}'${hint}`);
        return { exitCode: 1 };
      }

      const rawEuid = context.env.EUID ?? context.env.UID;
      const euid = options.euid ?? options.uid ?? (rawEuid !== undefined && /^\d+$/.test(rawEuid) ? Number(rawEuid) : undefined);
      let username: string | undefined;
      if (euid !== undefined) {
        try {
          username = await resolvePasswdUser(context, euid, limits.maxPasswdBytes);
        } catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof RangeError)) throw error;
          await writeText(context.stderr, `whoami: ${error.message}\n`);
          return { exitCode: 1 };
        }
        if (!username) {
          if (euid === 0) username = "root";
          else if (euid === 65534) username = "nobody";
          else if (euid === 1) username = "daemon";
        }
      }
      username ??= options.user ?? context.env.WHOAMI ?? context.env.USER ?? context.env.LOGNAME ?? "sandbox";
      await writeText(context.stdout, `${username}\n`);
      return { exitCode: 0 };
    },
  };
}

export function createWhoamiCommands(options: WhoamiCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createWhoamiCommand(options)]);
}

export function whoamiCommands(options: WhoamiCommandsOptions = {}): VirtualShellPlugin {
  const commands = createWhoamiCommands(options);
  return {
    name: "whoami-commands",
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
