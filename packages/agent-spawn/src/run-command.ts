import { spawn } from "node:child_process";
import { constants } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { hasOwnErrorCode } from "./error-codes.js";

const TERMINATION_GRACE_MS = 1_000;
const PROCESS_GROUP_POLL_MS = 25;
const PROCESS_GROUP_FINAL_WAIT_MS = 500;

export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  aborted?: boolean;
}

export interface CommandRunnerOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | Buffer;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions
) => Promise<CommandRunnerResult>;

export function runCommand(
  command: string,
  args: string[],
  inputOptions?: CommandRunnerOptions
): Promise<CommandRunnerResult> {
  return new Promise((resolve) => {
    const options = normalizeCommandRunnerOptions(inputOptions);

    if (options?.signal?.aborted === true) {
      resolve({
        stdout: "",
        stderr: "Command aborted before start.",
        exitCode: 130,
        aborted: true
      });
      return;
    }

    const hasStdin = options?.stdin != null;
    const timeoutMs = options?.timeoutMs;
    const hasTimeout = typeof timeoutMs === "number" && timeoutMs > 0;
    const canAbort = options?.signal !== undefined;
    const killProcessGroup = process.platform !== "win32" && (hasTimeout || canAbort);
    const child = spawn(
      command,
      args,
      createNullRecord({
        stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe"],
        cwd: options?.cwd,
        env: options?.env
          ? {
              ...(process.env as Record<string, string | undefined>),
              ...options.env
            }
          : undefined,
        ...(killProcessGroup ? { detached: true } : {})
      })
    );
    if (killProcessGroup) {
      child.unref();
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let terminationMessage: string | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let escalationTimeout: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (escalationTimeout !== undefined) {
        clearTimeout(escalationTimeout);
        escalationTimeout = undefined;
      }
      options?.signal?.removeEventListener("abort", abortCommand);
    };

    const finish = (result: CommandRunnerResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const terminate = (reason: "timeout" | "abort"): void => {
      if (settled || timedOut || aborted) {
        return;
      }

      timedOut = reason === "timeout";
      aborted = reason === "abort";
      terminationMessage =
        reason === "timeout"
          ? `Command timed out after ${timeoutMs} ms.`
          : "Command aborted.";
      killChild("SIGTERM");
      escalationTimeout = setTimeout(() => {
        killChild("SIGKILL");
      }, TERMINATION_GRACE_MS);
    };

    const killChild = (signal: NodeJS.Signals): void => {
      if (killProcessGroup && typeof child.pid === "number" && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child when the process group is already gone or unavailable.
        }
      }

      child.kill(signal);
    };

    function abortCommand(): void {
      terminate("abort");
    }

    if (hasTimeout) {
      timeout = setTimeout(() => terminate("timeout"), timeoutMs);
    }
    options?.signal?.addEventListener("abort", abortCommand, { once: true });

    if (hasStdin && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options!.stdin);
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      const ownCode = Object.prototype.hasOwnProperty.call(error, "code")
        ? error.code
        : undefined;
      const exitCode =
        typeof ownCode === "number"
          ? ownCode
          : typeof error.errno === "number"
            ? error.errno
            : 127;
      const message =
        error instanceof Error ? error.message : String(error ?? "error");
      finish({
        stdout,
        stderr: stderr ? `${stderr}${message}` : message,
        exitCode
      });
    });

    child.on("close", (code, signal) => {
      void (async () => {
        if ((timedOut || aborted) && killProcessGroup && typeof child.pid === "number") {
          await waitForProcessGroupExit(child.pid);
        }

        const exitCode = timedOut ? 124 : aborted ? 130 : code ?? signalExitCode(signal);
        const finalStderr =
          terminationMessage === undefined
            ? stderr
            : stderr
              ? `${stderr}${terminationMessage}`
              : terminationMessage;
        finish({
          stdout,
          stderr: finalStderr,
          exitCode,
          ...(timedOut ? { timedOut: true } : {}),
          ...(aborted ? { aborted: true } : {})
        });
      })();
    });
  });
}

function normalizeCommandRunnerOptions(
  options: CommandRunnerOptions | undefined
): CommandRunnerOptions {
  if (options === undefined) {
    return createNullRecord({});
  }

  return createNullRecord({
    ...optionalOwnProperty(options, "cwd"),
    ...optionalOwnProperty(options, "env"),
    ...optionalOwnProperty(options, "stdin"),
    ...optionalOwnProperty(options, "timeoutMs"),
    ...optionalOwnProperty(options, "signal")
  });
}

function optionalOwnProperty<Name extends keyof CommandRunnerOptions>(
  options: CommandRunnerOptions,
  name: Name
): Pick<CommandRunnerOptions, Name> | Record<string, never> {
  const value = getOwnProperty(options, name);
  return value === undefined ? {} : ({ [name]: value } as Pick<CommandRunnerOptions, Name>);
}

function getOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): unknown {
  return hasOwnProperty(value, name) ? value[name] : undefined;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function createNullRecord<T extends object>(value: T): T {
  return Object.assign(Object.create(null) as T, value);
}

async function waitForProcessGroupExit(pid: number): Promise<void> {
  const deadline = Date.now() + TERMINATION_GRACE_MS + PROCESS_GROUP_FINAL_WAIT_MS;

  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(pid)) {
      return;
    }

    await delay(PROCESS_GROUP_POLL_MS);
  }
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isNoSuchProcess(error);
  }
}

function isNoSuchProcess(error: unknown): boolean {
  return hasOwnErrorCode(error, "ESRCH");
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  const signalNumber = signal ? constants.signals[signal] : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}
