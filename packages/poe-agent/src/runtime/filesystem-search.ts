import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { Minimatch } from "minimatch";
import { quote } from "shell-quote";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { hasOwnErrorCode } from "../error-codes.js";

export async function globFileSystem(
  options: { pattern: string; cwd: string },
  fs: {
    lstat(path: string): Promise<{ isSymbolicLink(): boolean; isFile(): boolean; isDirectory(): boolean }>;
    readdir(path: string): Promise<string[]>;
  }
): Promise<string[]> {
  const matcher = new Minimatch(path.resolve(options.cwd, options.pattern), {
    dot: true, platform: "linux", nocomment: true, nonegate: true
  });
  const pending = new Set<string>();
  for (const pattern of matcher.set) {
    const prefix: string[] = [];
    for (const part of pattern) {
      if (typeof part !== "string") break;
      prefix.push(part);
    }
    pending.add(path.resolve("/", prefix.join("/")));
  }
  // A static pattern prefix may already sit below a symlink. Inspect it before walking.
  for (const root of pending) {
    let parent = path.dirname(root);
    while (true) {
      try {
        if ((await fs.lstat(parent)).isSymbolicLink()) {
          pending.delete(root);
          break;
        }
      } catch (error) {
        if (!hasOwnErrorCode(error, "ENOENT") && !hasOwnErrorCode(error, "ENOTDIR")) throw error;
        pending.delete(root);
        break;
      }
      const ancestor = path.dirname(parent);
      if (ancestor === parent) break;
      parent = ancestor;
    }
  }
  const visited = new Set<string>();
  const matches: string[] = [];
  for (const target of pending) {
    if (visited.has(target)) continue;
    visited.add(target);
    if (visited.size > 100_000) throw new Error("Glob traversal exceeds 100000 entries.");
    let stat;
    try { stat = await fs.lstat(target); }
    catch (error) {
      if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) continue;
      throw error;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile() && matcher.match(target)) matches.push(target);
    if (stat.isDirectory() && matcher.match(target, true)) {
      for (const name of await fs.readdir(target)) pending.add(path.join(target, name));
    }
  }
  return matches.sort();
}

/** Uses safe-bash's bounded rg implementation over the supplied byte filesystem. */
export async function searchFileSystem(
  options: {
    pattern: string;
    path: string;
    glob?: string;
    outputMode: "files_with_matches" | "content" | "count";
    lineNumbers: boolean;
    ignoreCase: boolean;
    signal: AbortSignal;
  },
  fs: FileSystem
): Promise<string> {
  options.signal.throwIfAborted();
  const { Shell, createSearchCommands, createBoundedRegexProvider } =
    await import("@poe-platform/safe-bash/search");
  const provider = createBoundedRegexProvider();
  const stat = await fs.stat(options.path, { signal: options.signal });
  const cwd = stat.type === "directory" ? options.path : path.dirname(options.path);
  const target = stat.type === "directory" ? "." : path.basename(options.path);
  const args = ["--color", "never"];
  if (options.outputMode === "content") {
    args.push("--with-filename");
    if (options.lineNumbers) args.push("-n");
  } else if (options.outputMode === "files_with_matches") args.push("--files-with-matches");
  else args.push("--count", "--no-filename");
  if (options.ignoreCase) args.push("-i");
  if (options.glob !== undefined) args.push("--glob", options.glob);
  args.push("--", options.pattern, target);
  const shell = new Shell({ fs, cwd, deviceView: "provided", env: {} });
  for (const command of createSearchCommands({ regexExecutor: provider })) shell.register(command);
  try {
    const result = await shell.exec(quote(["rg", ...args]), { signal: options.signal });
    if (result.exitCode > 1) throw new Error(`grep failed: ${result.stderr.trim()}`);
    const output = result.stdout.trimEnd();
    if (!output) return options.outputMode === "count" ? "0" : "(no matches)";
    return options.outputMode === "count"
      ? String(output.split("\n").reduce((sum, line) => sum + Number(line), 0))
      : output;
  } finally {
    await shell.dispose();
  }
}
