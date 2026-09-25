import { posixPath } from "../../contracts/path.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { define, output, pathOf, UsageError } from "../internal.js";
import { prepareErgonomicRegex } from "../search/ergonomic-regex.js";
import { yieldTurn } from "../../contracts/yield.js";

export interface FdCommandOptions {
  readonly maxEntries?: number;
  readonly replace?: boolean;
}

function globToRegExp(glob: string, ignoreCase: boolean): RegExp {
  let regex = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        regex += ".*";
        i++;
      } else {
        regex += "[^/]*";
      }
    } else if (ch === "?") {
      regex += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  regex += "$";
  return new RegExp(regex, ignoreCase ? "iu" : "u");
}

function formatPlaceholder(template: string, matchPath: string): string {
  const base = posixPath.basename(matchPath);
  const dir = posixPath.dirname(matchPath);
  const ext = posixPath.extname(base);
  const stemPath = ext ? matchPath.slice(0, -ext.length) : matchPath;
  const stemBase = ext ? base.slice(0, -ext.length) : base;
  return template
    .replaceAll("{/.}", stemBase)
    .replaceAll("{.}", stemPath)
    .replaceAll("{//}", dir)
    .replaceAll("{/}", base)
    .replaceAll("{}", matchPath);
}

export function createFdCommand(options: FdCommandOptions = {}): CommandDefinition {
  const maxEntries = options.maxEntries ?? 100_000;
  return define("fd", async context => {
    let hidden = false;
    let noIgnore = false;
    let caseSensitive: boolean | undefined;
    let globMode = false;
    let fixedStrings = false;
    let fullPath = false;
    let absolutePath = false;
    let print0 = false;
    let quiet = false;
    let maxDepth = Infinity;
    let minDepth = 1;
    let maxResults = Infinity;
    const types = new Set<string>();
    const extensions = new Set<string>();
    const excludes: string[] = [];
    let execMode: "each" | "batch" | undefined;
    let execTemplate: string[] = [];
    const positionals: string[] = [];

    let ended = false;
    for (let i = 0; i < context.args.length; i++) {
      const arg = context.args[i]!;
      if (ended) {
        positionals.push(arg);
        continue;
      }
      if (arg === "--") {
        ended = true;
        continue;
      }
      if (arg === "-x" || arg === "--exec" || arg === "-X" || arg === "--exec-batch") {
        execMode = arg === "-x" || arg === "--exec" ? "each" : "batch";
        execTemplate = [];
        for (i = i + 1; i < context.args.length; i++) {
          if (context.args[i] === ";") break;
          execTemplate.push(context.args[i]!);
        }
        continue;
      }
      if (arg.startsWith("--")) {
        const eq = arg.indexOf("=");
        const flag = eq >= 0 ? arg.slice(0, eq) : arg;
        const inlineVal = eq >= 0 ? arg.slice(eq + 1) : undefined;
        const takeVal = (): string => {
          if (inlineVal !== undefined) return inlineVal;
          const next = context.args[++i];
          if (next === undefined) throw new UsageError(`option '${flag}' requires an argument`);
          return next;
        };
        switch (flag) {
          case "--hidden": hidden = true; break;
          case "--no-ignore": noIgnore = true; break;
          case "--ignore-case": caseSensitive = false; break;
          case "--case-sensitive": caseSensitive = true; break;
          case "--glob": globMode = true; break;
          case "--fixed-strings": fixedStrings = true; break;
          case "--full-path": fullPath = true; break;
          case "--absolute-path": absolutePath = true; break;
          case "--print0": print0 = true; break;
          case "--quiet":
          case "--has-results": quiet = true; break;
          case "--max-depth": maxDepth = Number.parseInt(takeVal(), 10); break;
          case "--min-depth": minDepth = Number.parseInt(takeVal(), 10); break;
          case "--exact-depth": {
            const d = Number.parseInt(takeVal(), 10);
            minDepth = d;
            maxDepth = d;
            break;
          }
          case "--max-results": maxResults = Number.parseInt(takeVal(), 10); break;
          case "--extension": {
            for (const ext of takeVal().split(",")) {
              const cleaned = ext.replace(/^\.+/u, "").toLowerCase();
              if (cleaned) extensions.add(cleaned);
            }
            break;
          }
          case "--type": {
            for (const t of takeVal().split(",")) {
              types.add(t.trim().toLowerCase());
            }
            break;
          }
          case "--exclude": excludes.push(takeVal()); break;
          case "--color":
          case "--path-separator":
            takeVal();
            break;
          default:
            throw new UsageError(`unrecognized option '${flag}'`);
        }
        continue;
      }
      if (arg.startsWith("-") && arg.length > 1) {
        for (let c = 1; c < arg.length; c++) {
          const ch = arg[c]!;
          const rest = arg.slice(c + 1);
          const takeShortVal = (): string => {
            c = arg.length;
            if (rest) return rest;
            const next = context.args[++i];
            if (next === undefined) throw new UsageError(`option '-${ch}' requires an argument`);
            return next;
          };
          if (ch === "H") hidden = true;
          else if (ch === "I") noIgnore = true;
          else if (ch === "i") caseSensitive = false;
          else if (ch === "s") caseSensitive = true;
          else if (ch === "g") globMode = true;
          else if (ch === "F") fixedStrings = true;
          else if (ch === "p") fullPath = true;
          else if (ch === "a") absolutePath = true;
          else if (ch === "0") print0 = true;
          else if (ch === "q") quiet = true;
          else if (ch === "1") maxResults = 1;
          else if (ch === "d") maxDepth = Number.parseInt(takeShortVal(), 10);
          else if (ch === "e") {
            for (const ext of takeShortVal().split(",")) {
              const cleaned = ext.replace(/^\.+/u, "").toLowerCase();
              if (cleaned) extensions.add(cleaned);
            }
          } else if (ch === "t") {
            for (const t of takeShortVal().split(",")) {
              types.add(t.trim().toLowerCase());
            }
          } else if (ch === "E") {
            excludes.push(takeShortVal());
          } else if (ch === "c") {
            takeShortVal();
          } else {
            throw new UsageError(`invalid option -- '${ch}'`);
          }
        }
        continue;
      }
      positionals.push(arg);
    }

    const pattern = positionals[0] ?? "";
    const roots = positionals.length > 1 ? positionals.slice(1) : ["."];
    const effectiveCaseSensitive = caseSensitive ?? /[A-Z]/u.test(pattern);
    const excludeRegexes = excludes.map(ex => globToRegExp(ex, !effectiveCaseSensitive));

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
      const prepared = prepareErgonomicRegex([pattern], {
        kind: "rg",
        fixed: false, whole: false, word: false, nullData: false,
        extended: true,
        caseMode: effectiveCaseSensitive ? "sensitive" : "insensitive",
      });
      if (prepared.mode === "vm") {
        const enc = new TextEncoder();
        matcher = candidate => prepared.vm.matchBytes(enc.encode(candidate), false).length > 0;
      } else {
        const re = new RegExp(prepared.patterns[0] ?? pattern, effectiveCaseSensitive ? "u" : "iu");
        matcher = candidate => re.test(candidate);
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
        if (t === "e" || t === "empty") {
          if (entryType === "file") {
            const st = await context.fs.stat(absPath, { signal: context.signal });
            if (st.size === 0) return true;
          } else if (entryType === "directory") {
            const list = await context.fs.readdir(absPath, { signal: context.signal });
            if (list.length === 0) return true;
          }
        }
        if ((t === "x" || t === "executable") && entryType === "file") {
          const st = await context.fs.stat(absPath, { signal: context.signal });
          if (((st.mode ?? 0) & 0o111) !== 0) return true;
        }
      }
      return false;
    };

    const walk = async (absDir: string, displayPrefix: string, depth: number): Promise<boolean> => {
      if (depth > maxDepth) return false;
      let entries;
      try {
        entries = await context.fs.readdir(absDir, { signal: context.signal });
      } catch {
        return false;
      }
      const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of sorted) {
        if (++visited > maxEntries) break;
        if ((visited & 255) === 0) {
          await yieldTurn();
          context.signal.throwIfAborted();
        }
        if (entry.name === "." || entry.name === "..") continue;
        if (!hidden && entry.name.startsWith(".")) continue;
        if (!noIgnore && (entry.name === ".git" || entry.name === "node_modules")) continue;

        const childAbs = posixPath.join(absDir, entry.name);
        const childDisplay = displayPrefix === "."
          ? entry.name
          : displayPrefix.endsWith("/")
            ? `${displayPrefix}${entry.name}`
            : `${displayPrefix}/${entry.name}`;

        if (excludeRegexes.some(re => re.test(entry.name) || re.test(childDisplay))) {
          continue;
        }

        const entryType = entry.type === "directory" ? "directory" : entry.type === "symlink" ? "symlink" : "file";

        if (depth >= minDepth) {
          let ok = await matchesTypeFilter(childAbs, entryType);
          if (ok && extensions.size > 0) {
            const ext = posixPath.extname(entry.name).replace(/^\.+/u, "").toLowerCase();
            ok = ext.length > 0 && extensions.has(ext);
          }
          if (ok) {
            const subject = fullPath ? childDisplay : entry.name;
            if (matcher(subject)) {
              const outPath = absolutePath ? childAbs : childDisplay;
              matches.push(outPath);
              if (quiet || matches.length >= maxResults) return true;
            }
          }
        }

        if (entryType === "directory" && depth < maxDepth) {
          const stopped = await walk(childAbs, childDisplay, depth + 1);
          if (stopped) return true;
        }
      }
      return false;
    };

    for (const root of roots) {
      const absRoot = pathOf(context, root);
      const stopped = await walk(absRoot, root, 1);
      if (stopped) break;
    }

    if (quiet) {
      return { exitCode: matches.length > 0 ? 0 : 1 };
    }

    if (execMode && execTemplate.length > 0 && context.invoke) {
      let exitCode = 0;
      if (execMode === "each") {
        for (const match of matches) {
          const hasPlaceholder = execTemplate.some(part => /\{\.?\/?\.?\}/u.test(part));
          const expanded = execTemplate.map(part => formatPlaceholder(part, match));
          if (!hasPlaceholder) expanded.push(match);
          const res = await context.invoke(expanded[0]!, expanded.slice(1));
          if (res.exitCode !== 0) exitCode = res.exitCode;
        }
      } else if (matches.length > 0) {
        const expanded: string[] = [];
        let usedPlaceholder = false;
        for (const part of execTemplate) {
          if (part === "{}") {
            expanded.push(...matches);
            usedPlaceholder = true;
          } else if (/\{\.?\/?\.?\}/u.test(part)) {
            for (const m of matches) expanded.push(formatPlaceholder(part, m));
            usedPlaceholder = true;
          } else {
            expanded.push(part);
          }
        }
        if (!usedPlaceholder) expanded.push(...matches);
        const res = await context.invoke(expanded[0]!, expanded.slice(1));
        exitCode = res.exitCode;
      }
      return { exitCode };
    }

    if (matches.length > 0) {
      const sep = print0 ? "\0" : "\n";
      await output(context, matches.join(sep) + sep);
    }
    return { exitCode: 0 };
  });
}

export function fdCommands(options: FdCommandOptions = {}): VirtualShellPlugin {
  const command = createFdCommand(options);
  return {
    name: "fd-commands",
    setup(host) {
      if (!options.replace && host.commands.has(command.name)) {
        throw new Error(`Command already registered: ${command.name}`);
      }
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
