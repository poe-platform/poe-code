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
  optionalCommands,
  createLazyCommands,
  lazyCommandPlugin,
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

export interface SafeBashTelemetryRecord {
  timestamp: string;
  pid: number;
  cwd: string;
  workspaceRoot: string;
  command: string;
  exitCode: number;
  wallMs: number;
  cpuUserMs: number;
  cpuSysMs: number;
  rssBeforeMB: number;
  rssAfterMB: number;
  heapUsedBeforeMB: number;
  heapUsedAfterMB: number;
  arrayBuffersMB: number;
  stdoutBytes: number;
  stderrBytes: number;
  stderrPreview?: string;
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
  onTelemetry?: (record: SafeBashTelemetryRecord) => void | Promise<void>;
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

function getMacOsAliasPaths(mountPath: string): string[] {
  const aliases = new Set<string>([mountPath]);
  for (const prefix of ["/tmp", "/var", "/etc"]) {
    const privatePrefix = `/private${prefix}`;
    if (mountPath === prefix || mountPath.startsWith(`${prefix}/`)) {
      aliases.add(`/private${mountPath}`);
    } else if (mountPath === privatePrefix || mountPath.startsWith(`${privatePrefix}/`)) {
      aliases.add(mountPath.slice("/private".length));
    }
  }
  return [...aliases];
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
      if (prop === "capabilities") {
        return {
          ...target.capabilities,
          atomicFileStaging: true,
          atomicFileMutation: true,
          atomicDirectoryMetadata: true,
          retainedStagingCleanup: true,
          retainedRead: true,
          atomicStagingAncestry: true
        };
      }
      if (prop === "confineExtraction") {
        return async () => receiver;
      }
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
  await memoryFs.mkdir("/bin", { recursive: true });
  await memoryFs.writeFile("/bin/bash", new TextEncoder().encode("bash \"$@\"\n"), { mode: 0o755 });
  await memoryFs.writeFile("/bin/sh", new TextEncoder().encode("sh \"$@\"\n"), { mode: 0o755 });
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
  const mounts: Record<string, FileSystem> = {};
  for (const alias of [
    ...getMacOsAliasPaths(workspaceMountPath),
    ...getMacOsAliasPaths(realWorkspaceMountPath)
  ]) {
    mounts[alias] = workspaceFs;
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
          for (const alias of [
            ...getMacOsAliasPaths(cwdMountPath),
            ...getMacOsAliasPaths(realCwdMountPath)
          ]) {
            mounts[alias] = cwdFs;
          }
        }
      } catch {
        // Ignore non-existent cwd on host; fall back to workspaceMountPath
      }
    }
  }

  if (!options.workspaceBackend) {
    for (const agentRelDir of [".codex", ".agents"]) {
      const candidateDir = path.join(homeDir, agentRelDir);
      try {
        if (fs.statSync(candidateDir).isDirectory()) {
          const candidateMount = normalizePosixMountPath(candidateDir);
          if (!Object.keys(mounts).some((root) => isSubpathOrEqual(root, candidateMount))) {
            mounts[candidateMount] = createWorkspaceRealFileSystem(tryRealpath(candidateDir));
          }
        }
      } catch {
        // Ignore missing host agent config directories
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

  const baseMountFs = new MountFileSystem({
    root: memoryRoot,
    mounts
  });
  const mountFsProxy: FileSystem = new Proxy(baseMountFs, {
    get(target, prop, receiver) {
      if (prop === "confineExtraction") {
        return async () => mountFsProxy;
      }
      if (prop === "capabilitiesFor") {
        return async (targetPath: string, opts?: { signal?: AbortSignal }) => {
          try {
            if (typeof target.capabilitiesFor === "function") {
              return await target.capabilitiesFor(targetPath, opts);
            }
          } catch {
            // Fall through to default capabilities on unmounted synthetic prefix directories
          }
          return target.capabilities;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return {
    fs: mountFsProxy,
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
  env.POE_CODE_SAFE_BASH = "1";
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

  if (source !== undefined && source.includes("__CODEX_SNAPSHOT_OVERRIDE_SET_0=")) {
    const execLineMatch = /\nexec\s+(?:'[^']+'|"[^"]+"|\S+)\s+(?:-[lci]+\s+)+('[\s\S]*'|"([\s\S]*)")\s*$/.exec(source);
    if (execLineMatch) {
      const rawQuoted = execLineMatch[1]!;
      if (rawQuoted.startsWith("'") && rawQuoted.endsWith("'")) {
        source = rawQuoted.slice(1, -1).replace(/'\\''/g, "'");
      }
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

  if (source.includes("__CODEX_SHELL_SNAPSHOT_STATE_")) {
    return 1;
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
  })
    .use(agentCommands())
    .use(
      optionalCommands({
        replace: true,
        families: [
          "ffmpeg",
          "imagemagick",
          "sips",
          "csvkit",
          "ssconvert",
          "soffice",
          "pandoc",
          "pdfinfo",
          "pdftotext",
          "pdfimages",
          "pdftoppm",
          "pdftk",
          "qpdf",
          "wkhtmltopdf",
          "gh"
        ]
      })
    )
    .use(
      lazyCommandPlugin(
        "safe-bash-cli-lazy-extras",
        [
          ...createLazyCommands([{ name: "sqlite3", description: "Command-line interface for SQLite version 3" }], async () => {
            const m = await import("safe-bash-command-sqlite3");
            return () => m.createSqlite3Commands({ replace: true });
          }),
          ...createLazyCommands([{ name: "csvcut", description: "Filter and truncate CSV files" }], async () => {
            const m = await import("@poe-platform/safe-bash");
            return () => [m.createCsvcutCommand()];
          }),
          ...createLazyCommands([{ name: "csvgrep", description: "Search CSV files by cell pattern" }], async () => {
            const m = await import("@poe-platform/safe-bash");
            return () => [m.createCsvgrepCommand()];
          }),
          ...createLazyCommands([{ name: "xan", description: "CSV magician" }], async () => {
            const m = await import("safe-bash-command-xan");
            return () => m.createXanCommands({ replace: true });
          }),
          ...createLazyCommands([{ name: "yq", description: "YAML, JSON, XML, CSV and TOML processor" }], async () => {
            const m = await import("safe-bash-command-yq/mike");
            return () => m.createMikeYqCommands({ replace: true });
          }),
          ...createLazyCommands([{ name: "exiftool", description: "Read and write meta information in files" }], async () => {
            const m = await import("safe-bash-command-exiftool");
            return () => m.createExiftoolCommands({ replace: true });
          }),
          ...createLazyCommands([{ name: "htmlq", description: "Query HTML documents with CSS selectors" }], async () => {
            const m = await import("@poe-platform/safe-bash");
            return () => [m.createHtmlqCommand()];
          }),
          ...createLazyCommands([{ name: "mdq", description: "Query Markdown documents" }], async () => {
            const m = await import("@poe-platform/safe-bash");
            return () => [m.createMdqCommand()];
          }),
          ...createLazyCommands([{ name: "openssl", description: "OpenSSL cryptography toolkit" }], async () => {
            const m = await import("@poe-platform/safe-bash");
            return () => m.createOpensslCommands({ replace: true });
          }),
          ...createLazyCommands(
            [
              { name: "ssh", description: "OpenSSH remote login client" },
              { name: "ssh-keygen", description: "OpenSSH authentication key utility" },
              { name: "ssh-keyscan", description: "Gather SSH public keys" },
              { name: "scp", description: "OpenSSH secure file copy" },
              { name: "sftp", description: "OpenSSH secure file transfer" }
            ],
            async () => {
              const m = await import("@poe-platform/safe-bash");
              return () => m.createSshCommands({ replace: true });
            }
          ),
          ...createLazyCommands(
            [
              { name: "gpg", description: "OpenPGP encryption and signing tool" },
              { name: "gpgv", description: "Verify OpenPGP signatures" }
            ],
            async () => {
              const m = await import("@poe-platform/safe-bash");
              return () => m.createGpgCommands({ replace: true });
            }
          )
        ],
        true
      )
    );
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

  const memBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const startWallMs = performance.now();
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stderrSampleChunks: Uint8Array[] = [];
  let stderrSampleLen = 0;
  let exitCode = 1;

  try {
    const result = await shell.exec(source, {
      ...(options.stdin !== undefined && parsed.command !== undefined
        ? { stdin: options.stdin }
        : {}),
      stdout: {
        async write(bytes) {
          stdoutBytes += bytes.byteLength;
          await writeStdout(bytes);
        }
      },
      stderr: {
        async write(bytes) {
          stderrBytes += bytes.byteLength;
          if (stderrSampleLen < 512) {
            const slice = bytes.subarray(0, Math.min(bytes.byteLength, 512 - stderrSampleLen));
            stderrSampleChunks.push(slice.slice());
            stderrSampleLen += slice.byteLength;
          }
          await writeStderr(bytes);
        }
      }
    });
    exitCode = result.exitCode;
    return exitCode;
  } finally {
    const wallMs = Number((performance.now() - startWallMs).toFixed(2));
    const cpuDelta = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage();
    const toMB = (n: number) => Number((n / (1024 * 1024)).toFixed(2));
    const telemetryLogPath = baseEnv.SAFE_BASH_TELEMETRY_LOG;
    if (options.onTelemetry || telemetryLogPath) {
      const stderrPreview =
        stderrSampleLen > 0
          ? Buffer.concat(stderrSampleChunks.map((c) => Buffer.from(c))).toString("utf8")
          : undefined;
      const record: SafeBashTelemetryRecord = {
        timestamp: new Date().toISOString(),
        pid: process.pid,
        cwd,
        workspaceRoot,
        command: source,
        exitCode,
        wallMs,
        cpuUserMs: Number((cpuDelta.user / 1000).toFixed(2)),
        cpuSysMs: Number((cpuDelta.system / 1000).toFixed(2)),
        rssBeforeMB: toMB(memBefore.rss),
        rssAfterMB: toMB(memAfter.rss),
        heapUsedBeforeMB: toMB(memBefore.heapUsed),
        heapUsedAfterMB: toMB(memAfter.heapUsed),
        arrayBuffersMB: toMB(memAfter.arrayBuffers),
        stdoutBytes,
        stderrBytes,
        ...(stderrPreview !== undefined ? { stderrPreview } : {})
      };
      if (options.onTelemetry) {
        await options.onTelemetry(record);
      }
      if (telemetryLogPath) {
        try {
          fs.appendFileSync(telemetryLogPath, `${JSON.stringify(record)}\n`, "utf8");
        } catch {
          // Best-effort telemetry file append
        }
      }
    }
    await shell.dispose();
  }
}

export async function safeBashMain(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const exitCode = await runSafeBashCli(argv);
  process.exitCode = exitCode;
}
