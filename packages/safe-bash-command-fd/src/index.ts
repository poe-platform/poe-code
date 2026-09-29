import { parseFdArguments } from "./arguments.js";
import { fdTemplate, formatFdPath } from "./templates.js";
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
  readonly children?: ReadonlyArray<{ readonly name: string; readonly type: "file" | "directory" | "symlink"; readonly size: number; readonly mode?: number }>;
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
    a.within !== undefined || a.before !== undefined
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
    const m = /^([+-]?)(\d+)(b|k|m|g|t|ki|mi|gi|ti)?$/iu.exec(szSpec.trim());
    if (!m) return undefined;
    const op = m[1]!;
    const num = Number(m[2]!);
    const u = (m[3] ?? "b").toLowerCase();
    const mult =
      u === "b" ? 1 :
      u === "k" ? 1e3 : u === "m" ? 1e6 : u === "g" ? 1e9 : u === "t" ? 1e12 :
      u === "ki" ? 1024 : u === "mi" ? 1048576 : u === "gi" ? 1073741824 : 1099511627776;
    const target = num * mult;
    sizeChecks.push((sz: number) => op === "+" ? sz >= target : op === "-" ? sz <= target : sz === target);
  }
  const effectiveCwd = a.baseDirectory === undefined ? cwd : resolveSyncFdPath(cwd, a.baseDirectory);
  const roots = a.roots.length > 0 ? a.roots : ["."];
  const results: string[] = [];

  for (const rootArg of roots) {
    const absRoot = resolveSyncFdPath(effectiveCwd, rootArg);
    const rootNode = inspectNode(absRoot);
    if (!rootNode || rootNode.type !== "directory") return undefined;
    if (a.ignore && rootNode.children?.some(c => c.name === ".gitignore" || c.name === ".ignore" || c.name === ".fdignore")) {
      return undefined;
    }
    const walk = (absDir: string, relPrefix: string, depth: number): boolean => {
      if (depth > a.maxDepth) return true;
      const dirNode = inspectNode(absDir);
      if (!dirNode || dirNode.type !== "directory" || !dirNode.children) return false;
      if (a.ignore && dirNode.children.some(c => c.name === ".gitignore" || c.name === ".ignore" || c.name === ".fdignore")) {
        return false;
      }
      const sorted = [...dirNode.children].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      for (const entry of sorted) {
        if (!a.hidden && entry.name.startsWith(".")) continue;
        const childAbs = absDir === "/" ? `/${entry.name}` : `${absDir}/${entry.name}`;
        const childRel = relPrefix ? `${relPrefix}/${entry.name}` : (rootArg === "." ? entry.name : `${rootArg.replace(/\/+$/u, "")}/${entry.name}`);
        if (excludeFns.length > 0 && excludeFns.some(fn => fn(entry.name) || fn(childRel))) continue;
        if (entry.type === "directory") {
          if (!walk(childAbs, childRel, depth + 1)) return false;
        }
        const depthOk = depth >= a.minDepth && depth <= a.maxDepth;
        let typeOk = a.types.length === 0;
        if (!typeOk) {
          if (a.types.includes("file") && entry.type === "file") typeOk = true;
          if (a.types.includes("directory") && entry.type === "directory") typeOk = true;
          if (a.types.includes("symlink") && entry.type === "symlink") typeOk = true;
          if (a.types.includes("empty") && ((entry.type === "file" && entry.size === 0) || (entry.type === "directory" && (inspectNode(childAbs)?.children?.length ?? 1) === 0))) typeOk = true;
          if (a.types.includes("executable") && entry.type === "file" && ((entry.mode ?? 0) & 0o111) !== 0) typeOk = true;
        }
        const sizeOk = sizeChecks.length === 0 || (entry.type === "file" && sizeChecks.every(fn => fn(entry.size)));
        let extOk = a.extensions.length === 0;
        if (!extOk) {
          const lower = entry.name.toLowerCase();
          extOk = a.extensions.some(ext => lower.endsWith(`.${ext.toLowerCase()}`));
        }
        const subject = a.fullPath ? childRel : entry.name;
        if (depthOk && typeOk && sizeOk && extOk && matchFns.every(fn => fn(subject))) {
          let disp = a.absolute ? childAbs : (a.stripCwdPrefix ? childRel.replace(/^\.\//u, "") : childRel);
          if (a.pathSeparator !== undefined) disp = disp.split("/").join(a.pathSeparator);
          results.push(a.format ? formatFdPath(a.format, disp) : disp);
        }
      }
      return true;
    };
    if (!walk(absRoot, "", 1)) return undefined;
  }

  results.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const capped = Number.isFinite(a.maxResults) ? results.slice(0, a.maxResults) : results;
  if (a.quiet) {
    return capped.length > 0 ? "" : undefined;
  }
  const sep = a.print0 ? "\0" : "\n";
  return capped.length === 0 ? "" : `${capped.join(sep)}${sep}`;
}
