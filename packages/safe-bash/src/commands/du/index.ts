import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";
import { blockSize, formatSize, type Format } from "./format.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createDuCommand } from "./du.js";
import type { DuCommandsOptions } from "./options.js";
export { createDuCommand } from "./du.js";
export type { DuCommandsOptions, DuLimits } from "./options.js";

export function createDuCommands(options: DuCommandsOptions = {}): readonly CommandDefinition[] {
  return [registerDefaultExecutor(createDuCommand(options), options)];
}

export function duCommands(options: DuCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDuCommands(options);
  const replace = options.replace ?? false;
  return { name: "du-commands", setup(host) {
    if (!replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace });
  } };
}

export interface SyncDuVfsNode {
  readonly type: "file" | "directory" | "symlink";
  readonly size: number;
  readonly ino?: number;
  readonly children?: ReadonlyArray<{ readonly name: string; readonly type: "file" | "directory" | "symlink"; readonly size: number; readonly ino?: number }>;
}

function resolveSyncDuPath(cwd: string, target: string): string {
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

export function evalSyncDu(
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  inspectNode: (absPath: string) => SyncDuVfsNode | undefined,
): string | undefined {
  let apparent = false;
  let inodes = false;
  let all = false;
  let total = false;
  let separate = false;
  let countLinks = false;
  let maxDepth = Infinity;
  let summarize = false;
  let fmt: Format;
  try {
    const envBlock = env.DU_BLOCK_SIZE ?? env.BLOCK_SIZE ?? env.BLOCKSIZE;
    fmt = envBlock ? blockSize(envBlock) : (env.POSIXLY_CORRECT !== undefined ? { unit: 512n, suffix: "" } : { unit: 1024n, suffix: "" });
  } catch {
    return undefined;
  }
  const operands: string[] = [];
  let endOpts = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!endOpts && a === "--") { endOpts = true; continue; }
    if (!endOpts && a.startsWith("--") && a.length > 2) {
      if (a === "--apparent-size") apparent = true;
      else if (a === "--bytes") { apparent = true; fmt = { unit: 1n, suffix: "" }; }
      else if (a === "--inodes") inodes = true;
      else if (a === "--all") all = true;
      else if (a === "--total") total = true;
      else if (a === "--separate-dirs") separate = true;
      else if (a === "--count-links") countLinks = true;
      else if (a === "--summarize") summarize = true;
      else if (a === "--human-readable") fmt = { unit: 1n, suffix: "", human: 1024 };
      else if (a === "--si") fmt = { unit: 1n, suffix: "", human: 1000 };
      else if (a === "--max-depth" || a.startsWith("--max-depth=")) {
        const val = a === "--max-depth" ? args[++i] : a.slice("--max-depth=".length);
        if (!val || !/^\d+$/u.test(val)) return undefined;
        maxDepth = Number(val);
      } else if (a === "--block-size" || a.startsWith("--block-size=")) {
        const val = a === "--block-size" ? args[++i] : a.slice("--block-size=".length);
        if (!val) return undefined;
        try { fmt = blockSize(val); } catch { return undefined; }
      } else return undefined;
      continue;
    }
    if (!endOpts && a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "b") { apparent = true; fmt = { unit: 1n, suffix: "" }; }
        else if (ch === "a") all = true;
        else if (ch === "c") total = true;
        else if (ch === "S") separate = true;
        else if (ch === "l") countLinks = true;
        else if (ch === "s") summarize = true;
        else if (ch === "h") fmt = { unit: 1n, suffix: "", human: 1024 };
        else if (ch === "H") fmt = { unit: 1n, suffix: "", human: 1000 };
        else if (ch === "k") fmt = { unit: 1024n, suffix: "" };
        else if (ch === "m") fmt = { unit: 1048576n, suffix: "" };
        else if (ch === "d") {
          const val = a.slice(j + 1) || args[++i];
          if (!val || !/^\d+$/u.test(val)) return undefined;
          maxDepth = Number(val);
          j = a.length;
        } else if (ch === "B") {
          const val = a.slice(j + 1) || args[++i];
          if (!val) return undefined;
          try { fmt = blockSize(val); } catch { return undefined; }
          j = a.length;
        } else return undefined;
      }
      continue;
    }
    operands.push(a);
  }
  if (summarize && maxDepth !== Infinity && maxDepth !== 0) return undefined;
  if (summarize && all) return undefined;
  if (summarize) maxDepth = 0;
  // On MemoryFileSystem, allocatedBytes is undefined so only apparent or inodes succeeds with exitCode 0
  if (!apparent && !inodes) return undefined;
  if (operands.length === 0) operands.push(".");

  const seenInodes = new Set<number>();
  const outLines: string[] = [];
  let grandTotal = 0;
  let failed = false;

  const walk = (absPath: string, display: string, depth: number): { bytes: number; directory: boolean } => {
    const node = inspectNode(absPath);
    if (!node) {
      failed = true;
      return { bytes: 0, directory: false };
    }
    if (!countLinks && node.type !== "directory" && node.ino !== undefined) {
      if (seenInodes.has(node.ino)) return { bytes: 0, directory: false };
      seenInodes.add(node.ino);
    }
    const baseBytes = inodes ? 1 : (node.type === "directory" ? 0 : node.size);
    let sumBytes = baseBytes;
    let ownBytes = baseBytes;
    if (node.type === "directory" && node.children) {
      for (const child of node.children) {
        const suffix = display.endsWith("/") ? "" : "/";
        const childAbs = absPath === "/" ? `/${child.name}` : `${absPath}/${child.name}`;
        const childDisplay = `${display}${suffix}${child.name}`;
        const cRes = walk(childAbs, childDisplay, depth + 1);
        sumBytes += cRes.bytes;
        if (separate && !cRes.directory) ownBytes += cRes.bytes;
      }
    }
    if (depth === 0 || (depth <= maxDepth && (node.type === "directory" || all))) {
      const val = separate ? ownBytes : sumBytes;
      const formatted = inodes ? String(val) : formatSize(val, fmt);
      outLines.push(`${formatted}\t${display}`);
    }
    return { bytes: sumBytes, directory: node.type === "directory" };
  };

  for (const op of operands) {
    if (op === "") return undefined;
    const abs = resolveSyncDuPath(cwd, op);
    const res = walk(abs, op, 0);
    if (failed) return undefined;
    if (total) grandTotal += res.bytes;
  }
  if (total) {
    const formatted = inodes ? String(grandTotal) : formatSize(grandTotal, fmt);
    outLines.push(`${formatted}\ttotal`);
  }
  return outLines.length === 0 ? "" : `${outLines.join("\n")}\n`;
}
