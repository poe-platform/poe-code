import { type Dirent } from "node:fs";
import path from "node:path";
import fastGlob from "fast-glob";
import { quote } from "shell-quote";
import type { FileSystem, NodeFsImplementation } from "@poe-code/safe-fs";

export async function globFileSystem(
  options: { pattern: string; cwd: string },
  fs: Pick<NodeFsImplementation, "stat" | "lstat" | "readdir">
): Promise<string[]> {
  type NamesCallback = (error: NodeJS.ErrnoException | null, entries: string[]) => void;
  type EntriesCallback = (error: NodeJS.ErrnoException | null, entries: Dirent[]) => void;
  function readdir(directory: string, callback: NamesCallback): void;
  function readdir(
    directory: string,
    opts: { withFileTypes: true },
    callback: EntriesCallback
  ): void;
  function readdir(
    directory: string,
    opts: { withFileTypes: true } | NamesCallback,
    callback?: EntriesCallback
  ): void {
    if (typeof opts === "function")
      void fs.readdir(directory).then(
        (entries) => opts(null, entries),
        (error) => opts(error, [])
      );
    else
      void fs.readdir(directory, opts).then(
        (entries) => callback!(null, entries),
        (error) => callback!(error, [])
      );
  }
  return fastGlob(options.pattern, {
    absolute: true,
    cwd: options.cwd,
    dot: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    fs: {
      stat: (file, callback) => {
        void fs.stat(file).then(
          (stats) => callback(null, stats),
          (error) => callback(error, undefined!)
        );
      },
      lstat: (file, callback) => {
        void fs.lstat(file).then(
          (stats) => callback(null, stats),
          (error) => callback(error, undefined!)
        );
      },
      readdir
    }
  });
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
  const cwd = stat.type === "directory" ? options.path : path.posix.dirname(options.path);
  const target = stat.type === "directory" ? "." : path.posix.basename(options.path);
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
