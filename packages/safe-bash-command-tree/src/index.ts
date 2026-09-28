import { registerDefaultExecutor, registerDefaultExecutors } from "safe-bash-command-io-engine/internal";
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
  let fullPath = false;
  let noIndent = false;
  let noReport = false;
  let reverseSort = false;
  let versionSort = false;
  let ascii = false;
  let maxLevel = Infinity;
  const operands: string[] = [];
  let endOpts = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!endOpts && a === "--") { endOpts = true; continue; }
    if (!endOpts && a.startsWith("--") && a.length > 2) {
      if (a === "--noreport") noReport = true;
      else if (a === "--charset=ascii" || a === "--charset=ANSI") ascii = true;
      else if (a === "--charset" && i + 1 < args.length && (args[i + 1] === "ascii" || args[i + 1] === "ANSI")) { ascii = true; i++; }
      else if (a === "--dirsfirst") return undefined;
      else return undefined;
      continue;
    }
    if (!endOpts && a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "a") showAll = true;
        else if (ch === "d") dirsOnly = true;
        else if (ch === "f") fullPath = true;
        else if (ch === "i") noIndent = true;
        else if (ch === "r") reverseSort = true;
        else if (ch === "v") versionSort = true;
        else if (ch === "A") ascii = false;
        else if (ch === "L") {
          const val = a.slice(j + 1) || args[++i];
          if (!val || !/^\d+$/u.test(val) || Number(val) < 1) return undefined;
          maxLevel = Number(val);
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

  const sortEntries = <T extends { readonly name: string }>(arr: T[]): T[] => {
    const sorted = [...arr].sort((x, y) => {
      const cmp = versionSort ? compareVersions(new TextEncoder().encode(x.name), new TextEncoder().encode(y.name)) : (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
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
        return true;
      })
    );
    for (let idx = 0; idx < filtered.length; idx++) {
      const entry = filtered[idx]!;
      const isLast = idx === filtered.length - 1;
      const childAbs = absPath === "/" ? `/${entry.name}` : `${absPath}/${entry.name}`;
      const childDisplay = displayPrefix === "/" ? `/${entry.name}` : `${displayPrefix}/${entry.name}`;
      const label = (fullPath ? childDisplay : entry.name) + (entry.type === "symlink" && entry.target !== undefined ? ` -> ${entry.target}` : "");
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

  for (const op of operands) {
    if (!op) return undefined;
    const abs = resolveSyncTreePath(cwd, op);
    const rootNode = inspectNode(abs);
    if (!rootNode || rootNode.type !== "directory") return undefined;
    const cleanDisplay = op.length > 1 && op.endsWith("/") ? op.replace(/\/+$/u, "") || "/" : op;
    lines.push(cleanDisplay);
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
