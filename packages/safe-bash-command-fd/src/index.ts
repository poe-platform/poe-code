
const pathPosix = {
  resolve(cwd: string, target: string): string {
    const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : cwd + "/" + target);
    const parts = raw.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return "/" + stack.join("/");
  },
  join(a: string, b: string): string {
    if (!a || a === ".") return b;
    return a.endsWith("/") ? a + b : a + "/" + b;
  },
  dirname(p: string): string {
    const idx = p.lastIndexOf("/");
    if (idx < 0) return ".";
    if (idx === 0) return "/";
    return p.slice(0, idx);
  },
  basename(p: string): string {
    const idx = p.lastIndexOf("/");
    return idx < 0 ? p : p.slice(idx + 1);
  },
};

import {
  commandRuntimeIdentity,
  toByteSource,
  getCommandArguments,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandHandler,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface FdLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
}

export interface FdCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<FdLimits>;
  readonly execute?: CommandHandler;
  readonly maxDepth?: number;
  readonly maxEntries?: number;
}

export type FdOptions = FdCommandsOptions;

export function settings(options: FdCommandsOptions = {}): FdLimits {
  const limits: FdLimits = {
    maxDepth: options.limits?.maxDepth ?? options.maxDepth ?? 256,
    maxEntries: options.limits?.maxEntries ?? options.maxEntries ?? 100_000,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid fd limit: ${name}`);
  }
  return Object.freeze(limits);
}

function globToRegExp(glob: string, caseInsensitive: boolean): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close > i) {
        out += glob.slice(i, close + 1);
        i = close;
      } else {
        out += "\\[";
      }
    } else if (".+^$${}()|\\".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out, caseInsensitive ? "iu" : "u");
}

function expandExecPlaceholder(template: string, filePath: string): string {
  if (!template.includes("{")) return template;
  const parsedDir = pathPosix.dirname(filePath);
  const parsedBase = pathPosix.basename(filePath);
  const extIdx = parsedBase.lastIndexOf(".");
  const parsedNoExt = extIdx > 0 ? pathPosix.join(parsedDir, parsedBase.slice(0, extIdx)) : filePath;
  const parsedBaseNoExt = extIdx > 0 ? parsedBase.slice(0, extIdx) : parsedBase;

  return template
    .replaceAll("{/.}", parsedBaseNoExt)
    .replaceAll("{.}", parsedNoExt)
    .replaceAll("{/}", parsedBase)
    .replaceAll("{//}", parsedDir)
    .replaceAll("{}", filePath);
}

export function createFdCommand(options: FdCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "fd",
    description: "Fast and ergonomic file search utility",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      const maxDepthDefault = limits.maxDepth;
      const maxEntries = limits.maxEntries;
      const args = context.args;

      let hidden = false;
      let caseSensitive: boolean | undefined;
      let globMode = false;
      let fixedStrings = false;
      let fullPath = false;
      let absolutePath = false;
      let print0 = false;
      let maxDepth = maxDepthDefault;
      let maxResults: number | undefined;
      const extensions = new Set<string>();
      const types = new Set<string>();
      const excludes: RegExp[] = [];
      let execTemplate: string[] | undefined;
      let execBatch = false;
      const positionals: string[] = [];

      let endOfOptions = false;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && (arg === "--help" || arg === "-h")) {
          await writeText(context.stdout, "Usage: fd [OPTIONS] [PATTERN] [PATH...]\n");
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--version" || arg === "-V")) {
          await writeText(context.stdout, "fd (virtual-bash)\n");
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "-x" || arg === "--exec" || arg === "-X" || arg === "--exec-batch")) {
          execBatch = arg === "-X" || arg === "--exec-batch";
          const cmdTokens: string[] = [];
          for (i = i + 1; i < args.length; i++) {
            if (args[i] === ";") break;
            cmdTokens.push(args[i]!);
          }
          execTemplate = cmdTokens;
          continue;
        }
        if (!endOfOptions && arg.startsWith("--")) {
          if (arg === "--hidden") hidden = true;
          else if (arg === "--ignore-case") caseSensitive = false;
          else if (arg === "--case-sensitive") caseSensitive = true;
          else if (arg === "--glob") globMode = true;
          else if (arg === "--fixed-strings") fixedStrings = true;
          else if (arg === "--full-path") fullPath = true;
          else if (arg === "--absolute-path") absolutePath = true;
          else if (arg === "--print0") print0 = true;
          else if (arg === "--no-ignore" || arg === "--follow") {
            // Accepted for compatibility
          } else if (arg.startsWith("--max-depth=")) {
            maxDepth = Number.parseInt(arg.slice("--max-depth=".length), 10);
          } else if (arg === "--max-depth" || arg === "--maxdepth") {
            maxDepth = Number.parseInt(args[++i] ?? "", 10);
          } else if (arg.startsWith("--max-results=")) {
            maxResults = Number.parseInt(arg.slice("--max-results=".length), 10);
          } else if (arg === "--max-results") {
            maxResults = Number.parseInt(args[++i] ?? "", 10);
          } else if (arg === "-1") {
            maxResults = 1;
          } else if (arg.startsWith("--extension=")) {
            extensions.add(arg.slice("--extension=".length).replace(/^\./, "").toLowerCase());
          } else if (arg === "--extension") {
            extensions.add((args[++i] ?? "").replace(/^\./, "").toLowerCase());
          } else if (arg.startsWith("--type=")) {
            types.add(arg.slice("--type=".length));
          } else if (arg === "--type") {
            types.add(args[++i] ?? "");
          } else if (arg.startsWith("--exclude=")) {
            excludes.push(globToRegExp(arg.slice("--exclude=".length), false));
          } else if (arg === "--exclude") {
            excludes.push(globToRegExp(args[++i] ?? "", false));
          } else {
            await writeText(context.stderr, `fd: unrecognized option '${arg}'\n`);
            return { exitCode: 2 };
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            if (ch === "H") hidden = true;
            else if (ch === "I" || ch === "u" || ch === "L") {
              // Accepted for compatibility
            } else if (ch === "i") caseSensitive = false;
            else if (ch === "s") caseSensitive = true;
            else if (ch === "g") globMode = true;
            else if (ch === "F") fixedStrings = true;
            else if (ch === "p") fullPath = true;
            else if (ch === "a") absolutePath = true;
            else if (ch === "0") print0 = true;
            else if (ch === "1") maxResults = 1;
            else if (ch === "e") {
              const val = j < arg.length - 1 ? arg.slice(j + 1) : (args[++i] ?? "");
              extensions.add(val.replace(/^\./, "").toLowerCase());
              break;
            } else if (ch === "t") {
              const val = j < arg.length - 1 ? arg.slice(j + 1) : (args[++i] ?? "");
              for (const part of val.split(",")) {
                if (part) types.add(part);
              }
              break;
            } else if (ch === "d") {
              const val = j < arg.length - 1 ? arg.slice(j + 1) : (args[++i] ?? "");
              maxDepth = Number.parseInt(val, 10);
              break;
            } else if (ch === "E") {
              const val = j < arg.length - 1 ? arg.slice(j + 1) : (args[++i] ?? "");
              excludes.push(globToRegExp(val, false));
              break;
            } else {
              await writeText(context.stderr, `fd: invalid option -- '${ch}'\n`);
              return { exitCode: 2 };
            }
          }
          continue;
        }
        positionals.push(arg);
      }

      if (Number.isNaN(maxDepth) || maxDepth < 0) {
        await writeText(context.stderr, "fd: invalid max-depth value\n");
        return { exitCode: 2 };
      }

      const pattern = positionals[0] ?? "";
      const rawPaths = positionals.length > 1 ? positionals.slice(1) : ["."];

      const effectiveCaseSensitive =
        caseSensitive !== undefined ? caseSensitive : /[A-Z]/.test(pattern);

      let matcher: (candidate: string) => boolean;
      if (!pattern) {
        matcher = () => true;
      } else if (fixedStrings) {
        const needle = effectiveCaseSensitive ? pattern : pattern.toLowerCase();
        matcher = candidate => (effectiveCaseSensitive ? candidate : candidate.toLowerCase()).includes(needle);
      } else if (globMode) {
        const re = globToRegExp(pattern, !effectiveCaseSensitive);
        matcher = candidate => re.test(candidate);
      } else {
        try {
          const re = new RegExp(pattern, effectiveCaseSensitive ? "u" : "iu");
          matcher = candidate => re.test(candidate);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await writeText(context.stderr, `fd: invalid regex: ${msg}\n`);
          return { exitCode: 2 };
        }
      }

      const matches: string[] = [];
      let visited = 0;

      const matchesTypeFilter = async (absPath: string, entryType: "file" | "directory" | "symlink"): Promise<boolean> => {
        if (types.size === 0) return true;
        for (const t of types) {
          if ((t === "f" || t === "file") && entryType === "file") return true;
          if ((t === "d" || t === "dir" || t === "directory") && entryType === "directory") return true;
          if ((t === "l" || t === "symlink") && entryType === "symlink") return true;
          if ((t === "e" || t === "empty") && (entryType === "file" || entryType === "directory")) {
            try {
              if (entryType === "file") {
                const st = await context.fs.stat(absPath);
                if (st.size === 0) return true;
              } else {
                const children = await context.fs.readdir(absPath);
                if (children.length === 0) return true;
              }
            } catch {
              // Ignore
            }
          }
          if ((t === "x" || t === "executable") && entryType === "file") {
            try {
              const st = await context.fs.stat(absPath);
              if (((st.mode ?? 0) & 0o111) !== 0) return true;
            } catch {
              // Ignore
            }
          }
        }
        return false;
      };

      const walk = async (absDir: string, displayBase: string, depth: number): Promise<void> => {
        if (depth > maxDepth) return;
        if (maxResults !== undefined && matches.length >= maxResults) return;

        let entries: Array<{ name: string; type?: "file" | "directory" | "symlink" }>;
        try {
          const raw = await context.fs.readdir(absDir, { withFileTypes: true } as never);
          entries = raw.map((item: unknown) => {
            if (typeof item === "string") return { name: item };
            const obj = item as { name: string; isDirectory?: () => boolean; isSymbolicLink?: () => boolean; type?: "file" | "directory" | "symlink" };
            let entryType: "file" | "directory" | "symlink" | undefined = obj.type;
            if (!entryType && typeof obj.isSymbolicLink === "function" && obj.isSymbolicLink()) entryType = "symlink";
            else if (!entryType && typeof obj.isDirectory === "function" && obj.isDirectory()) entryType = "directory";
            else if (!entryType) entryType = "file";
            return { name: obj.name, type: entryType };
          });
        } catch {
          return;
        }

        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        for (const entry of entries) {
          context.signal.throwIfAborted();
          if (maxResults !== undefined && matches.length >= maxResults) return;
          visited++;
          if (visited > maxEntries) {
            throw new Error(`search exceeded maximum entry limit (${maxEntries})`);
          }

          const name = entry.name;
          if (!hidden && name.startsWith(".")) continue;

          const childAbs = pathPosix.join(absDir, name);
          const childDisplay =
            displayBase === "."
              ? name
              : displayBase.endsWith("/")
                ? displayBase + name
                : displayBase + "/" + name;

          if (excludes.some(re => re.test(name) || re.test(childDisplay))) {
            continue;
          }

          let entryType = entry.type;
          if (!entryType) {
            try {
              const st = await context.fs.lstat(childAbs);
              entryType = st.type === "symlink" ? "symlink" : st.type === "directory" ? "directory" : "file";
            } catch {
              entryType = "file";
            }
          }

          const candidate = fullPath ? childDisplay : name;
          let matched = matcher(candidate);
          if (matched && extensions.size > 0) {
            const dot = name.lastIndexOf(".");
            const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
            matched = extensions.has(ext);
          }
          if (matched) {
            matched = await matchesTypeFilter(childAbs, entryType);
          }

          if (matched) {
            matches.push(absolutePath ? childAbs : childDisplay);
          }

          if (entryType === "directory" && depth < maxDepth) {
            await walk(childAbs, childDisplay, depth + 1);
          }
        }
      };

      try {
        for (const rawPath of rawPaths) {
          const absRoot = pathPosix.resolve(context.cwd, rawPath);
          const displayRoot = absolutePath ? absRoot : rawPath;
          await walk(absRoot, displayRoot, 1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await writeText(context.stderr, `fd: ${msg}\n`);
        return { exitCode: 1 };
      }

      if (execTemplate && execTemplate.length > 0) {
        const invokeSubcommand = async (cmdArgs: string[]): Promise<number> => {
          const [cmdName, ...restArgs] = cmdArgs;
          if (!cmdName) return 0;
          const ctxWithInvoke = context as CommandContext & {
            invoke?: (name: string, argv: readonly string[], opts?: unknown) => Promise<{ exitCode: number }>;
          };
          if (typeof ctxWithInvoke.invoke === "function") {
            const res = await ctxWithInvoke.invoke(cmdName, restArgs, {
              cwd: context.cwd,
              env: context.env,
              stdin: toByteSource(""),
              stdout: context.stdout,
              stderr: context.stderr,
            });
            return res.exitCode;
          }
          if (options.execute) {
            const res = await options.execute({
              ...context,
              args: restArgs,
              stdin: toByteSource(""),
            });
            return res.exitCode;
          }
          await writeText(context.stderr, `fd: cannot execute '${cmdName}'\n`);
          return 1;
        };

        let exitCode = 0;
        if (execBatch) {
          if (matches.length > 0) {
            const hasPlaceholder = execTemplate.some(t => t.includes("{"));
            const expanded: string[] = [];
            if (hasPlaceholder) {
              for (const t of execTemplate) {
                if (t === "{}") {
                  expanded.push(...matches);
                } else {
                  expanded.push(expandExecPlaceholder(t, matches[0]!));
                }
              }
            } else {
              expanded.push(...execTemplate, ...matches);
            }
            const code = await invokeSubcommand(expanded);
            if (code !== 0) exitCode = code;
          }
        } else {
          for (const m of matches) {
            const hasPlaceholder = execTemplate.some(t => t.includes("{"));
            const expanded = hasPlaceholder
              ? execTemplate.map(t => expandExecPlaceholder(t, m))
              : [...execTemplate, m];
            const code = await invokeSubcommand(expanded);
            if (code !== 0) exitCode = code;
          }
        }
        return { exitCode };
      }

      if (matches.length > 0) {
        const sep = print0 ? "\0" : "\n";
        await writeText(context.stdout, matches.join(sep) + sep);
      }
      return { exitCode: 0 };
    },
  };
}

export function createFdCommands(options: FdCommandsOptions = {}): readonly CommandDefinition[] {
  return [createFdCommand(options)];
}

export function fdCommands(options: FdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createFdCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "fd-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
