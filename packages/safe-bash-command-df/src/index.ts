import {
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface DfMountEntry {
  readonly source: string;
  readonly fstype: string;
  readonly target: string;
  readonly totalBytes: number;
  readonly usedBytes?: number | undefined;
  readonly totalInodes: number;
  readonly usedInodes?: number | undefined;
  readonly pseudo?: boolean | undefined;
}

export interface DfLimits {
  readonly maxVisitedEntries: number;
  readonly maxArgumentBytes: number;
}

export interface DfCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly mounts?: readonly DfMountEntry[] | undefined;
  readonly totalBytes?: number | undefined;
  readonly totalInodes?: number | undefined;
  readonly limits?: Partial<DfLimits> | undefined;
}

export type DfOptions = DfCommandsOptions;

export function settings(options: DfCommandsOptions = {}): DfLimits {
  const limits: DfLimits = {
    maxVisitedEntries: options.limits?.maxVisitedEntries ?? Infinity,
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: df [OPTION]... [FILE]...
Show information about the file system on which each FILE resides,
or all file systems by default (Sandbox VFS-ish/GNU).

  -a, --all             include pseudo, duplicate, inaccessible file systems
  -B, --block-size=SIZE  scale sizes by SIZE before printing them
  -h, --human-readable  print sizes in powers of 1024 (e.g., 1023M)
  -H, --si              print sizes in powers of 1000 (e.g., 1.1G)
  -i, --inodes          list inode information instead of block usage
  -k                    like --block-size=1K
  -l, --local           limit listing to local file systems
  -m                    like --block-size=1M
      --no-sync         do not invoke sync before getting usage info (default)
      --output[=FIELD_LIST]  use the output format defined by FIELD_LIST
  -P, --portability     use the POSIX output format
      --sync            invoke sync before getting usage info
      --total           elide all entries insignificant to available space,
                          and produce a grand total
  -t, --type=TYPE       limit listing to file systems of type TYPE
  -T, --print-type      print file system type
  -x, --exclude-type=TYPE   limit listing to file systems not of type TYPE
      --help            display this help and exit
      --version         output version information and exit
`;

const VERSION_TEXT = `df (Sandbox VFS-ish/GNU coreutils) 9.7
Packaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)
`;

const VALID_OUTPUT_FIELDS = new Set([
  "source",
  "fstype",
  "itotal",
  "iused",
  "iavail",
  "ipcent",
  "size",
  "used",
  "avail",
  "pcent",
  "file",
  "target",
]);

const DEFAULT_OUTPUT_FIELDS = [
  "source",
  "fstype",
  "itotal",
  "iused",
  "iavail",
  "ipcent",
  "size",
  "used",
  "avail",
  "pcent",
  "file",
  "target",
] as const;

const FIELD_HEADERS: Record<string, string> = {
  source: "Filesystem",
  fstype: "Type",
  itotal: "Inodes",
  iused: "IUsed",
  iavail: "IFree",
  ipcent: "IUse%",
  size: "1K-blocks",
  used: "Used",
  avail: "Avail",
  pcent: "Use%",
  file: "File",
  target: "Mounted on",
};

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

function parseBlockSize(spec: string): { size: number; label: string } | undefined {
  const cleaned = spec.trim().replace(/^'/, "");
  const m = /^(\d+)?([KMGTPEZYRQ]?)(i?B?)?$/i.exec(cleaned);
  if (!m || (!m[1] && !m[2])) return undefined;
  const count = m[1] ? Number(m[1]) : 1;
  if (!Number.isSafeInteger(count) || count < 1) return undefined;
  const unit = (m[2] ?? "").toUpperCase();
  const suffix = (m[3] ?? "").toLowerCase();
  const base = suffix === "b" ? 1000 : 1024;
  const powers: Record<string, number> = {
    "": 0, K: 1, M: 2, G: 3, T: 4, P: 5, E: 6,
  };
  const exp = powers[unit];
  if (exp === undefined) return undefined;
  const size = count * Math.pow(base, exp);
  if (!Number.isSafeInteger(size) || size < 1) return undefined;
  const label = unit ? `${count}${unit}${suffix === "b" ? "B" : ""}-blocks` : `${size}-blocks`;
  return { size, label };
}

function formatHuman(bytes: number, base: 1000 | 1024): string {
  if (bytes <= 0) return "0";
  const units = base === 1024 ? ["B", "K", "M", "G", "T", "P"] : ["B", "k", "M", "G", "T", "P"];
  let val = bytes;
  let u = 0;
  while (val >= base && u < units.length - 1) {
    val /= base;
    u++;
  }
  if (u === 0) return `${Math.ceil(val)}`;
  return val < 10 ? `${val.toFixed(1)}${units[u]}` : `${Math.ceil(val)}${units[u]}`;
}

async function computeVfsUsage(
  context: CommandContext,
  rootPath: string,
  maxEntries: number
): Promise<{ usedBytes: number; usedInodes: number }> {
  let usedBytes = 4096;
  let usedInodes = 1;
  let visited = 0;
  const queue: string[] = [rootPath];
  while (queue.length > 0 && visited < maxEntries) {
    const current = queue.shift()!;
    visited++;
    try {
      const entries = await context.fs.readdir(current, { signal: context.signal });
      for (const entry of entries) {
        if (visited >= maxEntries) break;
        visited++;
        usedInodes++;
        const child = current === "/" ? `/${entry.name}` : `${current}/${entry.name}`;
        if (entry.type === "directory") {
          usedBytes += 4096;
          queue.push(child);
        } else {
          try {
            const st = await context.fs.lstat(child, { signal: context.signal });
            usedBytes += Math.max(0, Number(st.size ?? 0));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return { usedBytes, usedInodes };
}

export function createDfCommand(options: DfCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const sharedEncoder = new TextEncoder();

  return {
    name: "df",
    description: "Report file system disk space usage in the Sandbox VFS",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += sharedEncoder.encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "df: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let showAll = false;
      let scaleMode: "blocks" | "human-1024" | "human-1000" = "blocks";
      let blockSize = context.env.POSIXLY_CORRECT !== undefined ? 512 : 1024;
      let blockHeader = context.env.POSIXLY_CORRECT !== undefined ? "512-blocks" : "1K-blocks";
      let showInodes = false;
      let portability = false;
      let printType = false;
      let showTotal = false;
      let outputFields: string[] | undefined;
      const includeTypes = new Set<string>();
      const excludeTypes = new Set<string>();
      const operands: string[] = [];
      let endOfOptions = false;

      const envBlock = context.env.DF_BLOCK_SIZE ?? context.env.BLOCK_SIZE ?? context.env.BLOCKSIZE;
      if (envBlock) {
        const parsed = parseBlockSize(envBlock);
        if (parsed) {
          blockSize = parsed.size;
          blockHeader = parsed.label;
        }
      }

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
          if (arg === "--all") showAll = true;
          else if (arg === "--human-readable") scaleMode = "human-1024";
          else if (arg === "--si") scaleMode = "human-1000";
          else if (arg === "--inodes") showInodes = true;
          else if (arg === "--local" || arg === "--sync" || arg === "--no-sync") {
            // accepted
          } else if (arg === "--portability") {
            portability = true;
            if (scaleMode === "blocks" && blockSize === 1024 && context.env.POSIXLY_CORRECT === undefined) {
              blockHeader = "1024-blocks";
            }
          } else if (arg === "--print-type") printType = true;
          else if (arg === "--total") showTotal = true;
          else if (arg === "--output" || arg.startsWith("--output=")) {
            if (arg === "--output") {
              outputFields = [...DEFAULT_OUTPUT_FIELDS];
            } else {
              const list = arg.slice("--output=".length).split(",").filter(Boolean);
              if (list.length === 0) {
                await writeText(context.stderr, "df: option '--output' requires a non-empty field list\n");
                return { exitCode: 1 };
              }
              for (const f of list) {
                if (!VALID_OUTPUT_FIELDS.has(f)) {
                  await writeText(context.stderr, `df: '${f}': Crit: invalid field name for --output\n`);
                  return { exitCode: 1 };
                }
              }
              outputFields = list;
            }
          } else if (arg === "--block-size" || arg.startsWith("--block-size=")) {
            const val = arg === "--block-size" ? context.args[++i] : arg.slice("--block-size=".length);
            const parsed = val ? parseBlockSize(val) : undefined;
            if (!parsed) {
              await writeText(context.stderr, `df: invalid --block-size argument '${val ?? ""}'\n`);
              return { exitCode: 1 };
            }
            scaleMode = "blocks";
            blockSize = parsed.size;
            blockHeader = parsed.label;
          } else if (arg === "--type" || arg.startsWith("--type=")) {
            const val = arg === "--type" ? context.args[++i] : arg.slice("--type=".length);
            if (!val) {
              await writeText(context.stderr, "df: option '--type' requires an argument\n");
              return { exitCode: 1 };
            }
            includeTypes.add(val);
          } else if (arg === "--exclude-type" || arg.startsWith("--exclude-type=")) {
            const val = arg === "--exclude-type" ? context.args[++i] : arg.slice("--exclude-type=".length);
            if (!val) {
              await writeText(context.stderr, "df: option '--exclude-type' requires an argument\n");
              return { exitCode: 1 };
            }
            excludeTypes.add(val);
          } else {
            await writeText(context.stderr, `df: unrecognized option '${arg}'\n`);
            return { exitCode: 1 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            switch (ch) {
              case "a":
                showAll = true;
                break;
              case "h":
                scaleMode = "human-1024";
                break;
              case "H":
                scaleMode = "human-1000";
                break;
              case "i":
                showInodes = true;
                break;
              case "k":
                scaleMode = "blocks";
                blockSize = 1024;
                blockHeader = portability ? "1024-blocks" : "1K-blocks";
                break;
              case "m":
                scaleMode = "blocks";
                blockSize = 1024 * 1024;
                blockHeader = "1M-blocks";
                break;
              case "l":
                break;
              case "P":
                portability = true;
                if (blockSize === 1024 && context.env.POSIXLY_CORRECT === undefined) {
                  blockHeader = "1024-blocks";
                }
                break;
              case "T":
                printType = true;
                break;
              case "B": {
                const rest = arg.slice(j + 1);
                const val = rest || context.args[++i];
                const parsed = val ? parseBlockSize(val) : undefined;
                if (!parsed) {
                  await writeText(context.stderr, `df: invalid -B argument '${val ?? ""}'\n`);
                  return { exitCode: 1 };
                }
                scaleMode = "blocks";
                blockSize = parsed.size;
                blockHeader = parsed.label;
                j = arg.length;
                break;
              }
              case "t": {
                const rest = arg.slice(j + 1);
                const val = rest || context.args[++i];
                if (!val) {
                  await writeText(context.stderr, "df: option requires an argument -- 't'\n");
                  return { exitCode: 1 };
                }
                includeTypes.add(val);
                j = arg.length;
                break;
              }
              case "x": {
                const rest = arg.slice(j + 1);
                const val = rest || context.args[++i];
                if (!val) {
                  await writeText(context.stderr, "df: option requires an argument -- 'x'\n");
                  return { exitCode: 1 };
                }
                excludeTypes.add(val);
                j = arg.length;
                break;
              }
              default:
                await writeText(context.stderr, `df: invalid option -- '${ch}'\n`);
                return { exitCode: 1 };
            }
          }
          continue;
        }
        operands.push(arg);
      }

      if (outputFields && (showInodes || printType || portability)) {
        await writeText(context.stderr, "df: options -i, -T, and -P are mutually exclusive with --output\n");
        return { exitCode: 1 };
      }

      for (const t of includeTypes) {
        if (excludeTypes.has(t)) {
          await writeText(context.stderr, `df: file system type '${t}' both selected and excluded\n`);
          return { exitCode: 1 };
        }
      }

      const usage = await computeVfsUsage(context, "/", limits.maxVisitedEntries);
      const rootTotalBytes = options.totalBytes ?? 1024 * 1024 * 1024; // 1 GiB
      const rootTotalInodes = options.totalInodes ?? 1048576;

      const defaultMounts: DfMountEntry[] = [
        {
          source: "sandbox-vfs",
          fstype: "vfs",
          target: "/",
          totalBytes: rootTotalBytes,
          usedBytes: Math.min(rootTotalBytes, usage.usedBytes),
          totalInodes: rootTotalInodes,
          usedInodes: Math.min(rootTotalInodes, usage.usedInodes),
        },
        {
          source: "tmpfs",
          fstype: "tmpfs",
          target: "/tmp",
          totalBytes: 256 * 1024 * 1024,
          usedBytes: 4096,
          totalInodes: 262144,
          usedInodes: 1,
        },
        {
          source: "proc",
          fstype: "proc",
          target: "/proc",
          totalBytes: 0,
          usedBytes: 0,
          totalInodes: 0,
          usedInodes: 0,
          pseudo: true,
        },
      ];

      const mountTable = options.mounts ?? defaultMounts;
      let exitCode = 0;

      interface SelectedRow {
        mount: DfMountEntry;
        fileOperand: string;
      }

      const selected: SelectedRow[] = [];

      if (operands.length > 0) {
        for (const op of operands) {
          const resolved = resolveVfsPath(context.cwd, op);
          const isMountTarget = mountTable.some((m) => m.target === resolved);
          if (!isMountTarget) {
            try {
              await context.fs.lstat(resolved, { signal: context.signal });
            } catch {
              await writeText(context.stderr, `df: '${op}': No such file or directory\n`);
              exitCode = 1;
              continue;
            }
          }
          // Find deepest matching mount
          let best = mountTable[0]!;
          for (const m of mountTable) {
            if (resolved === m.target || (m.target !== "/" && resolved.startsWith(m.target + "/"))) {
              if (m.target.length >= best.target.length) {
                best = m;
              }
            }
          }
          selected.push({ mount: best, fileOperand: op });
        }
      } else {
        for (const m of mountTable) {
          if (!showAll && m.pseudo) continue;
          selected.push({ mount: m, fileOperand: m.target });
        }
      }

      const filtered = selected.filter(({ mount }) => {
        if (includeTypes.size > 0 && !includeTypes.has(mount.fstype)) return false;
        if (excludeTypes.has(mount.fstype)) return false;
        return true;
      });

      if (filtered.length === 0) {
        if (exitCode === 0) {
          await writeText(context.stderr, "df: no file systems processed\n");
          exitCode = 1;
        }
        return { exitCode };
      }

      const formatSize = (bytes: number): string => {
        if (scaleMode === "human-1024") return formatHuman(bytes, 1024);
        if (scaleMode === "human-1000") return formatHuman(bytes, 1000);
        return String(Math.ceil(bytes / blockSize));
      };

      const formatPct = (used: number, total: number): string => {
        if (total <= 0) return "-";
        const pct = Math.min(100, Math.max(used > 0 ? 1 : 0, Math.ceil((used / total) * 100)));
        return `${pct}%`;
      };

      let activeFields: string[];
      if (outputFields) {
        activeFields = outputFields;
      } else if (showInodes) {
        activeFields = printType
          ? ["source", "fstype", "itotal", "iused", "iavail", "ipcent", "target"]
          : ["source", "itotal", "iused", "iavail", "ipcent", "target"];
      } else {
        activeFields = printType
          ? ["source", "fstype", "size", "used", "avail", "pcent", "target"]
          : ["source", "size", "used", "avail", "pcent", "target"];
      }

      const headerRow = activeFields.map(f => {
        if (f === "size") {
          if (scaleMode === "human-1024" || scaleMode === "human-1000") return "Size";
          return blockHeader;
        }
        if (f === "avail" && portability && !outputFields) return "Available";
        if (f === "pcent" && portability && !outputFields) return "Capacity";
        return FIELD_HEADERS[f] ?? f;
      });

      const dataRows: string[][] = [];
      let sumTotalBytes = 0;
      let sumUsedBytes = 0;
      let sumAvailBytes = 0;
      let sumTotalInodes = 0;
      let sumUsedInodes = 0;
      let sumAvailInodes = 0;

      for (const { mount, fileOperand } of filtered) {
        const usedB = mount.usedBytes ?? 0;
        const availB = Math.max(0, mount.totalBytes - usedB);
        const usedI = mount.usedInodes ?? 0;
        const availI = Math.max(0, mount.totalInodes - usedI);

        sumTotalBytes += mount.totalBytes;
        sumUsedBytes += usedB;
        sumAvailBytes += availB;
        sumTotalInodes += mount.totalInodes;
        sumUsedInodes += usedI;
        sumAvailInodes += availI;

        const row = activeFields.map(f => {
          switch (f) {
            case "source":
              return mount.source;
            case "fstype":
              return mount.fstype;
            case "itotal":
              return scaleMode === "blocks" ? String(mount.totalInodes) : formatSize(mount.totalInodes);
            case "iused":
              return scaleMode === "blocks" ? String(usedI) : formatSize(usedI);
            case "iavail":
              return scaleMode === "blocks" ? String(availI) : formatSize(availI);
            case "ipcent":
              return formatPct(usedI, mount.totalInodes);
            case "size":
              return formatSize(mount.totalBytes);
            case "used":
              return formatSize(usedB);
            case "avail":
              return formatSize(availB);
            case "pcent":
              return formatPct(usedB, mount.totalBytes);
            case "file":
              return fileOperand;
            case "target":
              return mount.target;
            default:
              return "";
          }
        });
        dataRows.push(row);
      }

      if (showTotal) {
        const totalRow = activeFields.map(f => {
          switch (f) {
            case "source":
              return "total";
            case "fstype":
              return "-";
            case "itotal":
              return scaleMode === "blocks" ? String(sumTotalInodes) : formatSize(sumTotalInodes);
            case "iused":
              return scaleMode === "blocks" ? String(sumUsedInodes) : formatSize(sumUsedInodes);
            case "iavail":
              return scaleMode === "blocks" ? String(sumAvailInodes) : formatSize(sumAvailInodes);
            case "ipcent":
              return formatPct(sumUsedInodes, sumTotalInodes);
            case "size":
              return formatSize(sumTotalBytes);
            case "used":
              return formatSize(sumUsedBytes);
            case "avail":
              return formatSize(sumAvailBytes);
            case "pcent":
              return formatPct(sumUsedBytes, sumTotalBytes);
            case "file":
            case "target":
              return "-";
            default:
              return "-";
          }
        });
        dataRows.push(totalRow);
      }

      const widths = headerRow.map((h, col) => {
        let max = Math.max(h.length, col === 0 ? 14 : 5);
        for (const r of dataRows) {
          max = Math.max(max, r[col]!.length);
        }
        return max;
      });

      const rightAligned = new Set(["itotal", "iused", "iavail", "ipcent", "size", "used", "avail", "pcent"]);
      const formatTableRow = (cells: string[]): string => {
        return cells
          .map((cell, idx) => {
            if (idx === cells.length - 1) return cell;
            const field = activeFields[idx]!;
            const w = widths[idx]!;
            return rightAligned.has(field) ? cell.padStart(w, " ") : cell.padEnd(w, " ");
          })
          .join(" ");
      };

      const lines = [formatTableRow(headerRow), ...dataRows.map(formatTableRow)];
      await writeText(context.stdout, `${lines.join("\n")}\n`);
      return { exitCode };
    },
  };
}

export function createDfCommands(options: DfCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createDfCommand(options)]);
}

export function dfCommands(options: DfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDfCommands(options);
  return {
    name: "df-commands",
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
