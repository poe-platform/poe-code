import {
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface GetconfLimits {
  readonly maxArgumentBytes: number;
}

export interface GetconfCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly processors?: number | undefined;
  readonly variables?: Readonly<Record<string, string | number>> | undefined;
  readonly limits?: Partial<GetconfLimits> | undefined;
}

export type GetconfOptions = GetconfCommandsOptions;

export function settings(options: GetconfCommandsOptions = {}): GetconfLimits {
  const limits: GetconfLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: getconf [-v specification] variable_name [pathname]
       getconf -a [pathname]

Query system configuration variables in the Sandbox VFS-ish/GNU environment.
`;

const VERSION_TEXT = `getconf (Sandbox VFS-ish/GNU libc) 2.39
`;

const PATH_VARIABLES = new Set([
  "FILESIZEBITS",
  "LINK_MAX",
  "MAX_CANON",
  "MAX_INPUT",
  "NAME_MAX",
  "PATH_MAX",
  "PIPE_BUF",
  "POSIX_ALLOC_SIZE_MIN",
  "POSIX_REC_INCR_XFER_SIZE",
  "POSIX_REC_MAX_XFER_SIZE",
  "POSIX_REC_MIN_XFER_SIZE",
  "POSIX_REC_XFER_ALIGN",
  "SYMLINK_MAX",
  "_POSIX_CHOWN_RESTRICTED",
  "_POSIX_NO_TRUNC",
  "_POSIX_VDISABLE",
]);

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

function buildConfigTable(options: GetconfCommandsOptions): Record<string, string> {
  const nproc = String(options.processors ?? 4);
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    CS_PATH: "/usr/local/bin:/usr/bin:/bin",
    ARG_MAX: "2097152",
    _POSIX_ARG_MAX: "4096",
    NAME_MAX: "255",
    _POSIX_NAME_MAX: "14",
    PATH_MAX: "4096",
    _POSIX_PATH_MAX: "256",
    PAGE_SIZE: "4096",
    PAGESIZE: "4096",
    NPROCESSORS_ONLN: nproc,
    _NPROCESSORS_ONLN: nproc,
    NPROCESSORS_CONF: nproc,
    _NPROCESSORS_CONF: nproc,
    CLK_TCK: "100",
    OPEN_MAX: "1024",
    _POSIX_OPEN_MAX: "20",
    CHILD_MAX: "256",
    _POSIX_CHILD_MAX: "25",
    LINE_MAX: "2048",
    _POSIX2_LINE_MAX: "2048",
    PIPE_BUF: "4096",
    _POSIX_PIPE_BUF: "512",
    LINK_MAX: "65000",
    _POSIX_LINK_MAX: "8",
    MAX_CANON: "255",
    _POSIX_MAX_CANON: "255",
    MAX_INPUT: "255",
    _POSIX_MAX_INPUT: "255",
    FILESIZEBITS: "64",
    SYMLINK_MAX: "4095",
    SYMLOOP_MAX: "40",
    _POSIX_SYMLOOP_MAX: "8",
    HOST_NAME_MAX: "64",
    _POSIX_HOST_NAME_MAX: "255",
    LOGIN_NAME_MAX: "256",
    _POSIX_LOGIN_NAME_MAX: "9",
    NGROUPS_MAX: "65536",
    _POSIX_NGROUPS_MAX: "8",
    TZNAME_MAX: "6",
    _POSIX_TZNAME_MAX: "6",
    CHAR_BIT: "8",
    WORD_BIT: "32",
    LONG_BIT: "64",
    INT_MAX: "2147483647",
    INT_MIN: "-2147483648",
    UINT_MAX: "4294967295",
    LONG_MAX: "9223372036854775807",
    ULONG_MAX: "18446744073709551615",
    LLONG_MAX: "9223372036854775807",
    ULLONG_MAX: "18446744073709551615",
    SSIZE_MAX: "9223372036854775807",
    POSIX_VERSION: "200809",
    _POSIX_VERSION: "200809",
    POSIX2_VERSION: "200809",
    _POSIX2_VERSION: "200809",
    XOPEN_VERSION: "700",
    _XOPEN_VERSION: "700",
    POSIX_V7_LP64_OFF64: "1",
    POSIX_V6_LP64_OFF64: "1",
    XBS5_LP64_OFF64: "1",
    _POSIX_CHOWN_RESTRICTED: "1",
    _POSIX_NO_TRUNC: "1",
    _POSIX_VDISABLE: "0",
    BC_BASE_MAX: "99",
    BC_DIM_MAX: "2048",
    BC_SCALE_MAX: "99",
    BC_STRING_MAX: "1000",
    COLL_WEIGHTS_MAX: "255",
    EXPR_NEST_MAX: "32",
    RE_DUP_MAX: "32767",
    GNU_LIBC_VERSION: "glibc 2.39",
    GNU_LIBPTHREAD_VERSION: "NPTL 2.39",
    LFS_CFLAGS: "-D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64",
    LFS_LDFLAGS: "",
    LFS_LIBS: "",
    ...(options.variables
      ? Object.fromEntries(Object.entries(options.variables).map(([k, v]) => [k, String(v)]))
      : {}),
  };
}

export function createGetconfCommand(options: GetconfCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const sharedEncoder = new TextEncoder();
  return {
    name: "getconf",
    description: "Query POSIX and GNU system configuration variables",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += sharedEncoder.encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "getconf: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let allMode = false;
      const operands: string[] = [];
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
        if (!endOfOptions && arg === "-a") {
          allMode = true;
          continue;
        }
        if (!endOfOptions && arg === "-v") {
          const spec = context.args[++i];
          if (spec === undefined) {
            await writeText(context.stderr, "getconf: option requires an argument -- 'v'\n");
            return { exitCode: 1 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-")) {
          await writeText(context.stderr, `getconf: invalid option -- '${arg[1] ?? ""}'\n`);
          return { exitCode: 1 };
        }
        operands.push(arg);
      }

      const table = buildConfigTable(options);

      if (allMode) {
        if (operands.length > 1) {
          await writeText(context.stderr, "getconf: too many arguments\n");
          return { exitCode: 1 };
        }
        if (operands.length === 1) {
          const resolved = resolveVfsPath(context.cwd, operands[0]!);
          try {
            await context.fs.stat(resolved, { signal: context.signal });
          } catch {
            await writeText(context.stderr, `getconf: ${operands[0]}: No such file or directory\n`);
            return { exitCode: 1 };
          }
        }
        const lines = Object.entries(table).map(([k, v]) => `${k.padEnd(31, " ")}${v}`);
        await writeText(context.stdout, `${lines.join("\n")}\n`);
        return { exitCode: 0 };
      }

      if (operands.length === 0 || operands.length > 2) {
        await writeText(context.stderr, HELP_TEXT);
        return { exitCode: 1 };
      }

      const varName = operands[0]!;
      const normalized = ["_CS_", "_PC_", "_SC_"].some(prefix => varName.startsWith(prefix))
        ? varName.slice(4)
        : varName;
      const isPathVariable = PATH_VARIABLES.has(normalized);

      if (operands.length === 2) {
        if (!isPathVariable) {
          await writeText(context.stderr, `getconf: ${varName} does not accept a pathname\n`);
          return { exitCode: 1 };
        }
        const pathArg = operands[1]!;
        const resolved = resolveVfsPath(context.cwd, pathArg);
        try {
          await context.fs.stat(resolved, { signal: context.signal });
        } catch {
          await writeText(context.stderr, `getconf: ${pathArg}: No such file or directory\n`);
          return { exitCode: 1 };
        }
      } else if (isPathVariable && normalized !== "NAME_MAX" && normalized !== "PATH_MAX" && normalized !== "PIPE_BUF") {
        // NAME_MAX, PATH_MAX, and PIPE_BUF retain optional pathnames for convenience.
        await writeText(context.stderr, `getconf: ${varName} requires a pathname\n`);
        return { exitCode: 1 };
      }

      const value = table[varName] ?? table[normalized];
      if (value === undefined) {
        await writeText(context.stderr, `getconf: Unrecognized variable '${varName}'\n`);
        return { exitCode: 1 };
      }

      await writeText(context.stdout, `${value}\n`);
      return { exitCode: 0 };
    },
  };
}

export function createGetconfCommands(options: GetconfCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createGetconfCommand(options)]);
}

export function getconfCommands(options: GetconfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGetconfCommands(options);
  return {
    name: "getconf-commands",
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
