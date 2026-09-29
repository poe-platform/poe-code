import { yieldTurn } from "safe-bash-contracts/yield";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  shellValueByteLength,
  shellValueBytes,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface PathchkLimits {
  readonly maxArgumentBytes: number;
}

export interface PathchkCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly limits?: Partial<PathchkLimits> | undefined;
}

export type PathchkOptions = PathchkCommandsOptions;

export function settings(options: PathchkCommandsOptions = {}): PathchkLimits {
  const limits: PathchkLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: pathchk [OPTION]... NAME...
Diagnose invalid or unportable file names.

  -p                  check for most POSIX systems
  -P                  check for empty names and leading "-"
      --portability   check for all POSIX systems (equivalent to -p -P)
      --help          display this help and exit
      --version       output version information and exit
`;

const VERSION_TEXT = `pathchk (Sandbox VFS-ish/GNU coreutils) 9.7
`;

const PORTABLE_CHAR_RE = /^[A-Za-z0-9._-]+$/;

function resolveVfsPath(cwd: string, target: string): string {
  const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : `${cwd}/${target}`);
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

export function createPathchkCommand(options: PathchkCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "pathchk",
    description: "Check whether file names are valid or portable",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      const carrier = getCommandArguments(context);
      const args = carrier.args;
      let argBytes = 0;
      for (const value of carrier.values) {
        argBytes += shellValueByteLength(value);
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "pathchk: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let checkBasicPosix = false;
      let checkExtraPosix = false;
      const operands: number[] = [];
      let endOfOptions = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
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
        if (!endOfOptions && arg === "--portability") {
          checkBasicPosix = true;
          checkExtraPosix = true;
          continue;
        }
        if (!endOfOptions && arg.startsWith("--") && arg.length > 2) {
          await writeText(context.stderr, `pathchk: unrecognized option '${arg}'\n`);
          return { exitCode: 1 };
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            if (ch === "p") checkBasicPosix = true;
            else if (ch === "P") checkExtraPosix = true;
            else {
              await writeText(context.stderr, `pathchk: invalid option -- '${ch}'\n`);
              return { exitCode: 1 };
            }
          }
          continue;
        }
        operands.push(i);
      }

      if (operands.length === 0) {
        await writeText(context.stderr, "pathchk: missing operand\n");
        return { exitCode: 1 };
      }

      let exitCode = 0;
      const pathMax = checkBasicPosix ? 256 : 4096;
      const nameMax = checkBasicPosix ? 14 : 255;

      let checked = 0;
      for (const position of operands) {
        const name = args[position]!;
        const value = carrier.values[position]!;
        context.signal.throwIfAborted();
        if ((checked++ & 127) === 0) await yieldTurn(context.signal);
        if (name.length === 0) {
          if (checkExtraPosix) {
            await writeText(context.stderr, "pathchk: empty file name\n");
          } else {
            await writeText(context.stderr, "pathchk: '': No such file or directory\n");
          }
          exitCode = 1;
          continue;
        }

        const byteLen = shellValueByteLength(value);
        if (byteLen >= pathMax) {
          await writeText(
            context.stderr,
            `pathchk: limit ${pathMax} exceeded by length ${byteLen} of file name '${name}'\n`
          );
          exitCode = 1;
          continue;
        }

        const components = name.split("/").filter(Boolean);
        let componentFailed = false;

        const bytes = shellValueBytes(value);
        let byteOffset = 0;
        for (const comp of components) {
          while (bytes[byteOffset] === 47) byteOffset++;
          const componentStart = byteOffset;
          while (byteOffset < bytes.length && bytes[byteOffset] !== 47) byteOffset++;
          const compBytes = byteOffset - componentStart;
          if (checkExtraPosix && comp.startsWith("-")) {
            await writeText(context.stderr, `pathchk: leading '-' in a component of file name '${name}'\n`);
            componentFailed = true;
            break;
          }
          if (checkBasicPosix && !PORTABLE_CHAR_RE.test(comp)) {
            let badChar = "";
            for (const ch of comp) {
              if (!PORTABLE_CHAR_RE.test(ch)) {
                badChar = ch;
                break;
              }
            }
            await writeText(context.stderr, `pathchk: nonportable character '${badChar}' in file name '${name}'\n`);
            componentFailed = true;
            break;
          }
          if (compBytes > nameMax) {
            await writeText(
              context.stderr,
              `pathchk: limit ${nameMax} exceeded by length ${compBytes} of file name component '${comp}'\n`
            );
            componentFailed = true;
            break;
          }
        }

        if (componentFailed) {
          exitCode = 1;
          continue;
        }

        if (!checkBasicPosix) {
          // Verify existing ancestor prefixes on VFS are directories
          const full = resolveVfsPath(context.cwd, name);
          const parts = full.split("/").filter(Boolean);
          let current = "";
          for (let k = 0; k < parts.length - 1; k++) {
            context.signal.throwIfAborted();
            if ((k & 127) === 0) await yieldTurn(context.signal);
            current += "/" + parts[k]!;
            try {
              const st = await context.fs.stat(current, { signal: context.signal });
              if (st.type !== "directory") {
                await writeText(context.stderr, `pathchk: '${name}': Not a directory\n`);
                exitCode = 1;
                break;
              }
            } catch {
              context.signal.throwIfAborted();
              break;
            }
          }
        }
      }

      return { exitCode };
    },
  };
}

export function createPathchkCommands(options: PathchkCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createPathchkCommand(options)]);
}

export function pathchkCommands(options: PathchkCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPathchkCommands(options);
  return {
    name: "pathchk-commands",
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
