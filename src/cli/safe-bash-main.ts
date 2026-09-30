import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  MemoryFileSystem,
  MountFileSystem,
  RealFileSystem,
  Shell,
  agentCommands,
  gitCommands,
  type CommandContext,
  type FileSystem
} from "@poe-platform/safe-bash";

export interface WorkspaceFileSystemOptions {
  workspaceRoot: string;
  cwd?: string;
  homeDir?: string;
  workspaceBackend?: FileSystem;
  cwdBackend?: FileSystem;
}

export interface ParsedSafeBashCliArgs {
  command?: string;
  scriptFile?: string;
  positionals: string[];
  workspaceRoot?: string;
  cwd?: string;
  help?: boolean;
  version?: boolean;
}

export interface SafeBashCliOptions {
  cwd?: string;
  workspaceRoot?: string;
  homeDir?: string;
  fs?: FileSystem;
  workspaceBackend?: FileSystem;
  env?: NodeJS.ProcessEnv;
  stdin?: string | Uint8Array;
  stdout?: (bytes: Uint8Array) => void | Promise<void>;
  stderr?: (bytes: Uint8Array) => void | Promise<void>;
}

function normalizePosixMountPath(targetPath: string): string {
  const normalized = targetPath.split(path.sep).join("/").replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) {
    return `/${normalized}`;
  }
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function tryRealpath(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return targetPath;
  }
}

function isSubpathOrEqual(parentDir: string, candidatePath: string): boolean {
  const normalizedParent = normalizePosixMountPath(parentDir);
  const normalizedCandidate = normalizePosixMountPath(candidatePath);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}/`)
  );
}

function createWorkspaceRealFileSystem(rootPath: string): FileSystem {
  const base = new RealFileSystem({ root: rootPath });
  if (!base.readlink) {
    return base;
  }
  const origReadlink = base.readlink.bind(base);
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "readlink") {
        return async (relPath: string, options?: { signal?: AbortSignal }) => {
          try {
            return await origReadlink(relPath, options);
          } catch (error) {
            if ((error as { code?: string })?.code === "EACCES") {
              const joined = path.join(rootPath, relPath.replace(/^\/+/, ""));
              return await fs.promises.readlink(joined, "utf8");
            }
            throw error;
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function resolveNativeGitRustBinary(): string | undefined {
  if (process.env.SAFE_BASH_GIT_RUST_BIN) {
    const candidate = process.env.SAFE_BASH_GIT_RUST_BIN.trim();
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(currentDir, "../..");
    const releaseBin = path.join(repoRoot, "packages", "git-rust", "target", "release", "git-rust");
    if (fs.existsSync(releaseBin)) {
      return releaseBin;
    }
  } catch {
    // Ignore
  }
  const homeBin = path.join(os.homedir(), ".local", "bin", "git-rust");
  if (fs.existsSync(homeBin)) {
    return homeBin;
  }
  return undefined;
}

async function seedHostGitAndSshMetadata(
  memoryFs: MemoryFileSystem,
  homeDir: string,
  mountedRoots: readonly string[],
  skipHostRead: boolean
): Promise<void> {
  await memoryFs.mkdir("/tmp", { recursive: true });
  await memoryFs.mkdir("/root/.ssh", { recursive: true });

  const normalizedHome = normalizePosixMountPath(homeDir);
  const homeIsMounted = mountedRoots.some((root) => isSubpathOrEqual(root, normalizedHome));
  if (!homeIsMounted && normalizedHome !== "/") {
    await memoryFs.mkdir(`${normalizedHome}/.ssh`, { recursive: true });
  }

  if (skipHostRead) {
    return;
  }

  const candidateFiles = [
    { rel: ".gitconfig", mode: 0o644 },
    { rel: ".ssh/known_hosts", mode: 0o644 },
    { rel: ".ssh/allowed_signers", mode: 0o644 },
    { rel: ".ssh/config", mode: 0o600 }
  ];

  for (const { rel, mode } of candidateFiles) {
    const hostPath = path.join(homeDir, rel);
    let content: Uint8Array;
    try {
      const stat = fs.statSync(hostPath);
      if (!stat.isFile() || stat.size > 256 * 1024) {
        continue;
      }
      content = new Uint8Array(fs.readFileSync(hostPath));
    } catch {
      continue;
    }

    const rootTarget = `/root/${rel}`;
    await memoryFs.writeFile(rootTarget, content, { mode });
    if (!homeIsMounted && normalizedHome !== "/") {
      await memoryFs.writeFile(`${normalizedHome}/${rel}`, content, { mode });
    }
  }
}

export async function createWorkspaceFileSystem(
  options: WorkspaceFileSystemOptions
): Promise<{ fs: FileSystem; cwd: string; workspaceRoot: string }> {
  const resolvedWorkspace = path.resolve(options.workspaceRoot);
  const realWorkspace = options.workspaceBackend
    ? resolvedWorkspace
    : tryRealpath(resolvedWorkspace);
  const resolvedCwd = path.resolve(options.cwd ?? resolvedWorkspace);
  const realCwd = options.workspaceBackend ? resolvedCwd : tryRealpath(resolvedCwd);
  const homeDir = options.homeDir ?? os.homedir();

  const workspaceMountPath = normalizePosixMountPath(resolvedWorkspace);
  const realWorkspaceMountPath = normalizePosixMountPath(realWorkspace);

  if (workspaceMountPath === "/" || realWorkspaceMountPath === "/") {
    return {
      fs: options.workspaceBackend ?? createWorkspaceRealFileSystem("/"),
      cwd: normalizePosixMountPath(resolvedCwd),
      workspaceRoot: "/"
    };
  }

  const workspaceFs =
    options.workspaceBackend ?? createWorkspaceRealFileSystem(realWorkspace);
  const mounts: Record<string, FileSystem> = {
    [workspaceMountPath]: workspaceFs
  };
  if (realWorkspaceMountPath !== workspaceMountPath) {
    mounts[realWorkspaceMountPath] = workspaceFs;
  }

  const cwdMountPath = normalizePosixMountPath(resolvedCwd);
  const realCwdMountPath = normalizePosixMountPath(realCwd);
  const cwdCovered =
    isSubpathOrEqual(workspaceMountPath, cwdMountPath) ||
    isSubpathOrEqual(realWorkspaceMountPath, cwdMountPath) ||
    isSubpathOrEqual(workspaceMountPath, realCwdMountPath) ||
    isSubpathOrEqual(realWorkspaceMountPath, realCwdMountPath);

  if (!cwdCovered && cwdMountPath !== "/" && realCwdMountPath !== "/") {
    if (options.cwdBackend) {
      mounts[cwdMountPath] = options.cwdBackend;
    } else if (!options.workspaceBackend) {
      try {
        if (fs.statSync(realCwd).isDirectory()) {
          const cwdFs = createWorkspaceRealFileSystem(realCwd);
          mounts[cwdMountPath] = cwdFs;
          if (realCwdMountPath !== cwdMountPath) {
            mounts[realCwdMountPath] = cwdFs;
          }
        }
      } catch {
        // Ignore non-existent cwd on host; fall back to workspaceMountPath
      }
    }
  }

  const memoryRoot = new MemoryFileSystem();
  await seedHostGitAndSshMetadata(
    memoryRoot,
    homeDir,
    Object.keys(mounts),
    options.workspaceBackend !== undefined
  );

  const effectiveCwd =
    cwdCovered || mounts[cwdMountPath] !== undefined ? cwdMountPath : workspaceMountPath;

  return {
    fs: new MountFileSystem({
      root: memoryRoot,
      mounts
    }),
    cwd: effectiveCwd,
    workspaceRoot: workspaceMountPath
  };
}

export function parseSafeBashCliArgs(argv: readonly string[]): ParsedSafeBashCliArgs {
  const positionals: string[] = [];
  let command: string | undefined;
  let scriptFile: string | undefined;
  let workspaceRoot: string | undefined;
  let cwd: string | undefined;
  let help = false;
  let version = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      i += 1;
      break;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      i += 1;
      continue;
    }
    if (arg === "--version") {
      version = true;
      i += 1;
      continue;
    }
    if (arg === "--workspace" || arg === "--root") {
      workspaceRoot = argv[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith("--workspace=")) {
      workspaceRoot = arg.slice("--workspace=".length);
      i += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      workspaceRoot = arg.slice("--root=".length);
      i += 1;
      continue;
    }
    if (arg === "--cwd") {
      cwd = argv[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
      i += 1;
      continue;
    }
    if (
      arg === "--login" ||
      arg === "--norc" ||
      arg === "--noprofile" ||
      arg === "--posix"
    ) {
      i += 1;
      continue;
    }
    if (arg === "-c" || /^-[liIs]+c$/.test(arg) || /^-c[liIs]+$/.test(arg)) {
      command = argv[i + 1] ?? "";
      if (i + 3 < argv.length) {
        positionals.push(...argv.slice(i + 3));
      }
      return {
        command,
        positionals,
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(help ? { help } : {}),
        ...(version ? { version } : {})
      };
    }
    if (/^-[liIs]+$/.test(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      scriptFile = arg;
      positionals.push(...argv.slice(i + 1));
      return {
        scriptFile,
        positionals,
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(help ? { help } : {}),
        ...(version ? { version } : {})
      };
    }
    i += 1;
  }

  while (i < argv.length) {
    if (scriptFile === undefined && command === undefined) {
      scriptFile = argv[i];
    } else {
      positionals.push(argv[i]!);
    }
    i += 1;
  }

  return {
    ...(command !== undefined ? { command } : {}),
    ...(scriptFile !== undefined ? { scriptFile } : {}),
    positionals,
    ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(help ? { help } : {}),
    ...(version ? { version } : {})
  };
}

function quoteShellSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildCarryOverEnv(
  sourceEnv: NodeJS.ProcessEnv,
  cwd: string,
  workspaceRoot: string
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.PWD = cwd;
  env.SAFE_BASH_WORKSPACE_ROOT = workspaceRoot;
  if (!env.HOME) {
    env.HOME = os.homedir() || "/root";
  }
  return env;
}

async function readContextStdinBytes(ctx: CommandContext): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of ctx.stdin) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return new Uint8Array();
  }
  return new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

export async function runSafeBashCli(
  rawArgv: readonly string[],
  options: SafeBashCliOptions = {}
): Promise<number> {
  const parsed = parseSafeBashCliArgs(rawArgv);
  const writeStdout =
    options.stdout ??
    (async (bytes: Uint8Array) => {
      if (!process.stdout.write(bytes)) {
        await once(process.stdout, "drain");
      }
    });
  const writeStderr =
    options.stderr ??
    (async (bytes: Uint8Array) => {
      if (!process.stderr.write(bytes)) {
        await once(process.stderr, "drain");
      }
    });

  if (parsed.help) {
    const helpText =
      "Usage: safe-bash [--workspace <dir>] [--cwd <dir>] [-l] [-i] [-c <script> | <script-file> [args...]]\n";
    await writeStdout(new TextEncoder().encode(helpText));
    return 0;
  }

  if (parsed.version) {
    await writeStdout(new TextEncoder().encode("safe-bash (poe-code)\n"));
    return 0;
  }

  const baseEnv = options.env ?? process.env;
  const hostCwd = options.cwd ?? parsed.cwd ?? process.cwd();
  const hostWorkspaceRoot =
    options.workspaceRoot ??
    parsed.workspaceRoot ??
    baseEnv.SAFE_BASH_WORKSPACE_ROOT ??
    hostCwd;

  const isHostBacked = options.fs === undefined && options.workspaceBackend === undefined;
  const {
    fs: workspaceFs,
    cwd,
    workspaceRoot
  } = options.fs
    ? {
        fs: options.fs,
        cwd: normalizePosixMountPath(hostCwd),
        workspaceRoot: normalizePosixMountPath(hostWorkspaceRoot)
      }
    : await createWorkspaceFileSystem({
        workspaceRoot: hostWorkspaceRoot,
        cwd: hostCwd,
        homeDir: options.homeDir,
        workspaceBackend: options.workspaceBackend
      });

  let source = parsed.command;
  if (source === undefined && parsed.scriptFile !== undefined) {
    const resolvedScriptPath = path.isAbsolute(parsed.scriptFile)
      ? normalizePosixMountPath(parsed.scriptFile)
      : normalizePosixMountPath(path.resolve(cwd, parsed.scriptFile));
    try {
      const bytes = await workspaceFs.readFile(resolvedScriptPath);
      source = new TextDecoder().decode(bytes);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await writeStderr(new TextEncoder().encode(`safe-bash: ${parsed.scriptFile}: ${msg}\n`));
      return 127;
    }
  }

  if (source === undefined) {
    if (typeof options.stdin === "string") {
      source = options.stdin;
    } else if (options.stdin instanceof Uint8Array) {
      source = new TextDecoder().decode(options.stdin);
    } else if (!process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      source = Buffer.concat(chunks).toString("utf8");
    } else {
      source = "";
    }
  }

  if (parsed.positionals.length > 0) {
    const quotedArgs = parsed.positionals.map(quoteShellSingle).join(" ");
    source = `set -- ${quotedArgs}\n${source}`;
  }

  const env = buildCarryOverEnv(baseEnv, cwd, workspaceRoot);

  const nativeGitRust = isHostBacked ? resolveNativeGitRustBinary() : undefined;
  const shell = new Shell({
    fs: workspaceFs,
    cwd,
    env,
  }).use(agentCommands());
  if (!nativeGitRust) {
    shell.use(gitCommands());
  }
  shell.use({
    name: "safe-bash-cli-git",
    setup(host) {
      if (nativeGitRust) {
        const executeNativeGitRust = async (ctx: CommandContext): Promise<{ exitCode: number }> => {
          const stdinBytes = await readContextStdinBytes(ctx);
          const res = spawnSync(nativeGitRust, [...ctx.args], {
            cwd: ctx.cwd,
            env: { ...ctx.env, PWD: ctx.cwd },
            input: stdinBytes
          });
          if (res.stdout && res.stdout.byteLength > 0) {
            await ctx.stdout.write(new Uint8Array(res.stdout));
          }
          if (res.stderr && res.stderr.byteLength > 0) {
            await ctx.stderr.write(new Uint8Array(res.stderr));
          }
          return { exitCode: res.status ?? 1 };
        };
        host.commands.register(
          {
            name: "git",
            description: "Git repositories in the workspace (git-rust)",
            execute: executeNativeGitRust
          },
          { replace: true }
        );
        host.commands.register(
          {
            name: "git-rust",
            description: "Git repositories in the workspace (git-rust)",
            execute: executeNativeGitRust
          },
          { replace: true }
        );
      } else if (!host.commands.has("git-rust")) {
        host.commands.register({
          name: "git-rust",
          description: "Git repositories in the virtual filesystem",
          execute(ctx) {
            return host.commands.get("git")!.execute(ctx);
          }
        });
      }
    }
  });

  try {
    const result = await shell.exec(source, {
      ...(options.stdin !== undefined && parsed.command !== undefined
        ? { stdin: options.stdin }
        : {}),
      stdout: {
        async write(bytes) {
          await writeStdout(bytes);
        }
      },
      stderr: {
        async write(bytes) {
          await writeStderr(bytes);
        }
      }
    });
    return result.exitCode;
  } finally {
    await shell.dispose();
  }
}

export async function safeBashMain(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const exitCode = await runSafeBashCli(argv);
  process.exitCode = exitCode;
}
