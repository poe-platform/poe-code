import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { E2bRuntime } from "@poe-code/poe-code-config";
import type {
  LogStreamFs,
  OpenSpec,
  OpenedEnv,
  RunHandle,
  RunSpec
} from "@poe-code/agent-harness-tools";
import { createHostRunner, type Runner } from "@poe-code/process-runner";
import { createE2bJobHandle, createE2bLogStreamFs } from "./job-handle.js";
import {
  readableToString,
  toArrayBuffer,
  type E2bCommandHandle,
  type E2bCommandResult,
  type E2bSandbox
} from "./sdk.js";

const REMOTE_COMMAND_STDERR_TAIL_SIZE = 30;

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
}): E2bOpenedEnv {
  const hostRunner = input.spec.hostRunner ?? createHostRunner();
  const hostWorkspaceDir = path.resolve(input.spec.cwd);
  const sandboxWorkspaceDir = normalizeSandboxWorkspaceDir(input.runtime.workspace_dir);
  let lastProcess: { started: Promise<E2bCommandHandle> } | null = null;
  let detachedJobContext: DetachedJobContext | null = null;
  const mapWorkspaceCwd = (cwd: string | undefined): string | undefined => {
    if (cwd === undefined) {
      return undefined;
    }
    if (path.isAbsolute(cwd) && path.resolve(cwd) === hostWorkspaceDir) {
      return sandboxWorkspaceDir;
    }
    return cwd;
  };

  const attachedJobId = (input.spec as OpenSpec & { detachedJobId?: string }).detachedJobId;
  const env: E2bOpenedEnv = {
    id: input.sandbox.sandboxId,
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
      const tempDir = mkdtempSync(path.join(tmpdir(), "poe-e2b-upload-"));
      const archivePath = path.join(tempDir, "workspace.tar");
      try {
        await runOrThrow(hostRunner, {
          command: "tar",
          args: [
            ...input.spec.uploadIgnoreFiles.flatMap((ignored) => ["--exclude", ignored]),
            "-cf",
            archivePath,
            "-C",
            input.spec.cwd,
            "."
          ],
          stdout: "pipe",
          stderr: "pipe"
        });
        await input.sandbox.files.write(
          "/tmp/poe-workspace-upload.tar",
          toArrayBuffer(await readFile(archivePath))
        );
        await runRemoteOrThrow(
          input.sandbox,
          createUploadWorkspaceCommand(sandboxWorkspaceDir)
        );
        return { files: 0, bytes: 0, skipped: [] };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
    async downloadWorkspace(opts) {
      const tempDir = mkdtempSync(path.join(tmpdir(), "poe-e2b-download-"));
      const archivePath = path.join(tempDir, "workspace.tar");
      try {
        await runRemoteOrThrow(
          input.sandbox,
          `tar -cf /tmp/poe-workspace-download.tar -C ${shellQuote(sandboxWorkspaceDir)} .`
        );
        const archive = await input.sandbox.files.read("/tmp/poe-workspace-download.tar", {
          format: "bytes"
        });
        await writeFile(archivePath, Buffer.from(archive));
        await runOrThrow(hostRunner, {
          command: "tar",
          args: [
            opts.conflictPolicy === "refuse" ? "-xkf" : "-xf",
            archivePath,
            "-C",
            input.spec.cwd
          ],
          stdout: "pipe",
          stderr: "pipe"
        });
        return { files: 0, bytes: archive.byteLength, conflicts: [] };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
    exec(spec) {
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
        tty: true
      });
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
  const command = shellCommand([spec.command, ...(spec.args ?? [])]);
  const started = sandbox.commands.run(command, {
    background: true,
    cwd: spec.cwd,
    envs: spec.env,
    stdin: spec.stdin === "pipe",
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
  const stdin =
    spec.stdin === "pipe"
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
  const result = started
    .then((handle) => {
      e2bHandle = handle;
      return handle.wait();
    })
    .then(
      (result) => {
        stdout?.end();
        stderr?.end();
        return { exitCode: result.exitCode ?? 0 };
      },
      (error: unknown) => {
        stdout?.end();
        stderr?.end();
        if (isExitError(error)) {
          return { exitCode: error.exitCode };
        }
        return { exitCode: 1 };
      }
    );

  return {
    get pid() {
      return e2bHandle?.pid ?? null;
    },
    stdin,
    stdout,
    stderr,
    result,
    kill() {
      void e2bHandle?.kill();
    },
    get e2bHandle() {
      return e2bHandle;
    },
    started
  };
}

function runE2bPty(sandbox: E2bSandbox, spec: RunSpec): RunHandle {
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
  const result = started
    .then((handle) => {
      handleRef = handle;
      return handle.wait();
    })
    .then(
      (result) => {
        stdout.end();
        return { exitCode: result.exitCode ?? 0 };
      },
      () => {
        stdout.end();
        return { exitCode: 1 };
      }
    );

  return {
    get pid() {
      return handleRef?.pid ?? null;
    },
    stdin: spec.stdin === "inherit" ? process.stdin : stdin,
    stdout: spec.stdout === "inherit" ? null : stdout,
    stderr: null,
    result,
    kill() {
      void (handleRef === null ? undefined : sandbox.pty.kill(handleRef.pid));
    }
  };
}

async function runRemoteOrThrow(sandbox: E2bSandbox, command: string): Promise<void> {
  const stdoutTail = createLineTail(REMOTE_COMMAND_STDERR_TAIL_SIZE);
  const stderrTail = createLineTail(REMOTE_COMMAND_STDERR_TAIL_SIZE);
  let result: E2bCommandResult | E2bCommandHandle;
  try {
    result = await sandbox.commands.run(command, {
      onStdout(data) {
        stdoutTail.push(data);
      },
      onStderr(data) {
        stderrTail.push(data);
      }
    });
  } catch (error) {
    appendRemoteCommandOutput(error, stdoutTail, stderrTail);
    if (isCommandExitError(error)) {
      throw decorateRemoteCommandError(error, command, stderrTail.values());
    }
    throw error;
  }
  appendRemoteCommandOutput(result, stdoutTail, stderrTail);
  if ("exitCode" in result && result.exitCode !== 0) {
    throw decorateRemoteCommandError(
      new Error(`E2B command failed with exit code ${result.exitCode}`),
      command,
      stderrTail.values()
    );
  }
}

function appendRemoteCommandOutput(
  source: unknown,
  stdoutTail: { push(chunk: string): void },
  stderrTail: { push(chunk: string): void }
): void {
  if (!source || typeof source !== "object") {
    return;
  }
  const output = source as { stdout?: unknown; stderr?: unknown };
  if (typeof output.stdout === "string") {
    stdoutTail.push(output.stdout);
  }
  if (typeof output.stderr === "string") {
    stderrTail.push(output.stderr);
  }
}

function decorateRemoteCommandError(error: unknown, command: string, stderrTail: string[]): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const tail = stderrTail.length === 0 ? "" : `\n\nLast stderr output:\n${stderrTail.join("\n")}`;
  const decorated = new Error(`E2B command failed: ${command}\n${original.message}${tail}`);
  decorated.stack = original.stack;
  (decorated as Error & { cause?: unknown }).cause = original;
  return decorated;
}

function createLineTail(maxLines: number): { push(chunk: string): void; values(): string[] } {
  const lines: string[] = [];
  let pending = "";
  const appendLine = (line: string): void => {
    lines.push(trimTrailingCarriageReturn(line));
    while (lines.length > maxLines) {
      lines.shift();
    }
  };

  return {
    push(chunk) {
      pending += chunk;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) {
        appendLine(line);
      }
    },
    values() {
      const output = [...lines];
      if (pending.length > 0) {
        output.push(trimTrailingCarriageReturn(pending));
      }
      return output.slice(-maxLines);
    }
  };
}

function trimTrailingCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

async function runOrThrow(runner: Runner, spec: RunSpec): Promise<void> {
  const handle = runner.exec(spec);
  const stderr = readableToString(handle.stderr);
  const result = await handle.result;
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${result.exitCode}: ${spec.command} ${(spec.args ?? []).join(" ")}\n${await stderr}`
    );
  }
}

function shellCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createUploadWorkspaceCommand(sandboxWorkspaceDir: string): string {
  const quotedWorkspaceDir = shellQuote(sandboxWorkspaceDir);
  return [
    `mkdir -p ${quotedWorkspaceDir} || { command -v sudo >/dev/null 2>&1 && sudo mkdir -p ${quotedWorkspaceDir} && sudo chown "$(id -u):$(id -g)" ${quotedWorkspaceDir}; }`,
    `test -w ${quotedWorkspaceDir} && tar -xf /tmp/poe-workspace-upload.tar -C ${quotedWorkspaceDir}`
  ].join("\n");
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

function isCommandExitError(error: unknown): boolean {
  return (
    isExitError(error) ||
    Boolean(
      error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "CommandExitError"
    )
  );
}
