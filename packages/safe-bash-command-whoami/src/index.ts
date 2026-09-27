import {
  commandRuntimeIdentity,
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
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? 64 * 1024,
    maxPasswdBytes: options.limits?.maxPasswdBytes ?? 256 * 1024,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: whoami [OPTION]...
Print the user name associated with the current effective user ID
in the Sandbox VFS-ish/GNU environment.
Same as id -un.

      --help        display this help and exit
      --version     output version information and exit
`;

const VERSION_TEXT = `whoami (Sandbox VFS-ish/GNU coreutils) 9.7
Packaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)
`;

async function resolvePasswdUser(context: CommandContext, euid: number, maxBytes: number): Promise<string | undefined> {
  try {
    const bytes = await context.fs.readFile("/etc/passwd", { signal: context.signal });
    if (bytes.byteLength <= maxBytes) {
      const text = new TextDecoder().decode(bytes);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split(":");
        if (parts.length >= 3 && Number(parts[2]) === euid) {
          return parts[0]!;
        }
      }
    }
  } catch {
    // ignore
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
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += new TextEncoder().encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "whoami: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let endOfOptions = false;
      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && arg === "--help") {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg === "--version") {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("-")) {
          if (arg.startsWith("--")) {
            await writeText(context.stderr, `whoami: unrecognized option '${arg}'\n`);
          } else {
            await writeText(context.stderr, `whoami: invalid option -- '${arg[1] ?? ""}'\n`);
          }
          return { exitCode: 1 };
        }
        await writeText(context.stderr, `whoami: extra operand '${arg}'\n`);
        return { exitCode: 1 };
      }

      const rawEuid = context.env.EUID ?? context.env.UID;
      const euid = options.euid ?? options.uid ?? (rawEuid !== undefined && /^\d+$/.test(rawEuid) ? Number(rawEuid) : undefined);
      let username: string | undefined;
      if (euid !== undefined) {
        username = await resolvePasswdUser(context, euid, limits.maxPasswdBytes);
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
