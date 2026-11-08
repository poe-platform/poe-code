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
  inspectNode: (absPath: string, follow?: boolean) => SyncTreeVfsNode | undefined,
  env?: Readonly<Record<string, string | undefined>>,
): string | undefined {
  let showAll = false;
  let dirsOnly = false;
  let dirsFirst = false;
  let fullPath = false;
  let noIndent = false;
  let noReport = false;
  let reverseSort = false;
  let sortMode: "name" | "version" | "none" = "name";
  let jsonOut = false;
  let fileLimit = 0;
  let explicitAscii: boolean | undefined;
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
      } else if (a.startsWith("--charset=") || a === "--charset") {
        const cs = (a.startsWith("--charset=") ? a.slice(10) : args[++i] ?? "").toUpperCase();
        if (cs === "ASCII" || cs === "US-ASCII") explicitAscii = true;
        else if (cs === "UTF-8" || cs === "UTF8") explicitAscii = false;
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
        else if (ch === "i") noIndent = true;
        else if (ch === "J") jsonOut = true;
        else if (ch === "r") reverseSort = true;
        else if (ch === "v") sortMode = "version";
        else if (ch === "U") sortMode = "none";
        else if (ch === "n") { /* no-op */ }
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
  for (const op of operands) {
    if (/(?:^|\/)((?!\.\.?(?:\/|$))[^/]+)\/\.\.(?:\/|$)/u.test(op)) return undefined;
  }
  if (fileLimit > 0) return undefined;

  let ascii = true;
  if (explicitAscii !== undefined) {
    ascii = explicitAscii;
  } else if (env) {
    if (env.TREE_CHARSET !== undefined) {
      const norm = env.TREE_CHARSET.toUpperCase();
      ascii = !(norm === "UTF-8" || norm === "UTF8");
    } else {
      for (const k of ["LC_ALL", "LC_CTYPE", "LANG"]) {
        const loc = env[k];
        if (loc) {
          const mod = loc.indexOf("@");
          const nm = mod < 0 ? loc : loc.slice(0, mod);
          const enc = nm.slice(nm.indexOf(".") + 1).toUpperCase();
          ascii = !(enc === "UTF-8" || enc === "UTF8");
          break;
        }
      }
    }
  }

  const branchMid = ascii ? "|-- " : "├── ";
  const branchEnd = ascii ? "`-- " : "└── ";
  const pipeCont = ascii ? "|   " : "│   ";
  const spaceCont = "    ";

  let dirCount = 0;
  let fileCount = 0;
  const lines: string[] = [];

  let utf8FilenameCharset = false;
  if (env) {
    for (const k of ["LC_ALL", "LC_CTYPE", "LANG"]) {
      const loc = env[k];
      if (loc) {
        const mod = loc.indexOf("@");
        const nm = mod < 0 ? loc : loc.slice(0, mod);
        const enc = nm.slice(nm.indexOf(".") + 1).toUpperCase();
        utf8FilenameCharset = enc === "UTF-8" || enc === "UTF8";
        break;
      }
    }
  }
  const escapeTreeLabel = (s: string): string | undefined => {
    for (let k = 0; k < s.length; k++) {
      const code = s.charCodeAt(k);
      if (code < 32 || code >= 127 || code === 92) return undefined;
    }
    return utf8FilenameCharset ? s : s.replace(/ /g, "\\ ");
  };
  const isEntryDirectory = (absDir: string, entry: { readonly name: string; readonly type: "file" | "directory" | "symlink" }): boolean => {
    if (entry.type === "directory") return true;
    if (entry.type === "symlink") {
      const childAbs = absDir === "/" ? `/${entry.name}` : `${absDir}/${entry.name}`;
      return inspectNode(childAbs)?.type === "directory";
    }
    return false;
  };

  const filterAndSort = <T extends { readonly name: string; readonly type: "file" | "directory" | "symlink"; readonly target?: string }>(absDir: string, children: readonly T[], depth: number): T[] => {
    if (depth > maxLevel) return [];
    const candidates = children.filter(c => {
      if (!showAll && c.name.startsWith(".")) return false;
      if (excludePatterns.length > 0 && excludePatterns.some(re => re.test(c.name))) return false;
      return true;
    });
    if (sortMode !== "none") {
      candidates.sort((x, y) => {
        const cmp = sortMode === "version" ? compareVersions(new TextEncoder().encode(x.name), new TextEncoder().encode(y.name)) : (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
        return reverseSort ? -cmp : cmp;
      });
    }
    const selected = candidates.filter(c => {
      const isDir = isEntryDirectory(absDir, c);
      if (dirsOnly && !isDir) return false;
      if (includePatterns.length > 0 && c.type !== "directory" && !includePatterns.some(re => re.test(c.name))) return false;
      return true;
    });
    if (dirsFirst) {
      selected.sort((x, y) => Number(isEntryDirectory(absDir, y)) - Number(isEntryDirectory(absDir, x)));
    }
    return selected;
  };

  const walkDir = (absPath: string, displayPrefix: string, indent: string, depth: number): boolean => {
    const node = inspectNode(absPath);
    if (!node || node.type !== "directory" || !node.children) return false;
    const filtered = filterAndSort(absPath, node.children, depth);
    if (depth === 1 && filtered.length > 0) {
      dirCount++;
    }
    for (let idx = 0; idx < filtered.length; idx++) {
      const entry = filtered[idx]!;
      const isLast = idx === filtered.length - 1;
      const childAbs = absPath === "/" ? `/${entry.name}` : `${absPath}/${entry.name}`;
      const baseDisp = displayPrefix.replace(/\/$/u, "");
      const childDisplay = baseDisp === "" ? `/${entry.name}` : `${baseDisp}/${entry.name}`;
      const escName = escapeTreeLabel(fullPath ? childDisplay : entry.name);
      if (escName === undefined) return false;
      const escTarget = entry.type === "symlink" && entry.target !== undefined ? escapeTreeLabel(entry.target) : "";
      if (escTarget === undefined) return false;
      const label = escName + (entry.type === "symlink" && entry.target !== undefined ? ` -> ${escTarget}` : "");
      const prefix = noIndent ? "" : (indent + (isLast ? branchEnd : branchMid));
      lines.push(prefix + label);
      const isDir = isEntryDirectory(absPath, entry);
      if (isDir) {
        dirCount++;
        if (entry.type === "directory") {
          const nextIndent = noIndent ? "" : (indent + (isLast ? spaceCont : pipeCont));
          if (!walkDir(childAbs, childDisplay, nextIndent, depth + 1)) return false;
        }
      } else {
        fileCount++;
      }
    }
    return true;
  };

  if (jsonOut) {
    const nl = noIndent ? "" : "\n";
    const pad = (d: number) => (noIndent ? "" : "  ".repeat(d));
    let jDirCount = 0;
    let jFileCount = 0;
    const buildJsonEntry = (absPath: string, dispName: string, depth: number): string | undefined => {
      const node = inspectNode(absPath, false);
      if (!node || node.type !== "directory" || !node.children) return undefined;
      const filtered = filterAndSort(absPath, node.children, depth + 1);
      if (depth === 0 && filtered.length > 0) {
        jDirCount++;
      }
      let s = `${pad(depth + 1)}` + JSON.stringify({ type: "directory", name: dispName }).slice(0, -1);
      if (filtered.length > 0) {
        const childJson: string[] = [];
        const baseDisp = dispName.replace(/\/$/u, "");
        for (const entry of filtered) {
          const cAbs = absPath === "/" ? `/${entry.name}` : `${absPath}/${entry.name}`;
          const cDisp = fullPath ? (baseDisp === "" ? `/${entry.name}` : `${baseDisp}/${entry.name}`) : entry.name;
          const isDir = isEntryDirectory(absPath, entry);
          if (entry.type === "directory") {
            jDirCount++;
            const sub = buildJsonEntry(cAbs, cDisp, depth + 1);
            if (sub === undefined) return undefined;
            childJson.push(sub);
          } else {
            if (isDir) jDirCount++;
            else jFileCount++;
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
      if (!op || op.endsWith("/.") || op.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(op)) return undefined;
      const abs = resolveSyncTreePath(cwd, op);
      const built = buildJsonEntry(abs, op, 0);
      if (built === undefined) return undefined;
      rootItems.push(built);
    }
    if (!noReport) {
      const repObj = dirsOnly ? { type: "report", directories: jDirCount } : { type: "report", directories: jDirCount, files: jFileCount };
      rootItems.push(`${pad(1)}${JSON.stringify(repObj)}`);
    }
    return `[${nl}${rootItems.join(`,${nl}`)}${nl}]\n`;
  }
  for (const op of operands) {
    if (!op || op.endsWith("/.") || op.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(op)) return undefined;
    const escOp = escapeTreeLabel(op);
    if (escOp === undefined) return undefined;
    const abs = resolveSyncTreePath(cwd, op);
    const rootNode = inspectNode(abs, false);
    if (!rootNode || rootNode.type !== "directory") return undefined;
    lines.push(escOp);
    if (!walkDir(abs, op, "", 1)) return undefined;
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

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncTree = evalSyncTree;
