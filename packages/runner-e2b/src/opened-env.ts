import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { E2bRuntime } from "@poe-code/poe-code-config";
import {
  downloadWorkspace as downloadTransferredWorkspace,
  uploadWorkspace as uploadTransferredWorkspace,
  type LogStreamFs,
  type OpenSpec,
  type OpenedEnv,
  type RunHandle,
  type RunSpec,
  type WorkspaceTransferFileSystem
} from "@poe-code/agent-harness-tools";
import { createE2bJobHandle, createE2bLogStreamFs } from "./job-handle.js";
import {
  toArrayBuffer,
  type E2bCommandHandle,
  type E2bSandbox
} from "./sdk.js";

interface DetachedJobContext {
  id: string;
  tool: string;
  argv: string[];
}

export interface E2bOpenedEnv extends OpenedEnv {
  fs: LogStreamFs;
  setDetachedJobContext(context: DetachedJobContext): void;
}

export function createOpenedE2bEnv(input: {
  sandbox: E2bSandbox;
  spec: OpenSpec;
  runtime: E2bRuntime;
  reattachContext?: Record<string, unknown>;
}): E2bOpenedEnv {
  const hostWorkspaceDir = path.resolve(input.spec.cwd);
  const sandboxWorkspaceDir = normalizeSandboxWorkspaceDir(input.runtime.workspace_dir);
  const workspaceTransferEnv = {
    cwd: input.spec.cwd,
    uploadDir: "/tmp/poe-workspace-transfer",
    workspaceDir: sandboxWorkspaceDir,
    remoteFs: createE2bWorkspaceFileSystem(input.sandbox)
  };
  let lastProcess: { started: Promise<E2bCommandHandle> } | null = null;
  let detachedJobContext: DetachedJobContext | null = null;
  const mapWorkspaceCwd = (cwd: string | undefined): string | undefined => {
    if (cwd === undefined) {
      return undefined;
    }
    if (!path.isAbsolute(cwd)) {
      return cwd;
    }
    const resolvedCwd = path.resolve(cwd);
    const relativeCwd = path.relative(hostWorkspaceDir, resolvedCwd);
    if (relativeCwd === "") {
      return sandboxWorkspaceDir;
    }
    if (!relativeCwd.startsWith("..") && !path.isAbsolute(relativeCwd)) {
      return path.posix.join(sandboxWorkspaceDir, ...relativeCwd.split(path.sep));
    }
    return cwd;
  };

  const attachedJobId = (input.spec as OpenSpec & { detachedJobId?: string }).detachedJobId;
  const env: E2bOpenedEnv = {
    id: input.sandbox.sandboxId,
    ...(input.reattachContext === undefined ? {} : { reattachContext: input.reattachContext }),
    job: attachedJobId
      ? createE2bJobHandle({
          sandbox: input.sandbox,
          envId: input.sandbox.sandboxId,
          jobId: attachedJobId,
          tool: input.spec.jobLabel.tool,
          argv: input.spec.jobLabel.argv,
          preserveAfterExitHours: input.runtime.preserve_after_exit_hours ?? 24
        })
      : null,
    fs: createE2bLogStreamFs(input.sandbox),
    setDetachedJobContext(context) {
      detachedJobContext = context;
    },
    async uploadWorkspace() {
      if (input.spec.runner?.sync === "none") {
        return { files: 0, bytes: 0, skipped: [] };
      }
      return uploadTransferredWorkspace(workspaceTransferEnv, {
        runner: input.spec.runner,
        workspaceExclude: input.spec.uploadIgnoreFiles
      });
    },
    async downloadWorkspace(opts) {
      if (input.spec.runner?.sync === "upload" || input.spec.runner?.sync === "none") {
        return { files: 0, bytes: 0, conflicts: [] };
      }
      return downloadTransferredWorkspace(workspaceTransferEnv, opts);
    },
    exec(spec) {
      if (spec.signal?.aborted === true) {
        return createCancelledRunHandle(spec);
      }
      const handle = runE2bCommand(input.sandbox, {
        ...spec,
        cwd: mapWorkspaceCwd(spec.cwd),
        env: resolveSandboxCommandEnv(spec.env)
      });
      lastProcess = { started: handle.started };
      return handle;
    },
    async detach() {
      if (detachedJobContext === null) {
        throw new Error("Cannot detach E2B environment before a job context is registered.");
      }
      if (lastProcess === null) {
        throw new Error("Cannot detach E2B environment before a command is running.");
      }
      const command = await lastProcess.started;
      const preserveAfterExitHours = input.runtime.preserve_after_exit_hours ?? 24;
      const preserveMs = preserveAfterExitHours * 60 * 60 * 1000;
      if (preserveMs > 0) {
        await input.sandbox.setTimeout(preserveMs);
      }
      return createE2bJobHandle({
        sandbox: input.sandbox,
        envId: input.sandbox.sandboxId,
        jobId: detachedJobContext.id,
        tool: detachedJobContext.tool,
        argv: detachedJobContext.argv,
        pid: command.pid,
        preserveAfterExitHours
      });
    },
    shell() {
      const shellSpec = input.spec.shellSpec;
      const command = shellSpec?.command ?? input.spec.env.SHELL ?? "sh";
      return runE2bPty(input.sandbox, {
        command,
        ...(shellSpec?.args ? { args: shellSpec.args } : {}),
        cwd: mapWorkspaceCwd(shellSpec?.cwd ?? input.spec.cwd),
        env: resolveSandboxCommandEnv(
          shellSpec && "env" in shellSpec ? shellSpec.env : input.spec.env
        ),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true,
        signal: shellSpec?.signal
      }, shellSpec === undefined ? undefined : shellCommand([command, ...(shellSpec.args ?? [])]));
    },
    async close() {
      await input.sandbox.kill();
    }
  };

  return env;
}

function runE2bCommand(
  sandbox: E2bSandbox,
  spec: RunSpec
): RunHandle & { e2bHandle: E2bCommandHandle | null; started: Promise<E2bCommandHandle> } {
  const stdout = spec.stdout === "inherit" ? null : new PassThrough();
  const stderr = spec.stderr === "inherit" ? null : new PassThrough();
  let e2bHandle: E2bCommandHandle | null = null;
  let killRequested = false;
  const command = shellCommand([spec.command, ...(spec.args ?? [])]);
  const started = sandbox.commands.run(command, {
    background: true,
    cwd: spec.cwd,
    envs: spec.env,
    stdin: spec.stdin === "pipe" || spec.stdin === "inherit",
    onStdout(data) {
      stdout?.write(data);
      if (spec.stdout === "inherit") {
        process.stdout.write(data);
      }
    },
    onStderr(data) {
      stderr?.write(data);
      if (spec.stderr === "inherit") {
        process.stderr.write(data);
      }
    }
  }) as Promise<E2bCommandHandle>;
  const requestKill = () => {
    killRequested = true;
    if (e2bHandle !== null) {
      ignoreAsyncFailure(e2bHandle.kill());
    }
  };
  const cleanupAbort = bindAbortSignal(spec.signal, requestKill);
  const stdin =
    spec.stdin === "pipe" || spec.stdin === "inherit"
      ? new Writable({
          write(chunk, _encoding, callback) {
            started
              .then((handle) =>
                sandbox.commands.sendStdin(
                  handle.pid,
                  Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
                )
              )
              .then(() => callback(), callback);
          },
          final(callback) {
            if (sandbox.commands.closeStdin === undefined) {
              callback();
              return;
            }
            started
              .then((handle) => sandbox.commands.closeStdin!(handle.pid))
              .then(() => callback(), callback);
          }
        })
      : null;
  const cleanupInheritedStdin =
    spec.stdin === "inherit"
      ? bindInheritedStdin(
          (chunk) => {
            void started
              .then((handle) => sandbox.commands.sendStdin(handle.pid, toInputBuffer(chunk)))
              .catch(() => undefined);
          },
          () => {
            if (sandbox.commands.closeStdin !== undefined) {
              void started.then((handle) => sandbox.commands.closeStdin!(handle.pid)).catch(() => undefined);
            }
          }
        )
      : () => {};
  const result = started
    .then((handle) => {
      e2bHandle = handle;
      if (killRequested) {
        ignoreAsyncFailure(handle.kill());
      }
      return handle.wait();
    })
    .then(
      (result) => {
        cleanupAbort();
        cleanupInheritedStdin();
        stdout?.end();
        stderr?.end();
        return { exitCode: result.exitCode ?? 0 };
      },
      (error: unknown) => {
        cleanupAbort();
        cleanupInheritedStdin();
        stdout?.end();
        stderr?.end();
        if (isExitError(error)) {
          return { exitCode: error.exitCode };
        }
        throw error;
      }
    );

  return {
    get pid() {
      return e2bHandle?.pid ?? null;
    },
    stdin: spec.stdin === "pipe" ? stdin : null,
    stdout,
    stderr,
    result,
    kill() {
      requestKill();
    },
    get e2bHandle() {
      return e2bHandle;
    },
    started
  };
}

function createCancelledRunHandle(spec: RunSpec): RunHandle {
  const stdout = spec.stdout === "inherit" ? null : new PassThrough();
  const stderr = spec.stderr === "inherit" ? null : new PassThrough();
  stdout?.end();
  stderr?.end();
  return {
    pid: null,
    stdin: null,
    stdout,
    stderr,
    result: Promise.resolve({ exitCode: 1 }),
    kill() {}
  };
}

function bindAbortSignal(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (signal === undefined) {
    return () => {};
  }

  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function ignoreAsyncFailure(value: unknown): void {
  if (value instanceof Promise) {
    void value.catch(() => undefined);
  }
}

function runE2bPty(sandbox: E2bSandbox, spec: RunSpec, startupCommand?: string): RunHandle {
  if (spec.signal?.aborted === true) {
    return createCancelledRunHandle(spec);
  }

  const stdout = new PassThrough();
  let handleRef: E2bCommandHandle | null = null;
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      if (handleRef === null) {
        callback(new Error("E2B PTY stdin is not ready."));
        return;
      }
      sandbox.pty
        .sendInput(handleRef.pid, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        .then(() => callback(), callback);
    }
  });
  const started = sandbox.pty.create({
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: spec.cwd,
    envs: spec.env,
    onData(data) {
      stdout.write(Buffer.from(data));
      if (spec.stdout === "inherit") {
        process.stdout.write(Buffer.from(data));
      }
    }
  });
  const cleanupAbort = bindAbortSignal(spec.signal, () => {
    if (handleRef !== null) {
      ignoreAsyncFailure(sandbox.pty.kill(handleRef.pid));
      return;
    }
    void started.then((handle) => ignoreAsyncFailure(sandbox.pty.kill(handle.pid)), () => undefined);
  });
  const cleanupInheritedStdin =
    spec.stdin === "inherit"
      ? bindInheritedStdin((chunk) => {
          void started
            .then((handle) => sandbox.pty.sendInput(handle.pid, toInputBuffer(chunk)))
            .catch(() => undefined);
        })
      : () => {};
  const result = started
    .then(async (handle) => {
      handleRef = handle;
      if (startupCommand !== undefined) {
        await sandbox.pty.sendInput(handle.pid, Buffer.from(`exec ${startupCommand}\r`));
      }
      return handle.wait();
    })
    .then(
      (result) => {
        cleanupAbort();
        cleanupInheritedStdin();
        stdout.end();
        return { exitCode: result.exitCode ?? 0 };
      },
      (error: unknown) => {
        cleanupAbort();
        cleanupInheritedStdin();
        stdout.end();
        throw error;
      }
    );

  return {
    get pid() {
      return handleRef?.pid ?? null;
    },
    stdin,
    stdout: spec.stdout === "inherit" ? null : stdout,
    stderr: null,
    result,
    kill() {
      if (handleRef !== null) {
        ignoreAsyncFailure(sandbox.pty.kill(handleRef.pid));
      }
    }
  };
}

function bindInheritedStdin(onData: (chunk: string | Buffer) => void, onEnd?: () => void): () => void {
  process.stdin.on("data", onData);
  if (onEnd !== undefined) {
    process.stdin.on("end", onEnd);
  }
  return () => {
    process.stdin.off("data", onData);
    if (onEnd !== undefined) {
      process.stdin.off("end", onEnd);
    }
  };
}

function toInputBuffer(chunk: string | Buffer): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function shellCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createE2bWorkspaceFileSystem(sandbox: E2bSandbox): WorkspaceTransferFileSystem {
  async function readFile(targetPath: string): Promise<Buffer>;
  async function readFile(targetPath: string, encoding: BufferEncoding): Promise<string>;
  async function readFile(targetPath: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const contents = Buffer.from(await sandbox.files.read(targetPath, { format: "bytes" }));
    return encoding === undefined ? contents : contents.toString(encoding);
  }

  return {
    async mkdir(targetPath) {
      await sandbox.files.makeDir(targetPath);
    },
    async readdir(targetPath) {
      return (await sandbox.files.list(targetPath)).map((entry) => ({
        name: entry.name,
        isFile: () => entry.type === "file",
        isDirectory: () => entry.type === "dir"
      }));
    },
    readFile,
    async writeFile(targetPath, data) {
      await sandbox.files.write(targetPath, typeof data === "string" ? data : toArrayBuffer(data));
    },
    async stat(targetPath) {
      const entry = await sandbox.files.getInfo(targetPath);
      return {
        size: entry.size,
        isFile: () => entry.type === "file",
        isDirectory: () => entry.type === "dir"
      };
    },
    async rename(oldPath, newPath) {
      await sandbox.files.rename(oldPath, newPath);
    },
    async rm(targetPath) {
      await sandbox.files.remove(targetPath);
    }
  };
}

function resolveSandboxCommandEnv(
  env: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (env === undefined) {
    return undefined;
  }
  return {
    ...env,
    HOME: "/home/user"
  };
}

function normalizeSandboxWorkspaceDir(workspaceDir: string | undefined): string {
  const resolvedWorkspaceDir = workspaceDir ?? "/workspace";
  if (!path.posix.isAbsolute(resolvedWorkspaceDir)) {
    throw new Error("E2B runtime workspace_dir must be an absolute sandbox path.");
  }
  let normalized = path.posix.normalize(resolvedWorkspaceDir);
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function isExitError(error: unknown): error is { exitCode: number } {
  return Boolean(
    error &&
    typeof error === "object" &&
    typeof (error as { exitCode?: unknown }).exitCode === "number"
  );
}
