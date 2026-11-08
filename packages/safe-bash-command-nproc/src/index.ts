import {
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface NprocLimits {
  readonly maxArgumentBytes: number;
}

export interface NprocCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly processors?: number | undefined;
  readonly limits?: Partial<NprocLimits> | undefined;
}

export type NprocOptions = NprocCommandsOptions;

export function settings(options: NprocCommandsOptions = {}): NprocLimits {
  const limits: NprocLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: nproc [OPTION]...
Print the number of processing units available to the current process,
which may be less than the number of online processors (Sandbox VFS-ish/GNU).

      --all      print the number of installed processors
      --ignore=N  if possible, exclude N processing units
      --help     display this help and exit
      --version  output version information and exit
`;

const VERSION_TEXT = `nproc (Sandbox VFS-ish/GNU coreutils) 9.7
Packaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)
`;

function parseOmpPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim() ?? "";
  if (!/^[+]?\d+$/.test(first)) return undefined;
  const val = Number(first);
  if (!Number.isSafeInteger(val) || val < 1) return undefined;
  return val;
}

export function createNprocCommand(options: NprocCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const defaultProcessors = options.processors ?? 4;
  if (!Number.isSafeInteger(defaultProcessors) || defaultProcessors < 1) {
    throw new RangeError("processors must be a positive safe integer");
  }
  return {
    name: "nproc",
    description: "Print the number of processing units available (Sandbox VFS-ish/GNU)",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += new TextEncoder().encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "nproc: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let all = false;
      let ignore = 0;
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
        if (!endOfOptions && arg === "--all") {
          all = true;
          continue;
        }
        if (!endOfOptions && (arg === "--ignore" || arg.startsWith("--ignore="))) {
          const valStr = arg === "--ignore" ? context.args[++i] : arg.slice("--ignore=".length);
          if (valStr === undefined) {
            await writeText(context.stderr, "nproc: option '--ignore' requires an argument\n");
            return { exitCode: 1 };
          }
          if (!/^[+]?\d+$/.test(valStr.trim())) {
            await writeText(context.stderr, `nproc: invalid number: '${valStr}'\n`);
            return { exitCode: 1 };
          }
          const parsed = Number(valStr.trim());
          if (!Number.isSafeInteger(parsed) || parsed < 0) {
            await writeText(context.stderr, `nproc: invalid number: '${valStr}'\n`);
            return { exitCode: 1 };
          }
          ignore = parsed;
          continue;
        }
        if (!endOfOptions && arg.startsWith("-")) {
          await writeText(context.stderr, `nproc: unrecognized option '${arg}'\n`);
          return { exitCode: 1 };
        }
        await writeText(context.stderr, `nproc: extra operand '${arg}'\n`);
        return { exitCode: 1 };
      }

      const envProcs = parseOmpPositiveInt(context.env.NPROC);
      const installed = envProcs ?? defaultProcessors;
      let count = installed;

      if (!all) {
        const ompThreads = parseOmpPositiveInt(context.env.OMP_NUM_THREADS);
        const ompLimit = parseOmpPositiveInt(context.env.OMP_THREAD_LIMIT);
        if (ompThreads !== undefined) {
          count = ompThreads;
        }
        if (ompLimit !== undefined && count > ompLimit) {
          count = ompLimit;
        }
      }

      const result = count > ignore ? count - ignore : 1;
      await writeText(context.stdout, `${result}\n`);
      return { exitCode: 0 };
    },
  };
}

export function createNprocCommands(options: NprocCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createNprocCommand(options)]);
}

export function nprocCommands(options: NprocCommandsOptions = {}): VirtualShellPlugin {
  const commands = createNprocCommands(options);
  return {
    name: "nproc-commands",
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
