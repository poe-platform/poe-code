import {
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface IdGroupEntry {
  readonly gid: number;
  readonly name: string;
}

export interface IdUserAccount {
  readonly uid: number;
  readonly euid?: number | undefined;
  readonly gid: number;
  readonly egid?: number | undefined;
  readonly user: string;
  readonly euser?: string | undefined;
  readonly group: string;
  readonly egroup?: string | undefined;
  readonly groups?: readonly IdGroupEntry[] | undefined;
  readonly context?: string | undefined;
}

export interface IdLimits {
  readonly maxArgumentBytes: number;
  readonly maxPasswdBytes: number;
}

export interface IdCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly uid?: number | undefined;
  readonly euid?: number | undefined;
  readonly gid?: number | undefined;
  readonly egid?: number | undefined;
  readonly user?: string | undefined;
  readonly group?: string | undefined;
  readonly groups?: readonly IdGroupEntry[] | undefined;
  readonly context?: string | undefined;
  readonly accounts?: readonly IdUserAccount[] | undefined;
  readonly limits?: Partial<IdLimits> | undefined;
}

export type IdOptions = IdCommandsOptions;

export function settings(options: IdCommandsOptions = {}): IdLimits {
  const limits: IdLimits = {
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

const HELP_TEXT = `Usage: id [OPTION]... [USER]...
Print user and group information for each specified USER,
or (when USER omitted) for the current process in the Sandbox VFS-ish/GNU environment.

  -a             ignore, for compatibility with other versions
  -Z, --context  print only the security context of the process
  -g, --group    print only the effective group ID
  -G, --groups   print all group IDs
  -n, --name     print a name instead of a number, for -ugG
  -r, --real     print the real ID instead of the effective ID, with -ugG
  -u, --user     print only the effective user ID
  -z, --zero     delimit entries with NUL characters, not whitespace;
                   not permitted in default format
      --help     display this help and exit
      --version  output version information and exit

Without any OPTION, print some useful set of identified information (Sandbox VFS-ish/GNU).
`;

const VERSION_TEXT = `id (Sandbox VFS-ish/GNU coreutils) 9.7
Packaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)
`;

function parseNonNegInt(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function loadVfsAccounts(context: CommandContext, maxBytes: number): Promise<IdUserAccount[]> {
  const result: IdUserAccount[] = [];
  let passwdText = "";
  let groupText = "";
  try {
    const bytes = await context.fs.readFile("/etc/passwd", { signal: context.signal });
    if (bytes.byteLength <= maxBytes) {
      passwdText = new TextDecoder().decode(bytes);
    }
  } catch {
    // ignore missing /etc/passwd
  }
  try {
    const bytes = await context.fs.readFile("/etc/group", { signal: context.signal });
    if (bytes.byteLength <= maxBytes) {
      groupText = new TextDecoder().decode(bytes);
    }
  } catch {
    // ignore missing /etc/group
  }
  if (!passwdText) return result;

  const groupByGid = new Map<number, { name: string; members: string[] }>();
  for (const line of groupText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(":");
    if (parts.length < 3) continue;
    const gname = parts[0]!;
    const gid = parseNonNegInt(parts[2]);
    if (gid === undefined) continue;
    const members = (parts[3] ?? "").split(",").map(m => m.trim()).filter(Boolean);
    groupByGid.set(gid, { name: gname, members });
  }

  for (const line of passwdText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(":");
    if (parts.length < 4) continue;
    const user = parts[0]!;
    const uid = parseNonNegInt(parts[2]);
    const gid = parseNonNegInt(parts[3]);
    if (uid === undefined || gid === undefined) continue;
    const primaryGroup = groupByGid.get(gid)?.name ?? user;
    const groups: IdGroupEntry[] = [{ gid, name: primaryGroup }];
    for (const [otherGid, info] of groupByGid.entries()) {
      if (otherGid !== gid && info.members.includes(user)) {
        groups.push({ gid: otherGid, name: info.name });
      }
    }
    result.push({ uid, gid, user, group: primaryGroup, groups });
  }
  return result;
}

function buildBuiltinAccounts(context: CommandContext, options: IdCommandsOptions): { current: IdUserAccount; directory: IdUserAccount[] } {
  const envUid = parseNonNegInt(context.env.UID);
  const envEuid = parseNonNegInt(context.env.EUID);
  const envGid = parseNonNegInt(context.env.GID);
  const envEgid = parseNonNegInt(context.env.EGID);

  const uid = options.uid ?? envUid ?? 1000;
  const euid = options.euid ?? envEuid ?? uid;
  const gid = options.gid ?? envGid ?? (uid === 0 ? 0 : 1000);
  const egid = options.egid ?? envEgid ?? (euid === 0 ? 0 : gid);

  const defaultUser = uid === 0 ? "root" : (options.user ?? context.env.USER ?? context.env.LOGNAME ?? "sandbox");
  const defaultEuser = euid === 0 ? "root" : (euid === uid ? defaultUser : "sandbox");
  const defaultGroup = gid === 0 ? "root" : (options.group ?? context.env.GROUP ?? (defaultUser === "root" ? "root" : "sandbox"));
  const defaultEgroup = egid === 0 ? "root" : (egid === gid ? defaultGroup : "sandbox");

  const secContext = options.context ?? context.env.SELINUX_CONTEXT ?? "sandbox_u:sandbox_r:sandbox_t:s0";
  const groups: readonly IdGroupEntry[] = options.groups ?? [
    { gid: egid, name: defaultEgroup },
    ...(egid !== gid && !options.groups ? [{ gid, name: defaultGroup }] : []),
  ];

  const current: IdUserAccount = {
    uid,
    euid,
    gid,
    egid,
    user: defaultUser,
    euser: defaultEuser,
    group: defaultGroup,
    egroup: defaultEgroup,
    groups,
    context: secContext,
  };

  const directory: IdUserAccount[] = [
    current,
    ...(options.accounts ?? []),
    {
      uid: 1000,
      euid: 1000,
      gid: 1000,
      egid: 1000,
      user: "sandbox",
      euser: "sandbox",
      group: "sandbox",
      egroup: "sandbox",
      groups: [{ gid: 1000, name: "sandbox" }],
      context: secContext,
    },
    {
      uid: 0,
      euid: 0,
      gid: 0,
      egid: 0,
      user: "root",
      euser: "root",
      group: "root",
      egroup: "root",
      groups: [{ gid: 0, name: "root" }],
      context: "system_u:system_r:kernel_t:s0",
    },
    {
      uid: 65534,
      euid: 65534,
      gid: 65534,
      egid: 65534,
      user: "nobody",
      euser: "nobody",
      group: "nogroup",
      egroup: "nogroup",
      groups: [{ gid: 65534, name: "nogroup" }],
      context: secContext,
    },
    {
      uid: 1,
      euid: 1,
      gid: 1,
      egid: 1,
      user: "daemon",
      euser: "daemon",
      group: "daemon",
      egroup: "daemon",
      groups: [{ gid: 1, name: "daemon" }],
      context: secContext,
    },
  ];

  return { current, directory };
}

function formatDefault(account: IdUserAccount): string {
  const euid = account.euid ?? account.uid;
  const egid = account.egid ?? account.gid;
  const euser = account.euser ?? account.user;
  const egroup = account.egroup ?? account.group;
  const parts: string[] = [
    `uid=${account.uid}(${account.user})`,
    `gid=${account.gid}(${account.group})`,
  ];
  if (euid !== account.uid) {
    parts.push(`euid=${euid}(${euser})`);
  }
  if (egid !== account.gid) {
    parts.push(`egid=${egid}(${egroup})`);
  }
  const groups = account.groups && account.groups.length > 0
    ? account.groups
    : [{ gid: egid, name: egroup }];
  parts.push(`groups=${groups.map(g => `${g.gid}(${g.name})`).join(",")}`);
  return parts.join(" ");
}

export function createIdCommand(options: IdCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "id",
    description: "Print user and group identity information (Sandbox VFS-ish/GNU)",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += new TextEncoder().encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "id: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let optUser = false;
      let optGroup = false;
      let optGroups = false;
      let optContext = false;
      let optName = false;
      let optReal = false;
      let optZero = false;
      const operands: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (endOfOptions) {
          operands.push(arg);
          continue;
        }
        if (arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (arg === "--help") {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (arg === "--version") {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (arg.startsWith("--") && arg.length > 2) {
          switch (arg) {
            case "--user":
              optUser = true;
              break;
            case "--group":
              optGroup = true;
              break;
            case "--groups":
              optGroups = true;
              break;
            case "--context":
              optContext = true;
              break;
            case "--name":
              optName = true;
              break;
            case "--real":
              optReal = true;
              break;
            case "--zero":
              optZero = true;
              break;
            default:
              await writeText(context.stderr, `id: unrecognized option '${arg}'\n`);
              return { exitCode: 1 };
          }
          continue;
        }
        if (arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const flag = arg[j]!;
            switch (flag) {
              case "a":
                break;
              case "u":
                optUser = true;
                break;
              case "g":
                optGroup = true;
                break;
              case "G":
                optGroups = true;
                break;
              case "Z":
                optContext = true;
                break;
              case "n":
                optName = true;
                break;
              case "r":
                optReal = true;
                break;
              case "z":
                optZero = true;
                break;
              default:
                await writeText(context.stderr, `id: invalid option -- '${flag}'\n`);
                return { exitCode: 1 };
            }
          }
          continue;
        }
        operands.push(arg);
      }

      const modeCount = Number(optUser) + Number(optGroup) + Number(optGroups) + Number(optContext);
      if (modeCount > 1) {
        await writeText(context.stderr, 'id: cannot print "only" of more than one choice\n');
        return { exitCode: 1 };
      }
      if (modeCount === 0 && (optName || optReal)) {
        await writeText(context.stderr, "id: cannot print only names or real IDs in default format\n");
        return { exitCode: 1 };
      }
      if (optContext && (optName || optReal)) {
        await writeText(context.stderr, "id: cannot print only names or real IDs in default format\n");
        return { exitCode: 1 };
      }
      if (optZero && modeCount === 0) {
        await writeText(context.stderr, "id: option --zero not permitted in default format\n");
        return { exitCode: 1 };
      }
      if (optContext && operands.length > 0) {
        await writeText(context.stderr, "id: cannot print security context when user specified\n");
        return { exitCode: 1 };
      }

      const vfsAccounts = await loadVfsAccounts(context, limits.maxPasswdBytes);
      const { current, directory } = buildBuiltinAccounts(context, options);
      const allAccounts = [...vfsAccounts, ...directory];

      const targets: IdUserAccount[] = [];
      let exitCode = 0;
      if (operands.length === 0) {
        const vfsCurrent = vfsAccounts.find(a => a.uid === current.uid || a.user === current.user);
        targets.push(vfsCurrent ? { ...current, ...vfsCurrent } : current);
      } else {
        for (const spec of operands) {
          const num = parseNonNegInt(spec);
          const found = allAccounts.find(a => a.user === spec || (num !== undefined && a.uid === num));
          if (!found) {
            await writeText(context.stderr, `id: '${spec}': no such user\n`);
            exitCode = 1;
          } else {
            targets.push(found);
          }
        }
      }

      const recordTerm = optZero ? "\0" : "\n";
      const groupSep = optZero ? "\0" : " ";
      let out = "";

      for (const account of targets) {
        if (optContext) {
          out += `${account.context ?? "sandbox_u:sandbox_r:sandbox_t:s0"}${recordTerm}`;
        } else if (optUser) {
          const val = optReal
            ? (optName ? account.user : String(account.uid))
            : (optName ? (account.euser ?? account.user) : String(account.euid ?? account.uid));
          out += `${val}${recordTerm}`;
        } else if (optGroup) {
          const val = optReal
            ? (optName ? account.group : String(account.gid))
            : (optName ? (account.egroup ?? account.group) : String(account.egid ?? account.gid));
          out += `${val}${recordTerm}`;
        } else if (optGroups) {
          const groups = account.groups && account.groups.length > 0
            ? account.groups
            : [{ gid: account.egid ?? account.gid, name: account.egroup ?? account.group }];
          const items = groups.map(g => (optName ? g.name : String(g.gid)));
          out += items.join(groupSep) + recordTerm;
        } else {
          out += `${formatDefault(account)}\n`;
        }
      }

      if (out.length > 0) {
        await writeText(context.stdout, out);
      }
      return { exitCode };
    },
  };
}

export function createIdCommands(options: IdCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createIdCommand(options)]);
}

export function idCommands(options: IdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createIdCommands(options);
  return {
    name: "id-commands",
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
