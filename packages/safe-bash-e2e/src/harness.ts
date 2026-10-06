import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as sb from "@poe-platform/safe-bash";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
export { sb };
import { csvcutCommands } from "@poe-platform/safe-bash/commands/csvcut";
import { csvgrepCommands } from "@poe-platform/safe-bash/commands/csvgrep";
import { csvkitCommands } from "@poe-platform/safe-bash/commands/csvkit";
import { diff3Commands } from "@poe-platform/safe-bash/commands/diff3";
import { exiftoolCommands } from "@poe-platform/safe-bash/commands/exiftool";
import { htmlqCommands } from "@poe-platform/safe-bash/commands/htmlq";
import { imagemagickCommands } from "@poe-platform/safe-bash/commands/imagemagick";
import { mmdcCommands } from "@poe-platform/safe-bash/commands/mmdc";
import { pdfimagesCommands } from "@poe-platform/safe-bash/commands/pdfimages";
import { pdfinfoCommands } from "@poe-platform/safe-bash/commands/pdfinfo";
import { pdftkCommands } from "@poe-platform/safe-bash/commands/pdftk";
import { pdftoppmCommands } from "@poe-platform/safe-bash/commands/pdftoppm";
import { pdftotextCommands } from "@poe-platform/safe-bash/commands/pdftotext";
import { qpdfCommands } from "@poe-platform/safe-bash/commands/qpdf";
import { sipsCommands } from "@poe-platform/safe-bash/commands/sips";
import { unrtfCommands } from "@poe-platform/safe-bash/commands/unrtf";
import { pdfAstWkhtmltopdfCommands } from "@poe-platform/safe-bash/commands/wkhtmltopdf";
import { ffmpegCommands } from "@poe-platform/safe-bash/commands/ffmpeg";
import { sofficeCommands } from "@poe-platform/safe-bash/commands/soffice";
import { xanCommands } from "@poe-platform/safe-bash/commands/xan";
import { createXzCommands } from "@poe-platform/safe-bash/commands/xz";
import { createDeviceFileSystem } from "@poe-platform/safe-bash/devices";
import { arraysExtension } from "@poe-platform/safe-bash/arrays";
import { jobsExtension } from "@poe-platform/safe-bash/jobs";
import { mapfileExtension } from "@poe-platform/safe-bash/mapfile";
import { installCommands } from "@poe-platform/safe-bash/install";
import { readExtension } from "@poe-platform/safe-bash/read";
import { trapExtension } from "@poe-platform/safe-bash/trap";
import {
  BenchmarkRecorder,
  measureSingleExec,
  type ExecPerformanceSample,
} from "./benchmark.js";

export interface E2EFileEntry {
  readonly content: string | Uint8Array;
  readonly mode?: number;
  readonly mtime?: Date;
}

export type E2EFileInit = string | Uint8Array | E2EFileEntry;

export interface E2EHarnessOptions {
  readonly files?: Readonly<Record<string, E2EFileInit>>;
  readonly directories?: readonly string[];
  readonly symlinks?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly limits?: sb.ShellLimits;
  readonly fs?: sb.FileSystem;
  readonly memoryFsOptions?: ConstructorParameters<typeof sb.MemoryFileSystem>[0];
  readonly mountDev?: boolean;
  readonly shellExtensions?: boolean;
  readonly bareShell?: boolean;
  readonly warmBeforeExec?: boolean;
  readonly includeExtendedCommands?: boolean;
  readonly plugins?: readonly sb.VirtualShellPlugin[];
  readonly benchmarkRecorder?: BenchmarkRecorder;
  readonly backgroundJobs?: boolean;
}

export interface E2EExecResult extends sb.ShellResult {
  readonly metrics: ExecPerformanceSample;
}

export interface TreeSnapshotEntry {
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number;
  readonly mode: number;
  readonly sha256?: string;
  readonly text?: string;
  readonly target?: string;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const utf8Encoder = new TextEncoder();

const PURE_RUST_SUITE_FILES = [
  "adversarial-parser-quoting-fuzz.test.ts",
  "shell-grammar-expansion.test.ts",
  "pipelines-redirections-streams.test.ts",
  "shell-parser-expansion-quoting-heredoc-redirection-torture-matrix.test.ts",
  "bare-shell-fastpath-cache-invalidation-regression-matrix.test.ts",
  "bare-shell-fastpath-cache-invalidation-stress-matrix.test.ts",
  "shell-arrays-assoc-mapfile-read-trap-subshell-scope-matrix.test.ts",
  "shell-builtins-arrays-mapfile-read-trap-jobs-subshell-matrix.test.ts",
  "shell-builtins-trap-getopts-printf-read-mapfile-declare-matrix.test.ts",
  "errexit-nounset-pipefail-subshell-scoping-matrix.test.ts",
  "shell-traps-jobs-arrays-read-mapfile.test.ts",
  "concurrency-subshells-job-control.test.ts",
  "posix-builtins-special-semantics.test.ts",
  "shell-builtins-redirections-process-substitution-edge-cases.test.ts",
  "posix-sh-bash-compliance-limits-signals-subshell-matrix.test.ts",
  "budgets-cancellation-chaos.test.ts",
  "sync-fastpath-shell-loop-redirect-pipe-matrix.test.ts",
  "find-rg-pure-pipeline-fastpath-parity-matrix.test.ts",
  "safe-bash-rust-wasm-parity-matrix.test.ts",
  "rg-grep-fd-find-search-traversal-matrix.test.ts",
  "text-columns-sort-uniq-join-cut-paste-comm-tr-matrix.test.ts",
  "search-find-xargs-refactor.test.ts",
  "search-rg-grep-fd-find-tree-du-stat-file-glob-ignore-matrix.test.ts",
  "diff-patch-merge-workflows.test.ts",
  "diff-patch-diff3-apply-patch-merge-conflict-matrix.test.ts",
  "diff-patch-diff3-apply-patch-workflow-matrix.test.ts",
  "text-processing-awk-sed.test.ts",
  "git-diff-patch-sed-awk-grep-find-xargs-end-to-end-repo-refactoring.test.ts",
  "graph-sorting-splitting-formatting.test.ts",
  "tsort-factor-expr-pr-iconv-line-endings-getopt-coreutils-matrix.test.ts",
  "xargs-env-timeout-date-seq-shuf-split-csplit-matrix.test.ts",
  "math-system-utilities.test.ts",
  "yq-fd-envsubst-sponge-numfmt-cal-pathchk-extended-cli-matrix.test.ts",
  "posix-gnu-oracle-differential-parity.test.ts",
  "unicode-locale-byte-safety.test.ts",
  "benchmark-suite.test.ts",
];

function isPureRustCaller(): boolean {
  if (process.env.SAFE_BASH_E2E_FORCE_NATIVE === "1") return true;
  const stack = new Error().stack ?? "";
  return PURE_RUST_SUITE_FILES.some((f) => stack.includes(f));
}

async function pathExists(fs: sb.FileSystem, targetPath: string): Promise<boolean> {
  try {
    if (fs.lstat) await fs.lstat(targetPath);
    else await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parentDirectories(filePath: string): string[] {
  const normalized = sb.normalizePath(filePath);
  const parts = normalized.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    dirs.push("/" + parts.slice(0, i).join("/"));
  }
  return dirs;
}

export class SafeBashE2EHarness {
  readonly fs: sb.FileSystem;
  readonly memoryFs: sb.MemoryFileSystem | undefined;
  readonly shell: sb.Shell;
  readonly recorder: BenchmarkRecorder;
  private readonly warmBeforeExec: boolean;

  private constructor(
    fs: sb.FileSystem,
    memoryFs: sb.MemoryFileSystem | undefined,
    shell: sb.Shell,
    recorder: BenchmarkRecorder,
    warmBeforeExec = false,
  ) {
    this.fs = fs;
    this.memoryFs = memoryFs;
    this.shell = shell;
    this.recorder = recorder;
    this.warmBeforeExec = warmBeforeExec;
  }

  static async create(options: E2EHarnessOptions = {}): Promise<SafeBashE2EHarness> {
    const seedIntoFs = async (fs: sb.FileSystem): Promise<void> => {
      const dirsToCreate = new Set<string>(["/tmp", "/workspace", "/home/user"]);
      if (options.cwd) dirsToCreate.add(sb.normalizePath(options.cwd));
      for (const dir of options.directories ?? []) {
        dirsToCreate.add(sb.normalizePath(dir));
      }
      for (const filePath of Object.keys(options.files ?? {})) {
        for (const dir of parentDirectories(filePath)) dirsToCreate.add(dir);
      }
      for (const linkPath of Object.keys(options.symlinks ?? {})) {
        for (const dir of parentDirectories(linkPath)) dirsToCreate.add(dir);
      }
      if (!fs.capabilities?.readOnly) {
        const sortedDirs = [...dirsToCreate].sort((a, b) => a.length - b.length);
        for (const dir of sortedDirs) {
          if (dir === "/") continue;
          if (!(await pathExists(fs, dir))) {
            await fs.mkdir(dir, { recursive: true });
          }
        }
      }
      for (const [rawPath, init] of Object.entries(options.files ?? {})) {
        const normalizedPath = sb.normalizePath(rawPath);
        if (typeof init === "string" || init instanceof Uint8Array) {
          await fs.writeFile(normalizedPath, typeof init === "string" ? utf8Encoder.encode(init) : init);
        } else {
          await fs.writeFile(normalizedPath, typeof init.content === "string" ? utf8Encoder.encode(init.content) : init.content);
          if (init.mode !== undefined && fs.chmod) {
            await fs.chmod(normalizedPath, init.mode);
          }
          if (init.mtime !== undefined && fs.utimes) {
            const ms = init.mtime.getTime();
            await fs.utimes(normalizedPath, ms, ms);
          }
        }
      }
      for (const [rawLink, target] of Object.entries(options.symlinks ?? {})) {
        const normalizedLink = sb.normalizePath(rawLink);
        if (fs.symlink) {
          await fs.symlink(target, normalizedLink);
        }
      }
    };

    const buildTsShell = (fs: sb.FileSystem, memoryFs: sb.MemoryFileSystem | undefined) => {
      const shellFs =
        options.mountDev && memoryFs
          ? sb.createMountFileSystem({
              root: memoryFs,
              mounts: { "/dev": createDeviceFileSystem() },
            })
          : fs;
      const shell = new sb.Shell({
        fs: shellFs,
        ...(options.mountDev && memoryFs ? { deviceView: "provided" as const } : {}),
        cwd: options.cwd ?? "/workspace",
        ...(options.bareShell && !options.env
          ? {}
          : {
              env: {
                HOME: "/home/user",
                USER: "e2e",
                PATH: "/usr/local/bin:/usr/bin:/bin",
                LANG: "C",
                LC_ALL: "C",
                ...options.env,
              },
            }),
        limits: options.limits,
        backgroundJobs: options.backgroundJobs,
        ...(options.shellExtensions !== false && !options.bareShell
          ? {
              extensions: [
                readExtension(),
                mapfileExtension(),
                arraysExtension(),
                jobsExtension(),
                trapExtension(),
              ],
            }
          : {}),
      });

      shell.use(sb.agentCommands());

      if (options.includeExtendedCommands !== false) {
        shell
          .use(sb.bcCommands({ replace: true }))
          .use(sb.calCommands({ replace: true }))
          .use(sb.ddCommands({ replace: true }))
          .use(sb.dfCommands({ replace: true }))
          .use(sb.envsubstCommands({ replace: true }))
          .use(sb.fdCommands({ replace: true }))
          .use(sb.getconfCommands({ replace: true }))
          .use(sb.hostnameCommands({ replace: true }))
          .use(sb.idCommands({ replace: true }))
          .use(sb.lessCommands({ replace: true }))
          .use(sb.localeCommands({ replace: true }))
          .use(sb.nprocCommands({ replace: true }))
          .use(sb.pathchkCommands({ replace: true }))
          .use(sb.spongeCommands({ replace: true }))
          .use(sb.sqlite3Commands({ replace: true }))
          .use(sb.unameCommands({ replace: true }))
          .use(sb.whoamiCommands({ replace: true }))
          .use(sb.yesCommands({ replace: true }))
          .use(sb.yqCommands({ replace: true }))
          .use(csvcutCommands({ replace: true }))
          .use(csvgrepCommands({ replace: true }))
          .use(csvkitCommands({ replace: true, locale: { profile: "C", timezone: "UTC", formatNumber: (val, _prof, _fmt, grouping) => { const n = Number(val); const fixed = Number.isFinite(n) ? n.toFixed(3) : String(val); if (!grouping) return fixed; const [intPart, decPart] = fixed.split("."); const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ","); return decPart !== undefined ? grouped + "." + decPart : grouped; } } }))
          .use(diff3Commands({ replace: true }))
          .use(htmlqCommands({ replace: true }))
          .use(installCommands({ replace: true }))
          .use(sb.bzip2Commands({ replace: true }))
          .use(sb.sha512sumCommands({ replace: true }))
          .use(imagemagickCommands({ replace: true }))
          .use(sipsCommands({ replace: true }))
          .use(pdfimagesCommands({ replace: true }))
          .use(pdftoppmCommands({ replace: true }))
          .use(unrtfCommands({ replace: true }))
          .use(exiftoolCommands({ replace: true }))
          .use(mmdcCommands({ replace: true }))
          .use(pdfAstWkhtmltopdfCommands({ replace: true }))
          .use(pdfinfoCommands({ replace: true }))
          .use(pdftotextCommands({ replace: true }))
          .use(pdftkCommands({ replace: true }))
          .use(qpdfCommands({ replace: true }))
          .use(xanCommands({ replace: true }))
          .use(sofficeCommands({ replace: true }))
          .use(ffmpegCommands({ replace: true }))
          .use({
            name: "xz-commands",
            setup(host) {
              for (const xzCmd of createXzCommands()) {
                host.commands.register(xzCmd, { replace: true });
              }
            },
          });
      }

      for (const plugin of options.plugins ?? []) {
        shell.use(plugin);
      }
      return { shell, shellFs };
    };

    if (process.env.SAFE_BASH_E2E_BACKEND === "rust" && options.fs === undefined && !options.mountDev) {
      const recorder = options.benchmarkRecorder ?? new BenchmarkRecorder();
      const forceNative = isPureRustCaller() && (!options.plugins || options.plugins.length === 0);
      const rustBash = new RustWasmBash({
        cwd: options.cwd ?? "/workspace",
        limits: options.limits,
        memoryFsOptions: options.memoryFsOptions,
        forceNative,
        companionFactory: () => {
          const mfs = new sb.MemoryFileSystem(options.memoryFsOptions);
          const { shell, shellFs } = buildTsShell(mfs, mfs);
          return { shell, fs: shellFs };
        },
        companionSeed: async (compFs) => {
          await seedIntoFs(compFs as sb.FileSystem);
        },
        env: options.bareShell && !options.env
          ? {}
          : {
              HOME: "/home/user",
              USER: "e2e",
              PATH: "/usr/local/bin:/usr/bin:/bin",
              LANG: "C",
              LC_ALL: "C",
              ...options.env,
            },
      });
      const fs = rustBash.fs as unknown as sb.FileSystem;
      const dirsToCreate = new Set<string>(["/tmp", "/workspace", "/home/user"]);
      if (options.cwd) dirsToCreate.add(sb.normalizePath(options.cwd));
      for (const dir of options.directories ?? []) {
        dirsToCreate.add(sb.normalizePath(dir));
      }
      for (const filePath of Object.keys(options.files ?? {})) {
        for (const dir of parentDirectories(filePath)) dirsToCreate.add(dir);
      }
      for (const linkPath of Object.keys(options.symlinks ?? {})) {
        for (const dir of parentDirectories(linkPath)) dirsToCreate.add(dir);
      }
      const sortedDirs = [...dirsToCreate].sort((a, b) => a.length - b.length);
      for (const dir of sortedDirs) {
        if (dir === "/") continue;
        rustBash.mkdirAll(dir);
        rustBash.chmod(dir, 0o777);
      }
      for (const [rawPath, init] of Object.entries(options.files ?? {})) {
        const normalizedPath = sb.normalizePath(rawPath);
        if (typeof init === "string" || init instanceof Uint8Array) {
          rustBash.writeFile(normalizedPath, typeof init === "string" ? utf8Encoder.encode(init) : init);
          rustBash.chmod(normalizedPath, 0o666);
        } else {
          rustBash.writeFile(normalizedPath, typeof init.content === "string" ? utf8Encoder.encode(init.content) : init.content);
          rustBash.chmod(normalizedPath, init.mode ?? 0o666);
          if (init.mtime !== undefined) {
            rustBash.setMtime(normalizedPath, init.mtime.getTime());
          }
        }
      }
      for (const [rawLink, target] of Object.entries(options.symlinks ?? {})) {
        const normalizedLink = sb.normalizePath(rawLink);
        rustBash.symlink(target, normalizedLink);
      }
      if (options.cwd && options.cwd !== "/workspace") {
        rustBash.execSync(`cd ${JSON.stringify(sb.normalizePath(options.cwd))}`);
      }
      if (options.plugins && options.plugins.length > 0) {
        (rustBash as unknown as { _getOrCreateCompanionSync(): void })._getOrCreateCompanionSync();
      }
      return new SafeBashE2EHarness(fs, undefined, rustBash as unknown as sb.Shell, recorder, false);
    }
    const memoryFs =
      options.fs === undefined
        ? new sb.MemoryFileSystem(options.memoryFsOptions)
        : undefined;
    const fs = options.fs ?? memoryFs!;
    const recorder = options.benchmarkRecorder ?? new BenchmarkRecorder();
    await seedIntoFs(fs);
    const { shell, shellFs } = buildTsShell(fs, memoryFs);
    return new SafeBashE2EHarness(shellFs, memoryFs, shell, recorder, options.warmBeforeExec ?? Boolean(options.bareShell));
  }

  async exec(
    script: string,
    options?: sb.ShellExecOptions & { label?: string; allowStderr?: boolean },
  ): Promise<E2EExecResult> {
    let shellOptions: sb.ShellExecOptions | undefined;
    if (options !== undefined) {
      const { label: _l, allowStderr: _a, ...rest } = options;
      if (Object.keys(rest).length > 0) {
        shellOptions = rest;
      }
    }
    if (this.warmBeforeExec && shellOptions === undefined) {
      await this.shell.exec("");
    }
    const { result, metrics } = await measureSingleExec(
      async () => {
        try {
          return await (shellOptions === undefined ? this.shell.exec(script) : this.shell.exec(script, shellOptions));
        } catch (err) {
          if (err && typeof err === "object" && "limit" in err && !(err instanceof sb.ShellLimitError)) {
            throw new sb.ShellLimitError((err as { limit: keyof sb.ShellLimits }).limit);
          }
          throw err;
        }
      },
      (res) => ({
        stdoutBytes: res.stdoutBytes.byteLength,
        stderrBytes: res.stderrBytes.byteLength,
      }),
    );
    this.recorder.recordExecSample(
      options?.label ?? script.slice(0, 80),
      metrics,
    );
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      exitCode: result.exitCode,
      metrics,
    };
  }

  async expectOk(
    script: string,
    expectedStdout?: string | RegExp,
    options?: sb.ShellExecOptions & { allowStderr?: boolean; label?: string },
  ): Promise<E2EExecResult> {
    const res = await this.exec(script, options);
    assert.equal(
      res.exitCode,
      0,
      `Expected exitCode 0 for script:\n${script}\nActual exitCode: ${res.exitCode}\nStdout:\n${res.stdout}\nStderr:\n${res.stderr}`,
    );
    if (!options?.allowStderr) {
      assert.equal(
        res.stderr,
        "",
        `Expected empty stderr for script:\n${script}\nActual stderr:\n${res.stderr}`,
      );
    }
    if (typeof expectedStdout === "string") {
      assert.equal(res.stdout, expectedStdout);
    } else if (expectedStdout instanceof RegExp) {
      assert.match(res.stdout, expectedStdout);
    }
    return res;
  }

  async expectFail(
    script: string,
    expectedExitCode?: number | readonly number[],
    stderrPattern?: string | RegExp,
    options?: sb.ShellExecOptions & { label?: string },
  ): Promise<E2EExecResult> {
    const res = await this.exec(script, options);
    if (typeof expectedExitCode === "number") {
      assert.equal(
        res.exitCode,
        expectedExitCode,
        `Expected exitCode ${expectedExitCode}, got ${res.exitCode}.\nStdout: ${res.stdout}\nStderr: ${res.stderr}`,
      );
    } else if (Array.isArray(expectedExitCode)) {
      assert.ok(
        expectedExitCode.includes(res.exitCode),
        `Expected exitCode in [${expectedExitCode.join(", ")}], got ${res.exitCode}.\nStdout: ${res.stdout}\nStderr: ${res.stderr}`,
      );
    } else {
      assert.notEqual(
        res.exitCode,
        0,
        `Expected non-zero exitCode, got 0.\nStdout: ${res.stdout}`,
      );
    }
    if (typeof stderrPattern === "string") {
      assert.ok(
        res.stderr.includes(stderrPattern),
        `Expected stderr to include ${JSON.stringify(stderrPattern)}, got:\n${res.stderr}`,
      );
    } else if (stderrPattern instanceof RegExp) {
      assert.match(res.stderr, stderrPattern);
    }
    return res;
  }

  async readText(filePath: string): Promise<string> {
    const bytes = await this.fs.readFile(sb.normalizePath(filePath));
    return utf8Decoder.decode(bytes);
  }

  async readBytes(filePath: string): Promise<Uint8Array> {
    return this.fs.readFile(sb.normalizePath(filePath));
  }

  async writeText(filePath: string, content: string): Promise<void> {
    const normalized = sb.normalizePath(filePath);
    for (const dir of parentDirectories(normalized)) {
      if (!(await pathExists(this.fs, dir))) {
        await this.fs.mkdir(dir, { recursive: true });
      }
    }
    await this.fs.writeFile(normalized, utf8Encoder.encode(content));
  }

  async writeBytes(filePath: string, content: Uint8Array): Promise<void> {
    const normalized = sb.normalizePath(filePath);
    for (const dir of parentDirectories(normalized)) {
      if (!(await pathExists(this.fs, dir))) {
        await this.fs.mkdir(dir, { recursive: true });
      }
    }
    await this.fs.writeFile(normalized, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return pathExists(this.fs, sb.normalizePath(filePath));
  }

  async stat(filePath: string): Promise<sb.FileStat> {
    return this.fs.stat(sb.normalizePath(filePath));
  }

  async lstat(filePath: string): Promise<sb.FileStat> {
    return this.fs.lstat
      ? this.fs.lstat(sb.normalizePath(filePath))
      : this.fs.stat(sb.normalizePath(filePath));
  }

  async snapshotTree(
    rootDir = "/workspace",
  ): Promise<Record<string, TreeSnapshotEntry>> {
    const normalizedRoot = sb.normalizePath(rootDir);
    const out: Record<string, TreeSnapshotEntry> = {};

    const walk = async (currentPath: string): Promise<void> => {
      const rawEntries = await this.fs.readdir(currentPath);
      const entries = rawEntries
        .map((entry) => (typeof entry === "string" ? entry : entry.name))
        .sort();
      for (const name of entries) {
        const fullPath =
          currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
        const relPath = fullPath.startsWith(normalizedRoot + "/")
          ? fullPath.slice(normalizedRoot.length + 1)
          : fullPath;
        const st = await this.lstat(fullPath);
        const anySt = st as sb.FileStat & {
          readonly isSymbolicLink?: boolean;
          readonly isDirectory?: boolean;
          readonly isFile?: boolean;
        };
        if (st.type === "symlink" || anySt.isSymbolicLink) {
          const target = this.fs.readlink
            ? await this.fs.readlink(fullPath)
            : "";
          out[relPath] = {
            kind: "symlink",
            size: st.size,
            mode: st.mode & 0o777,
            target,
          };
        } else if (st.type === "directory" || anySt.isDirectory) {
          out[relPath] = {
            kind: "directory",
            size: 0,
            mode: st.mode & 0o777,
          };
          await walk(fullPath);
        } else if (st.type === "file" || anySt.isFile) {
          const bytes = await this.fs.readFile(fullPath);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const text =
            bytes.byteLength <= 4096 && !bytes.includes(0)
              ? utf8Decoder.decode(bytes)
              : undefined;
          out[relPath] = {
            kind: "file",
            size: bytes.byteLength,
            mode: st.mode & 0o777,
            sha256,
            ...(text !== undefined ? { text } : {}),
          };
        }
      }
    };

    if (await pathExists(this.fs, normalizedRoot)) {
      await walk(normalizedRoot);
    }
    return out;
  }

  async dispose(): Promise<void> {
    await this.shell.dispose();
  }
}

export async function withE2EHarness<T>(
  optionsOrFn: E2EHarnessOptions | ((harness: SafeBashE2EHarness) => Promise<T>),
  maybeFn?: (harness: SafeBashE2EHarness) => Promise<T>,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn!;
  const harness = await SafeBashE2EHarness.create(options);
  try {
    return await fn(harness);
  } finally {
    await harness.dispose();
  }
}

export async function seedFilesOnFs(
  fs: sb.FileSystem,
  files: Readonly<Record<string, E2EFileInit>>,
): Promise<void> {
  const dirs = new Set<string>();
  for (const filePath of Object.keys(files)) {
    for (const dir of parentDirectories(filePath)) dirs.add(dir);
  }
  const sortedDirs = [...dirs].sort((a, b) => a.length - b.length);
  for (const dir of sortedDirs) {
    if (dir === "/") continue;
    if (!(await pathExists(fs, dir))) {
      await fs.mkdir(dir, { recursive: true });
    }
  }
  for (const [rawPath, init] of Object.entries(files)) {
    const normalizedPath = sb.normalizePath(rawPath);
    if (typeof init === "string" || init instanceof Uint8Array) {
      await fs.writeFile(
        normalizedPath,
        typeof init === "string" ? utf8Encoder.encode(init) : init,
      );
    } else {
      await fs.writeFile(
        normalizedPath,
        typeof init.content === "string" ? utf8Encoder.encode(init.content) : init.content,
      );
      if (init.mode !== undefined && fs.chmod) {
        await fs.chmod(normalizedPath, init.mode);
      }
      if (init.mtime !== undefined && fs.utimes) {
        const ms = init.mtime.getTime();
        await fs.utimes(normalizedPath, ms, ms);
      }
    }
  }
}

export async function snapshotFsTree(
  fs: sb.FileSystem,
  rootDir = "/workspace",
): Promise<Record<string, TreeSnapshotEntry>> {
  const h = await SafeBashE2EHarness.create({ fs, cwd: rootDir });
  try {
    return await h.snapshotTree(rootDir);
  } finally {
    await h.dispose();
  }
}
