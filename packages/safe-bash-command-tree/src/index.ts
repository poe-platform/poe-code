import { registerDefaultExecutor, registerDefaultExecutors } from "safe-bash-io-engine/internal";
import { compareVersions } from "./sort.js";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createTreeCommand } from "./tree.js";
import type { TreeCommandsOptions } from "./options.js";
export { createTreeCommand } from "./tree.js";
export type { TreeCommandsOptions, TreeLimits } from "./options.js";

export function createTreeCommands(options: TreeCommandsOptions = {}): readonly CommandDefinition[] {
  return [registerDefaultExecutor(createTreeCommand(options), options)];
}

export function treeCommands(options: TreeCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTreeCommands(options);
  const replace = options.replace ?? false;
  return { name: "tree-commands", setup(host) {
    if (!replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace });
  } };
}

export interface SyncTreeVfsNode {
  readonly type: "file" | "directory" | "symlink";
  readonly size: number;
  readonly target?: string;
  readonly children?: ReadonlyArray<{ readonly name: string; readonly type: "file" | "directory" | "symlink"; readonly size: number; readonly target?: string }>;
}

function resolveSyncTreePath(cwd: string, target: string): string {
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

export function evalSyncTree(
  args: readonly string[],
  cwd: string,
  inspectNode: (absPath: string) => SyncTreeVfsNode | undefined,
): string | undefined {
  let showAll = false;
  let dirsOnly = false;
  let dirsFirst = false;
  let classify = false;
  let fullPath = false;
  let noIndent = false;
  let noReport = false;
  let reverseSort = false;
  let sortMode: "name" | "version" | "none" = "name";
  let jsonOut = false;
  let fileLimit = 0;
  let ascii = false;
  let maxLevel = Infinity;
  const includePatterns: RegExp[] = [];
  const excludePatterns: RegExp[] = [];
  const operands: string[] = [];
  let endOpts = false;

  const compileTreeGlob = (pat: string): RegExp | undefined => {
    const alts = pat.split("|");
    const rxParts: string[] = [];
    for (const alt of alts) {
      let rx = "^";
      for (let k = 0; k < alt.length; k++) {
        const ch = alt[k]!;
        if (ch === "*") rx += ".*";
        else if (ch === "?") rx += ".";
        else if (".^$+()[]{}|\\".includes(ch)) rx += "\\" + ch;
        else rx += ch;
      }
      rx += "$";
      rxParts.push(rx);
    }
    try { return new RegExp(rxParts.join("|")); } catch { return undefined; }
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!endOpts && a === "--") { endOpts = true; continue; }
    if (!endOpts && a.startsWith("--") && a.length > 2) {
      if (a === "--noreport") noReport = true;
      else if (a === "--dirsfirst") dirsFirst = true;
      else if (a === "--sort=name" || a === "--sort=version" || a === "--sort=none") sortMode = a.slice(7) as "name" | "version" | "none";
      else if (a === "--sort" && i + 1 < args.length && (args[i + 1] === "name" || args[i + 1] === "version" || args[i + 1] === "none")) { sortMode = args[++i] as "name" | "version" | "none"; }
      else if (a.startsWith("--filelimit=")) {
        const v = a.slice(12);
        if (!/^\d+$/.test(v)) return undefined;
        fileLimit = Number(v);
      } else if (a === "--filelimit" && i + 1 < args.length && /^\d+$/.test(args[i + 1]!)) {
        fileLimit = Number(args[++i]!);
      } else if (a === "--charset=ascii" || a === "--charset=ASCII" || a === "--charset=US-ASCII" || a === "--charset=ANSI") ascii = true;
      else if (a === "--charset=UTF-8" || a === "--charset=UTF8") ascii = false;
      else if (a === "--charset" && i + 1 < args.length) {
        const cs = args[++i]!;
        if (cs === "ascii" || cs === "ASCII" || cs === "US-ASCII" || cs === "ANSI") ascii = true;
        else if (cs === "UTF-8" || cs === "UTF8") ascii = false;
        else return undefined;
      }
      else return undefined;
      continue;
    }
    if (!endOpts && a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "a") showAll = true;
        else if (ch === "d") dirsOnly = true;
        else if (ch === "f") fullPath = true;
        else if (ch === "F") classify = true;
        else if (ch === "i") noIndent = true;
        else if (ch === "J") jsonOut = true;
        else if (ch === "r") reverseSort = true;
        else if (ch === "v") sortMode = "version";
        else if (ch === "U") sortMode = "none";
        else if (ch === "n") { /* no-op */ }
        else if (ch === "A") ascii = false;
        else if (ch === "L") {
          const val = a.slice(j + 1) || args[++i];
          if (!val || !/^\d+$/u.test(val) || Number(val) < 1) return undefined;
          maxLevel = Number(val);
          j = a.length;
        } else if (ch === "P" || ch === "I") {
          const val = a.slice(j + 1) || args[++i];
          if (!val) return undefined;
          const re = compileTreeGlob(val);
          if (!re) return undefined;
          if (ch === "P") includePatterns.push(re);
          else excludePatterns.push(re);
          j = a.length;
        } else return undefined;
      }
      continue;
    }
    operands.push(a);
  }
  if (operands.length === 0) operands.push(".");

  const branchMid = ascii ? "|-- " : "├── ";
  const branchEnd = ascii ? "`-- " : "└── ";
  const pipeCont = ascii ? "|   " : "│   ";
  const spaceCont = "    ";

  let dirCount = 0;
  let fileCount = 0;
  const lines: string[] = [];

  const sortEntries = <T extends { readonly name: string; readonly type: "file" | "directory" | "symlink" }>(arr: T[]): T[] => {
    if (sortMode === "none" && !dirsFirst) return [...arr];
    const sorted = [...arr].sort((x, y) => {
      if (dirsFirst && x.type !== y.type) {
        if (x.type === "directory") return -1;
        if (y.type === "directory") return 1;
      }
      if (sortMode === "none") return 0;
      const cmp = sortMode === "version" ? compareVersions(new TextEncoder().encode(x.name), new TextEncoder().encode(y.name)) : (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
      return reverseSort ? -cmp : cmp;
    });
    return sorted;
  };

  const walkDir = (absPath: string, displayPrefix: string, indent: string, depth: number): boolean => {
    if (depth > maxLevel) return true;
    const node = inspectNode(absPath);
    if (!node || node.type !== "directory" || !node.children) return false;
    const filtered = sortEntries(
      node.children.filter(c => {
        if (!showAll && c.name.startsWith(".")) return false;
        if (dirsOnly && c.type !== "directory") return false;
        if (excludePatterns.length > 0 && excludePatterns.some(re => re.test(c.name))) return false;
        if (includePatterns.length > 0 && c.type !== "directory" && !includePatterns.every(re => re.test(c.name))) return false;
        return true;
      })
    );
    for (let idx = 0; idx < filtered.length; idx++) {
      const entry = filtered[idx]!;
      const isLast = idx === filtered.length - 1;
      const childAbs = absPath === "/" ? `/${entry.name}` : `${absPath}/${entry.name}`;
      const childDisplay = displayPrefix === "/" ? `/${entry.name}` : `${displayPrefix}/${entry.name}`;
      const typeSuffix = classify ? (entry.type === "directory" ? "/" : entry.type === "symlink" ? "@" : "") : "";
      const label = (fullPath ? childDisplay : entry.name) + typeSuffix + (entry.type === "symlink" && entry.target !== undefined ? ` -> ${entry.target}` : "");
      const prefix = noIndent ? "" : (indent + (isLast ? branchEnd : branchMid));
      lines.push(prefix + label);
      if (entry.type === "directory") {
        dirCount++;
        const nextIndent = noIndent ? "" : (indent + (isLast ? spaceCont : pipeCont));
        if (!walkDir(childAbs, childDisplay, nextIndent, depth + 1)) return false;
      } else {
        fileCount++;
      }
    }
    return true;
  };

  if (jsonOut) {
    if (fileLimit > 0) return undefined;
    const nl = noIndent ? "" : "\n";
    const pad = (d: number) => (noIndent ? "" : "  ".repeat(d));
    let jDirCount = 0;
    let jFileCount = 0;
    const buildJsonEntry = (absPath: string, dispName: string, depth: number): string | undefined => {
      const node = inspectNode(absPath);
      if (!node || node.type !== "directory" || !node.children) return undefined;
      const filtered = depth > maxLevel ? [] : sortEntries(
        node.children.filter(c => {
          if (!showAll && c.name.startsWith(".")) return false;
          if (dirsOnly && c.type !== "directory") return false;
          if (excludePatterns.length > 0 && excludePatterns.some(re => re.test(c.name))) return false;
          if (includePatterns.length > 0 && c.type !== "directory" && !includePatterns.every(re => re.test(c.name))) return false;
          return true;
        })
      );
      let s = `${pad(depth + 1)}` + JSON.stringify({ type: "directory", name: dispName }).slice(0, -1);
      if (filtered.length > 0) {
        const childJson: string[] = [];
        for (const entry of filtered) {
          const cAbs = absPath === "/" ? `/${entry.name}` : `${absPath}/${entry.name}`;
          const cDisp = fullPath ? (dispName === "/" ? `/${entry.name}` : `${dispName}/${entry.name}`) : entry.name;
          if (entry.type === "directory") {
            jDirCount++;
            const sub = buildJsonEntry(cAbs, cDisp, depth + 1);
            if (sub === undefined) return undefined;
            childJson.push(sub);
          } else {
            jFileCount++;
            const fObj: Record<string, unknown> = { type: entry.type === "symlink" ? "link" : "file", name: cDisp };
            if (entry.type === "symlink" && entry.target !== undefined) fObj.target = entry.target;
            childJson.push(`${pad(depth + 2)}${JSON.stringify(fObj)}`);
          }
        }
        s += `,"contents":[${nl}${childJson.join(`,${nl}`)}${nl}${pad(depth + 1)}]`;
      }
      s += "}";
      return s;
    };
    const rootItems: string[] = [];
    for (const op of operands) {
      if (!op) return undefined;
      const abs = resolveSyncTreePath(cwd, op);
      const cleanDisplay = op.length > 1 && op.endsWith("/") ? op.replace(/\/+$/u, "") || "/" : op;
      const built = buildJsonEntry(abs, cleanDisplay, 0);
      if (built === undefined) return undefined;
      rootItems.push(built);
    }
    if (!noReport) {
      const repObj = dirsOnly ? { type: "report", directories: jDirCount } : { type: "report", directories: jDirCount, files: jFileCount };
      rootItems.push(`${pad(1)}${JSON.stringify(repObj)}`);
    }
    return `[${nl}${rootItems.join(`,${nl}`)}${nl}]\n`;
  }
  if (fileLimit > 0) return undefined;
  for (const op of operands) {
    if (!op) return undefined;
    const abs = resolveSyncTreePath(cwd, op);
    const rootNode = inspectNode(abs);
    if (!rootNode || rootNode.type !== "directory") return undefined;
    const cleanDisplay = op.length > 1 && op.endsWith("/") ? op.replace(/\/+$/u, "") || "/" : op;
    lines.push(cleanDisplay + (classify ? "/" : ""));
    if (!walkDir(abs, cleanDisplay, "", 1)) return undefined;
  }

  if (!noReport) {
    const dirWord = dirCount === 1 ? "directory" : "directories";
    if (dirsOnly) {
      lines.push("", `${dirCount} ${dirWord}`);
    } else {
      const fileWord = fileCount === 1 ? "file" : "files";
      lines.push("", `${dirCount} ${dirWord}, ${fileCount} ${fileWord}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
