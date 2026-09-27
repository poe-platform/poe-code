import {
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface UnameLimits {
  readonly maxArgumentBytes: number;
}

export interface UnameCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly kernelName?: string | undefined;
  readonly nodename?: string | undefined;
  readonly kernelRelease?: string | undefined;
  readonly kernelVersion?: string | undefined;
  readonly machine?: string | undefined;
  readonly processor?: string | undefined;
  readonly hardwarePlatform?: string | undefined;
  readonly operatingSystem?: string | undefined;
  readonly limits?: Partial<UnameLimits> | undefined;
}

export type UnameOptions = UnameCommandsOptions;

export function settings(options: UnameCommandsOptions = {}): UnameLimits {
  const limits: UnameLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: uname [OPTION]...
Print certain system information.  With no OPTION, same as -s.
Reports the Sandbox VFS-ish/GNU virtual platform identity.

  -a, --all                print all information, in the following order,
                             except omit -p and -i if unknown:
  -s, --kernel-name        print the kernel name
  -n, --nodename           print the network node hostname
  -r, --kernel-release     print the kernel release
  -v, --kernel-version     print the kernel version
  -m, --machine            print the machine hardware name
  -p, --processor          print the processor type (non-portable)
  -i, --hardware-platform  print the hardware platform (non-portable)
  -o, --operating-system   print the operating system
      --help               display this help and exit
      --version            output version information and exit
`;

const VERSION_TEXT = `uname (Sandbox VFS-ish/GNU coreutils) 9.7
Packaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)
`;

export function createUnameCommand(options: UnameCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "uname",
    description: "Print Sandbox VFS-ish/GNU platform and kernel information",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += new TextEncoder().encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "uname: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let flagAll = false;
      let flagS = false;
      let flagN = false;
      let flagR = false;
      let flagV = false;
      let flagM = false;
      let flagP = false;
      let flagI = false;
      let flagO = false;
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
        if (!endOfOptions && arg.startsWith("--") && arg.length > 2) {
          switch (arg) {
            case "--all":
              flagAll = true;
              break;
            case "--kernel-name":
            case "--sysname":
              flagS = true;
              break;
            case "--nodename":
              flagN = true;
              break;
            case "--kernel-release":
            case "--release":
              flagR = true;
              break;
            case "--kernel-version":
              flagV = true;
              break;
            case "--machine":
              flagM = true;
              break;
            case "--processor":
              flagP = true;
              break;
            case "--hardware-platform":
              flagI = true;
              break;
            case "--operating-system":
              flagO = true;
              break;
            default:
              await writeText(context.stderr, `uname: unrecognized option '${arg}'\n`);
              return { exitCode: 1 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            switch (ch) {
              case "a":
                flagAll = true;
                break;
              case "s":
                flagS = true;
                break;
              case "n":
                flagN = true;
                break;
              case "r":
                flagR = true;
                break;
              case "v":
                flagV = true;
                break;
              case "m":
                flagM = true;
                break;
              case "p":
                flagP = true;
                break;
              case "i":
                flagI = true;
                break;
              case "o":
                flagO = true;
                break;
              default:
                await writeText(context.stderr, `uname: invalid option -- '${ch}'\n`);
                return { exitCode: 1 };
            }
          }
          continue;
        }
        await writeText(context.stderr, `uname: extra operand '${arg}'\n`);
        return { exitCode: 1 };
      }

      if (!flagAll && !flagS && !flagN && !flagR && !flagV && !flagM && !flagP && !flagI && !flagO) {
        flagS = true;
      }

      const kernelName = options.kernelName ?? context.env.UNAME_S ?? "Linux";
      const nodename = options.nodename ?? context.env.UNAME_N ?? context.env.HOSTNAME ?? "sandbox";
      const kernelRelease = options.kernelRelease ?? context.env.UNAME_R ?? "6.6.0-sandbox-vfs";
      const kernelVersion = options.kernelVersion ?? context.env.UNAME_V ?? "#1 SMP Sandbox VFS-ish/GNU";
      const machine = options.machine ?? context.env.UNAME_M ?? "x86_64";
      const processor = options.processor ?? context.env.UNAME_P ?? "unknown";
      const hardwarePlatform = options.hardwarePlatform ?? context.env.UNAME_I ?? "unknown";
      const operatingSystem = options.operatingSystem ?? context.env.UNAME_O ?? "GNU/Linux";

      const fields: string[] = [];
      if (flagAll || flagS) fields.push(kernelName);
      if (flagAll || flagN) fields.push(nodename);
      if (flagAll || flagR) fields.push(kernelRelease);
      if (flagAll || flagV) fields.push(kernelVersion);
      if (flagAll || flagM) fields.push(machine);
      if (flagP || (flagAll && processor !== "unknown")) fields.push(processor);
      if (flagI || (flagAll && hardwarePlatform !== "unknown")) fields.push(hardwarePlatform);
      if (flagAll || flagO) fields.push(operatingSystem);

      await writeText(context.stdout, `${fields.join(" ")}\n`);
      return { exitCode: 0 };
    },
  };
}

export function createUnameCommands(options: UnameCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createUnameCommand(options)]);
}

export function unameCommands(options: UnameCommandsOptions = {}): VirtualShellPlugin {
  const commands = createUnameCommands(options);
  return {
    name: "uname-commands",
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
