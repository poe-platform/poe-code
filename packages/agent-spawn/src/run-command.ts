import { spawn } from "node:child_process";
import { constants } from "node:os";

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
  options?: CommandRunnerOptions
): Promise<CommandRunnerResult> {
  return new Promise((resolve) => {
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
    const child = spawn(command, args, {
      stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe"],
      cwd: options?.cwd,
      env: options?.env
        ? {
            ...(process.env as Record<string, string | undefined>),
            ...options.env
          }
        : undefined
    });
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
          ? `Command timed out after ${options?.timeoutMs} ms.`
          : "Command aborted.";
      child.kill("SIGTERM");
      escalationTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1_000);
    };

    function abortCommand(): void {
      terminate("abort");
    }

    if (typeof options?.timeoutMs === "number" && options.timeoutMs > 0) {
      timeout = setTimeout(() => terminate("timeout"), options.timeoutMs);
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
      const exitCode =
        typeof error.code === "number"
          ? error.code
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
    });
  });
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  const signalNumber = signal ? constants.signals[signal] : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}
