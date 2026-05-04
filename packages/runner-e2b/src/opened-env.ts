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
import { readableToString, toArrayBuffer, type E2bCommandHandle, type E2bSandbox } from "./sdk.js";

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
  let lastProcess: { started: Promise<E2bCommandHandle> } | null = null;
  let detachedJobContext: DetachedJobContext | null = null;

  const env: E2bOpenedEnv = {
    id: input.sandbox.sandboxId,
    job: null,
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
          `mkdir -p ${shellQuote(input.spec.cwd)} && tar -xf /tmp/poe-workspace-upload.tar -C ${shellQuote(input.spec.cwd)}`
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
          `tar -cf /tmp/poe-workspace-download.tar -C ${shellQuote(input.spec.cwd)} .`
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
      const handle = runE2bCommand(input.sandbox, spec);
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
        cwd: input.spec.cwd,
        env: shellSpec && "env" in shellSpec ? shellSpec.env : input.spec.env,
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
  const stdin =
    spec.stdin === "pipe"
      ? new Writable({
          write(chunk, _encoding, callback) {
            if (e2bHandle === null) {
              callback(new Error("E2B command stdin is not ready."));
              return;
            }
            sandbox.commands
              .sendStdin(e2bHandle.pid, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
              .then(() => callback(), callback);
          },
          final(callback) {
            if (e2bHandle === null || sandbox.commands.closeStdin === undefined) {
              callback();
              return;
            }
            sandbox.commands.closeStdin(e2bHandle.pid).then(() => callback(), callback);
          }
        })
      : null;
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
  const result = await sandbox.commands.run(command);
  if ("exitCode" in result && result.exitCode !== 0) {
    throw new Error(`E2B command failed with exit code ${result.exitCode}: ${command}`);
  }
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

function isExitError(error: unknown): error is { exitCode: number } {
  return Boolean(
    error &&
    typeof error === "object" &&
    typeof (error as { exitCode?: unknown }).exitCode === "number"
  );
}
