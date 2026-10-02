import { parseFdArguments } from "./arguments.js";
import { formatFdPath } from "./templates.js";
import type { CommandDefinition, VirtualShellPlugin } from 'safe-bash-contracts';
import { createFdCommandWithMatcher, type FdCommandOptions } from './command.js';
import { createFdMatcher } from './matching.js';
export { createFdCommandWithMatcher, formatFdPath } from './command.js';
export type { FdCommandOptions, FdMatcher, FdMatchingScope, FdLimits } from './command.js';

export function createFdCommand(options: FdCommandOptions = {}): CommandDefinition {
  return createFdCommandWithMatcher(async (context, run) => run(createFdMatcher(context, options)), options);
}
export function createFdCommands(options: FdCommandOptions = {}): readonly CommandDefinition[] {
  return [createFdCommand(options)];
}
export type { FdCommandOptions as FdCommandsOptions, FdCommandOptions as FdOptions } from './command.js';
export function fdCommands(options: FdCommandOptions = {}): VirtualShellPlugin {
  const command = createFdCommand(options);
  return {name: 'fd-commands', setup(host) { host.commands.register(command, {replace: options.replace ?? false}); }};
}

export interface SyncFdVfsNode {
  readonly type: "file" | "directory" | "symlink";
  readonly size: number;
  readonly mode?: number;
  readonly ino?: number;
  readonly children?: ReadonlyArray<{ readonly name: string; readonly type: "file" | "directory" | "symlink"; readonly size: number; readonly mode?: number; readonly ino?: number }>;
}

function resolveSyncFdPath(cwd: string, target: string): string {
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

function compileSimpleFdMatcher(pattern: string, mode: "regex" | "glob" | "fixed", caseMode: "smart" | "sensitive" | "insensitive"): ((subj: string) => boolean) | undefined {
  if (!pattern) return () => true;
  const isSensitive = caseMode === "sensitive" || (caseMode === "smart" && /[A-Z]/u.test(pattern));
  if (mode === "fixed") {
    const needle = isSensitive ? pattern : pattern.toLowerCase();
    return (s: string) => (isSensitive ? s : s.toLowerCase()).includes(needle);
  }
  if (mode === "glob") {
    let rx = "^";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]!;
      if (ch === "*") rx += ".*";
      else if (ch === "?") rx += ".";
      else if (".^$+()[]{}|\\".includes(ch)) rx += "\\" + ch;
      else rx += ch;
    }
    rx += "$";
    try {
      const re = new RegExp(rx, isSensitive ? "" : "i");
      return (s: string) => re.test(s);
    } catch { return undefined; }
  }
  if (!/^[a-zA-Z0-9_.:;,=+*?^$\-[\]()|/]+$/u.test(pattern) || /\([^)]*[+*][^)]*\)[+*?]/u.test(pattern)) return undefined;
  try {
    const re = new RegExp(pattern, isSensitive ? "" : "i");
    return (s: string) => re.test(s);
  } catch { return undefined; }
}

export function evalSyncFd(
  args: readonly string[],
  cwd: string,
  inspectNode: (absPath: string) => SyncFdVfsNode | undefined,
  allowNullBytes = false,
): string | undefined {
  let a: ReturnType<typeof parseFdArguments>;
  try {
    a = parseFdArguments(args);
  } catch {
    return undefined;
  }
  if (
    a.help || a.version || a.exec.length > 0 || a.batch || a.details || (a.print0 && !allowNullBytes) ||
    a.within !== undefined || a.before !== undefined || a.ignoreFiles.length > 0
  ) {
    return undefined;
  }
  const matchFns: Array<(subj: string) => boolean> = [];
  for (const pat of (a.patterns.length > 0 ? a.patterns : [""])) {
    const fn = compileSimpleFdMatcher(pat, a.mode, a.caseMode);
    if (!fn) return undefined;
    matchFns.push(fn);
  }
  const excludeFns: Array<(subj: string) => boolean> = [];
  for (const ex of a.excludes) {
    const fn = compileSimpleFdMatcher(ex, "glob", "sensitive");
    if (!fn) return undefined;
    excludeFns.push(fn);
  }
  const sizeChecks: Array<(sz: number) => boolean> = [];
  for (const szSpec of a.sizes) {
    const m = /^([+-]?)(\d+)(b|[kmgt]i?b?)?$/iu.exec(szSpec);
    if (!m) return undefined;
    const op = m[1]!;
    const num = Number(m[2]!);
    const u = (m[3] ?? "b").toLowerCase();
    const power = "bkmgt".indexOf(u[0]!);
    const target = num * (u.includes("i") ? 1024 : 1000) ** power;
    sizeChecks.push((sz: number) => op === "+" ? sz >= target : op === "-" ? sz <= target : sz === target);
  }
  const effectiveCwd = a.baseDirectory === undefined ? cwd : resolveSyncFdPath(cwd, a.baseDirectory);
  const roots = a.roots.length > 0 ? a.roots : ["."];
  const results: string[] = [];

  for (const rootArg of roots) {
    const absRoot = resolveSyncFdPath(effectiveCwd, rootArg);
    const rootNode = inspectNode(absRoot);
    if (!rootNode || rootNode.type !== "directory") return undefined;
    if (a.ignore && rootNode.children?.some(c => (c.name === ".gitignore" && a.ignoreVcs) || c.name === ".ignore" || c.name === ".fdignore")) {
      return undefined;
    }
    if (a.ignore && a.ignoreParent) {
      let parentDir = absRoot;
      while (parentDir !== "/") {
        parentDir = resolveSyncFdPath(parentDir, "..");
        const pNode = inspectNode(parentDir);
        if (pNode?.children?.some(c => (c.name === ".gitignore" && a.ignoreVcs) || c.name === ".ignore" || c.name === ".fdignore")) {
          return undefined;
        }
      }
    }
    const walk = (absDir: string, relPrefix: string, depth: number, ancestors: ReadonlySet<string>): boolean => {
      if (depth > a.maxDepth) return true;
      const dirNode = inspectNode(absDir);
      if (!dirNode || dirNode.type !== "directory" || !dirNode.children) return false;
      const dirKey = dirNode.ino !== undefined ? String(dirNode.ino) : absDir;
      if (ancestors.has(dirKey)) return false;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(dirKey);
      if (a.ignore && dirNode.children.some(c => c.name === ".gitignore" || c.name === ".ignore" || c.name === ".fdignore")) {
        return false;
      }
      const sorted = [...dirNode.children].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      for (const entry of sorted) {
        if (!a.hidden && entry.name.startsWith(".")) continue;
        const childAbs = absDir === "/" ? `/${entry.name}` : `${absDir}/${entry.name}`;
        const childRel = relPrefix ? `${relPrefix}/${entry.name}` : (rootArg === "." ? entry.name : `${rootArg.replace(/\/+$/u, "")}/${entry.name}`);
        if (excludeFns.length > 0 && excludeFns.some(fn => fn(entry.name) || fn(childRel))) continue;
        let entryType = entry.type;
        let entrySize = entry.size;
        let entryMode = entry.mode;
        let derefNode: SyncFdVfsNode | undefined;
        if (entry.type === "symlink" && a.follow) {
          derefNode = inspectNode(childAbs);
          if (derefNode) {
            const targetKey = derefNode.ino !== undefined ? String(derefNode.ino) : childAbs;
            if (derefNode.type === "directory" && nextAncestors.has(targetKey)) continue;
            entryType = derefNode.type;
            entrySize = derefNode.size;
            entryMode = derefNode.mode;
          }
        }
        const depthOk = depth >= a.minDepth && depth <= a.maxDepth;
        const ordinaryTypes = a.types.filter(t => t !== "empty" && t !== "executable");
        let typeOk = true;
        if (ordinaryTypes.length > 0 || a.types.includes("executable")) {
          typeOk =
            ordinaryTypes.includes(entryType) ||
            (a.types.includes("executable") && entryType === "file" && ((entryMode ?? 0) & 0o111) !== 0);
        }
        if (typeOk && a.types.includes("empty")) {
          typeOk =
            (entryType === "file" && entrySize === 0) ||
            (entryType === "directory" && ((derefNode ?? inspectNode(childAbs))?.children?.length ?? 1) === 0);
        }
        const sizeOk = sizeChecks.length === 0 || (entryType === "file" && sizeChecks.every(fn => fn(entrySize)));
        let extOk = a.extensions.length === 0;
        if (!extOk) {
          const lower = entry.name.toLowerCase();
          extOk = a.extensions.some(ext => lower.length > ext.length + 1 && lower.endsWith(`.${ext.toLowerCase()}`));
        }
        const subject = a.fullPath ? (a.absolute ? childAbs : childRel) : entry.name;
        if (depthOk && typeOk && sizeOk && extOk && matchFns.every(fn => fn(subject))) {
          const prefixCwd = rootArg === ".";
          const rawOut = a.absolute
            ? childAbs
            : !a.stripCwdPrefix && prefixCwd && a.print0 && !childRel.startsWith("/") && !childRel.startsWith("./") && !childRel.startsWith("../")
              ? `./${childRel}`
              : (a.stripCwdPrefix ? childRel.replace(/^\.\//u, "") : childRel);
          const out = a.pathSeparator !== undefined ? rawOut.split("/").join(a.pathSeparator) : rawOut;
          results.push(a.format !== undefined ? formatFdPath(a.format, out) : out + (entryType === "directory" ? (a.pathSeparator ?? "/") : ""));
          if (a.quiet || results.length >= a.maxResults) return true;
          if (a.prune && entryType === "directory") continue;
        }
        if (entryType === "directory") {
          if (!walk(childAbs, childRel, depth + 1, nextAncestors)) return false;
          if (a.quiet || results.length >= a.maxResults) return true;
        }
      }
      return true;
    };
    if (!walk(absRoot, "", 1, new Set<string>())) return undefined;
    if (a.quiet || results.length >= a.maxResults) break;
  }
  const capped = Number.isFinite(a.maxResults) ? results.slice(0, a.maxResults) : results;
  if (a.quiet) {
    return capped.length > 0 ? "" : undefined;
  }
  const sep = a.print0 ? "\0" : "\n";
  return capped.length === 0 ? "" : `${capped.join(sep)}${sep}`;
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncFd = evalSyncFd;
