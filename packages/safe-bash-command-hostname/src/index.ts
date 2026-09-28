import { isFsError } from "safe-bash-contracts/errors";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
    writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface HostnameLimits {
  readonly maxArgumentBytes: number;
  readonly maxFileBytes: number;
}

export interface HostnameCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly hostname?: string | undefined;
  readonly domain?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly allowSet?: boolean | undefined;
  readonly limits?: Partial<HostnameLimits> | undefined;
}

export type HostnameOptions = HostnameCommandsOptions;

export function settings(options: HostnameCommandsOptions = {}): HostnameLimits {
  const limits: HostnameLimits = {
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
    maxFileBytes: options.limits?.maxFileBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: hostname [OPTION...] [NAME]
Show or set the system's host name in the Sandbox VFS-ish/GNU environment.

  -a, --alias             alias names
  -A, --all-fqdns         all long host names (FQDNs)
  -d, --domain            DNS domain name
  -f, --fqdn, --long      long host name (FQDN)
  -F, --file=FILE         read host name or NIS domain name from FILE
  -i, --ip-address        addresses for the host name
  -I, --all-ip-addresses  all addresses for the host
  -s, --short             short host name
  -y, --yp, --nis         NIS/YP domain name
      --help              give this help list
      --version           print program version
`;

const VERSION_TEXT = `hostname (Sandbox VFS-ish/GNU inetutils) 2.5
Packaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)
`;

async function readHostnameFile(context: CommandContext, filePath: string, maxBytes: number): Promise<string> {
  const resolved = filePath.startsWith("/") ? filePath : (context.cwd.endsWith("/") ? context.cwd + filePath : context.cwd + "/" + filePath);
  const bytes = await context.fs.readFile(resolved, { signal: context.signal });
  context.signal.throwIfAborted();
  if (bytes.byteLength > maxBytes) {
    throw new RangeError("hostname file exceeds size limit");
  }
  const text = new TextDecoder().decode(bytes);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/#.*$/, "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function createHostnameCommand(options: HostnameCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const sessionHostnames = new WeakMap<CommandContext["fs"], string>();
  return {
    name: "hostname",
    description: "Show or set the Sandbox VFS-ish/GNU hostname",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += new TextEncoder().encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "hostname: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let mode: "default" | "short" | "fqdn" | "all-fqdns" | "domain" | "ip" | "all-ips" | "alias" | "nis" = "default";
      let fileSource: string | undefined;
      const operands: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && (arg === "--help" || arg === "-h" || arg === "-?")) {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--version" || arg === "-V")) {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("--file=")) {
          fileSource = arg.slice("--file=".length);
          continue;
        }
        if (!endOfOptions && (arg === "--file" || arg === "-F")) {
          const next = context.args[++i];
          if (next === undefined) {
            await writeText(context.stderr, `hostname: option '${arg}' requires an argument\n`);
            return { exitCode: 1 };
          }
          fileSource = next;
          continue;
        }
        if (!endOfOptions && arg.startsWith("--") && arg.length > 2) {
          switch (arg) {
            case "--short":
              mode = "short";
              break;
            case "--fqdn":
            case "--long":
              mode = "fqdn";
              break;
            case "--all-fqdns":
              mode = "all-fqdns";
              break;
            case "--domain":
              mode = "domain";
              break;
            case "--ip-address":
              mode = "ip";
              break;
            case "--all-ip-addresses":
              mode = "all-ips";
              break;
            case "--alias":
              mode = "alias";
              break;
            case "--yp":
            case "--nis":
              mode = "nis";
              break;
            default:
              await writeText(context.stderr, `hostname: unrecognized option '${arg}'\n`);
              return { exitCode: 1 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            switch (ch) {
              case "s":
                mode = "short";
                break;
              case "f":
                mode = "fqdn";
                break;
              case "A":
                mode = "all-fqdns";
                break;
              case "d":
                mode = "domain";
                break;
              case "i":
                mode = "ip";
                break;
              case "I":
                mode = "all-ips";
                break;
              case "a":
                mode = "alias";
                break;
              case "y":
                mode = "nis";
                break;
              case "F": {
                const rest = arg.slice(j + 1);
                if (rest) {
                  fileSource = rest;
                } else {
                  const next = context.args[++i];
                  if (next === undefined) {
                    await writeText(context.stderr, "hostname: option requires an argument -- 'F'\n");
                    return { exitCode: 1 };
                  }
                  fileSource = next;
                }
                j = arg.length;
                break;
              }
              default:
                await writeText(context.stderr, `hostname: invalid option -- '${ch}'\n`);
                return { exitCode: 1 };
            }
          }
          continue;
        }
        operands.push(arg);
      }

      if (operands.length > 1 || (fileSource !== undefined && operands.length > 0)) {
        await writeText(context.stderr, "hostname: too many arguments\n");
        return { exitCode: 1 };
      }

      if (fileSource !== undefined || operands.length === 1) {
        let newHost = operands[0] ?? "";
        if (fileSource !== undefined) {
          try {
            newHost = await readHostnameFile(context, fileSource, limits.maxFileBytes);
          } catch (error) {
            context.signal.throwIfAborted();
            if (!isFsError(error, "ENOENT") && !(error instanceof RangeError)) throw error;
            await writeText(context.stderr, `hostname: cannot open file '${fileSource}'\n`);
            return { exitCode: 1 };
          }
        }
        const isRoot = options.allowSet === true || context.env.EUID === "0" || context.env.UID === "0" || context.env.USER === "root";
        if (!isRoot) {
          await writeText(context.stderr, "hostname: you must be root to change the host name\n");
          return { exitCode: 1 };
        }
        try {
          await context.fs.mkdir("/etc", { recursive: true, signal: context.signal });
          await writeFileOutput(context, new TextEncoder().encode(`${newHost}\n`), data => context.fs.writeFile("/etc/hostname", data, { signal: context.signal }));
        } catch (error) {
          context.signal.throwIfAborted();
          if (!isFsError(error, "EROFS") && !isFsError(error, "EACCES") && !isFsError(error, "EPERM")) throw error;
        }
        sessionHostnames.set(context.fs, newHost);
        return { exitCode: 0 };
      }

      let vfsHost = "";
      try {
        vfsHost = await readHostnameFile(context, "/etc/hostname", limits.maxFileBytes);
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof RangeError) {
          await writeText(context.stderr, "hostname: hostname file exceeds size limit\n");
          return { exitCode: 1 };
        }
        if (!isFsError(error, "ENOENT")) throw error;
      }

      const rawHost = context.env.HOSTNAME || vfsHost || sessionHostnames.get(context.fs) || options.hostname || "sandbox";
      const dotIdx = rawHost.indexOf(".");
      const shortName = dotIdx >= 0 ? rawHost.slice(0, dotIdx) : rawHost;
      const domainName = dotIdx >= 0 ? rawHost.slice(dotIdx + 1) : (options.domain ?? "vfs.local");
      const fqdn = dotIdx >= 0 ? rawHost : `${shortName}.${domainName}`;
      const ip = options.ipAddress ?? "127.0.0.1";

      switch (mode) {
        case "short":
          await writeText(context.stdout, `${shortName}\n`);
          break;
        case "fqdn":
          await writeText(context.stdout, `${fqdn}\n`);
          break;
        case "all-fqdns":
          await writeText(context.stdout, `${fqdn} \n`);
          break;
        case "domain":
          await writeText(context.stdout, `${domainName}\n`);
          break;
        case "ip":
          await writeText(context.stdout, `${ip}\n`);
          break;
        case "all-ips":
          await writeText(context.stdout, `${ip} \n`);
          break;
        case "alias":
          await writeText(context.stdout, `${shortName}\n`);
          break;
        case "nis":
          await writeText(context.stdout, "(none)\n");
          break;
        default:
          await writeText(context.stdout, `${rawHost}\n`);
          break;
      }
      return { exitCode: 0 };
    },
  };
}

export function createHostnameCommands(options: HostnameCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createHostnameCommand(options)]);
}

export function hostnameCommands(options: HostnameCommandsOptions = {}): VirtualShellPlugin {
  const commands = createHostnameCommands(options);
  return {
    name: "hostname-commands",
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
