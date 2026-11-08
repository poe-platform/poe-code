import { access, readFile } from "node:fs/promises";
import { posix } from "node:path";
import { CommandRegistry } from "../src/contracts/command.js";
import type { CommandDefinition } from "../src/contracts/command.js";
import type { FileSystem } from "../src/contracts/filesystem.js";
import type { VirtualShellPlugin } from "../src/contracts/plugin.js";
import type { Engine, Observation } from "./model.js";

export const fixtureRoot = "/fixture";
export const environment = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" });
export const pinnedJustBash = "3.4.2";
export const maxOutputBytes = 4 * 1024 * 1024;

export class PendingRuntimeError extends Error {}

export interface Streams {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutCapture: Observation["stdoutCapture"];
  stderrCapture: Observation["stderrCapture"];
}

export interface SnapshotFs {
  list(path: string): Promise<string[]>;
  type(path: string): Promise<"file" | "directory" | "symlink" | "other">;
  read(path: string): Promise<Uint8Array>;
}

export interface Harness {
  commands: string[];
  plugins?: readonly string[];
  execute(script: string, stdin: Uint8Array, signal?: AbortSignal): Promise<Streams>;
  snapshot(): Promise<Pick<Observation, "files" | "unsupportedEntries">>;
  register?: (command: CommandDefinition) => void;
  dispose(): Promise<void>;
}

export interface Hooks {
  wait?: (signal: AbortSignal | undefined) => Promise<void>;
}

interface VirtualShell {
  use(plugin: VirtualShellPlugin): unknown;
  exec(source: string, options: { stdin: Uint8Array; signal?: AbortSignal }): Promise<{
    stdoutBytes: Uint8Array; stderrBytes: Uint8Array; exitCode: number;
  }>;
  register(command: CommandDefinition): unknown;
  dispose(): Promise<void>;
}

export async function snapshotTree(fs: SnapshotFs): Promise<Pick<Observation, "files" | "unsupportedEntries">> {
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  const unsupportedEntries: string[] = [];
  let entries = 0;
  let totalBytes = 0;
  const walk = async (directory: string, relative: string, depth: number): Promise<void> => {
    if (depth > 64) throw new RangeError("Filesystem snapshot depth limit exceeded");
    for (const name of (await fs.list(directory)).sort()) {
      if (!name || name.includes("/") || name === "." || name === "..") throw new Error("Invalid directory entry");
      if (++entries > 4096) throw new RangeError("Filesystem snapshot entry limit exceeded");
      const path = posix.join(directory, name);
      const relativePath = relative ? `${relative}/${name}` : name;
      const type = await fs.type(path);
      if (type === "directory") await walk(path, relativePath, depth + 1);
      else if (type === "file") {
        const bytes = await fs.read(path);
        totalBytes += bytes.byteLength;
        if (bytes.byteLength > maxOutputBytes || totalBytes > 8 * maxOutputBytes) throw new RangeError("Filesystem snapshot byte limit exceeded");
        files[relativePath] = Buffer.from(bytes).toString("base64");
      } else unsupportedEntries.push(`${relativePath}:${type}`);
    }
  };
  await walk(fixtureRoot, "", 0);
  return { files, unsupportedEntries };
}

export async function createHarness(
  engine: Engine,
  initialFiles: Record<string, string> = {},
  env: Record<string, string> = {},
  hooks: Hooks = {},
): Promise<Harness> {
  if (engine === "virtual-bash") {
    const paths = ["../src/shell/index.ts", "../src/fs/memory/index.ts"];
    const pluginSpecs = [
      ["../src/commands/index.ts", "standardCommands"],
      ["../src/commands/text-programs/index.ts", "textProgramCommands"],
      ["../src/commands/structured/index.ts", "structuredCommands"],
      ["../src/commands/search/index.ts", "searchCommands"],
      ["../src/commands/bytes/index.ts", "byteCommands"],
      ["../src/commands/diff-patch/index.ts", "diffPatchCommands"],
    ] as const;
    for (const path of [...paths, ...pluginSpecs.map(([path]) => path)]) {
      try { await access(new URL(path, import.meta.url)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PendingRuntimeError(`Runtime component not delivered: ${path}`);
        throw error;
      }
    }
    const [{ Shell }, { MemoryFileSystem }] = await Promise.all(paths.map((path) => import(new URL(path, import.meta.url).href))) as [
      { Shell: new (options: unknown) => VirtualShell },
      { MemoryFileSystem: new () => FileSystem },
    ];
    const fs = new MemoryFileSystem();
    await fs.mkdir(fixtureRoot, { recursive: true, mode: 0o755 });
    for (const [path, contents] of Object.entries(initialFiles)) {
      await fs.mkdir(posix.dirname(`${fixtureRoot}/${path}`), { recursive: true, mode: 0o755 });
      await fs.writeFile(`${fixtureRoot}/${path}`, Buffer.from(contents, "base64"), { mode: 0o644 });
    }
    const plugins = await Promise.all(pluginSpecs.map(async ([path, factory]) => {
      const module = await import(new URL(path, import.meta.url).href) as Record<string, unknown>;
      if (typeof module[factory] !== "function") throw new TypeError(`Missing plugin factory: ${factory}`);
      return (module[factory] as () => VirtualShellPlugin)();
    }));
    const commands = new CommandRegistry();
    const shell = new Shell({ fs, commands, cwd: fixtureRoot,
      env: { ...environment, ...env }, limits: { maxOutputBytes, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } });
    for (const plugin of plugins) shell.use(plugin);
    const initialized = await shell.exec("", { stdin: new Uint8Array() });
    if (initialized.exitCode || initialized.stdoutBytes.length || initialized.stderrBytes.length) {
      await shell.dispose();
      throw new Error(`Plugin initialization failed: ${Buffer.from(initialized.stderrBytes).toString()}`);
    }
    if (hooks.wait) shell.register({ name: "bench_wait", async execute(context) {
      await hooks.wait!(context.signal); return { exitCode: 0 };
    } });
    return {
      get commands() { return commands.list().map(command => command.name); },
      plugins: plugins.map(plugin => plugin.name),
      async execute(script, stdin, signal) {
        const result = await shell.exec(script, { stdin, ...(signal ? { signal } : {}) });
        return { stdout: Buffer.from(result.stdoutBytes).toString("base64"),
          stderr: Buffer.from(result.stderrBytes).toString("base64"), exitCode: result.exitCode,
          stdoutCapture: "native-bytes", stderrCapture: "native-bytes" };
      },
      snapshot: () => snapshotTree({ list: async (path) => (await fs.readdir(path)).map((entry) => entry.name),
        type: async (path) => (await fs.lstat(path)).type, read: (path) => fs.readFile(path) }),
      register: (command) => { shell.register(command); },
      dispose: () => shell.dispose(),
    };
  }
  let installed: { version: string };
  try { installed = JSON.parse(await readFile(new URL("./node_modules/just-bash/package.json", import.meta.url), "utf8")) as { version: string }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PendingRuntimeError("Isolated comparator is not installed; run npm --prefix benchmarks ci --ignore-scripts");
    throw error;
  }
  if (installed.version !== pinnedJustBash) throw new Error(`Expected just-bash ${pinnedJustBash}, found ${installed.version}`);
  const { Bash, InMemoryFs, defineCommand, stdoutAsBytes, latin1FromBytes, getCommandNames } = await import("just-bash");
  const fs = new InMemoryFs();
  await fs.mkdir(fixtureRoot, { recursive: true });
  for (const [path, contents] of Object.entries(initialFiles)) {
    await fs.mkdir(posix.dirname(`${fixtureRoot}/${path}`), { recursive: true });
    await fs.writeFile(`${fixtureRoot}/${path}`, Buffer.from(contents, "base64"));
    await fs.chmod(`${fixtureRoot}/${path}`, 0o644);
  }
  const shell = new Bash({ fs, cwd: fixtureRoot, env: { ...environment, ...env },
    executionLimits: { maxOutputSize: maxOutputBytes, maxCommandCount: 10000, maxLoopIterations: 10000, maxExecutionTimeMs: 4500 },
    customCommands: hooks.wait ? [defineCommand("bench_wait", async (_args, context) => {
      await hooks.wait!(context.signal); return { stdout: "", stderr: "", exitCode: 0 };
    })] : [],
  });
  return {
    commands: [...getCommandNames()],
    async execute(script, stdin, signal) {
      const result = await shell.exec(script, { stdin: Buffer.from(stdin).toString("latin1"), stdinKind: "bytes",
        rawScript: true, replaceEnv: true, env: { ...environment, ...env }, ...(signal ? { signal } : {}) });
      return { stdout: Buffer.from(latin1FromBytes(stdoutAsBytes(result)), "latin1").toString("base64"),
        stderr: Buffer.from(result.stderr, "utf8").toString("base64"), exitCode: result.exitCode,
        stdoutCapture: result.stdoutKind === "bytes" || result.stdoutEncoding === "binary" ? "declared-bytes" : "public-text-utf8",
        stderrCapture: "public-text-utf8" };
    },
    snapshot: () => snapshotTree({ list: (path) => fs.readdir(path), read: (path) => fs.readFileBuffer(path),
      type: async (path) => { const stat = await fs.lstat(path); return stat.isSymbolicLink ? "symlink" : stat.isDirectory ? "directory" : stat.isFile ? "file" : "other"; } }),
    async dispose() {},
  };
}
