import path from "node:path";
import type { JobHandle, JobStatus, LogChunk } from "@poe-code/agent-harness-tools";
import { streamLogFile, waitForExit, type LogStreamFs } from "@poe-code/agent-harness-tools";
import type { E2bSandbox } from "./sdk.js";

const JOB_DIR = "/tmp/poe-jobs";

export function createE2bJobHandle(input: {
  sandbox: E2bSandbox;
  envId: string;
  jobId: string;
  tool: string;
  argv: string[];
  pid?: number;
  preserveAfterExitHours: number;
}): JobHandle {
  const fs = createE2bLogStreamFs(input.sandbox);

  return {
    id: input.jobId,
    envId: input.envId,
    tool: input.tool,
    argv: input.argv,
    async status(): Promise<JobStatus> {
      const exit = await readExitCode(input.sandbox, input.jobId);
      if (exit !== null) {
        return "exited";
      }

      const processes = await input.sandbox.commands.list();
      const isRunning =
        input.pid === undefined
          ? processes.some((process) => processMentionsJob(process, input.jobId))
          : processes.some((process) => process.pid === input.pid);
      return isRunning ? "running" : "lost";
    },
    stream(opts = {}): AsyncIterable<LogChunk> {
      return streamLogFile({ fs }, input.jobId, opts);
    },
    async wait(): Promise<{ exitCode: number }> {
      const result = await waitForExit({ fs }, input.jobId);
      const preserveMs = input.preserveAfterExitHours * 60 * 60 * 1000;
      if (preserveMs > 0) {
        await input.sandbox.setTimeout(preserveMs);
      }
      return result;
    },
    async kill(signal?: NodeJS.Signals): Promise<void> {
      const pids =
        input.pid === undefined
          ? (await input.sandbox.commands.list())
              .filter((process) => processMentionsJob(process, input.jobId))
              .map((process) => process.pid)
          : [input.pid];
      if (signal === undefined) {
        await Promise.all(pids.map((pid) => input.sandbox.commands.kill(pid)));
        return;
      }
      const signalName = signal.startsWith("SIG") ? signal.slice(3) : signal;
      await Promise.all(
        pids.map((pid) => input.sandbox.commands.run(`kill -s ${shellQuote(signalName)} -- ${shellQuote(String(pid))}`))
      );
    }
  };
}

export function createE2bLogStreamFs(sandbox: E2bSandbox): LogStreamFs {
  return {
    promises: {
      async readFile(filePath) {
        return Buffer.from(await sandbox.files.read(filePath, { format: "bytes" }));
      },
      async stat(filePath) {
        const result = await sandbox.commands.run(
          `stat -c %Y ${shellQuote(filePath)} 2>/dev/null || stat -f %m ${shellQuote(filePath)}`
        );
        if (!("stdout" in result)) {
          throw new Error(`Unable to stat ${filePath}`);
        }
        const seconds = Number(result.stdout?.trim());
        if (!Number.isFinite(seconds)) {
          throw new Error(`Unable to stat ${filePath}`);
        }
        return { mtimeMs: seconds * 1000 };
      }
    },
    watch(filePath, listener) {
      let closed = false;
      let stop: (() => void) | null = null;
      void sandbox.files
        .watchDir(path.dirname(filePath), listener, { recursive: false })
        .then((handle) => {
          if (closed) {
            void handle.stop().catch(() => undefined);
            return;
          }
          stop = () => {
            void handle.stop().catch(() => undefined);
          };
        })
        .catch(() => undefined);
      return {
        close() {
          closed = true;
          stop?.();
        }
      } as ReturnType<NonNullable<LogStreamFs["watch"]>>;
    }
  };
}

function processMentionsJob(process: { cmd: string; args: string[] }, jobId: string): boolean {
  const needle = `/tmp/poe-jobs/${jobId}`;
  return process.cmd.includes(needle) || process.args.some((arg) => arg.includes(needle));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function readExitCode(sandbox: E2bSandbox, jobId: string): Promise<number | null> {
  try {
    const contents = await sandbox.files.read(`${JOB_DIR}/${jobId}.exit`);
    const text = contents.trim();
    const exitCode = isDecimalIntegerLiteral(text) ? Number(text) : NaN;
    if (!Number.isInteger(exitCode)) {
      throw new Error(`Invalid exit code in ${JOB_DIR}/${jobId}.exit: ${contents}`);
    }
    return exitCode;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isDecimalIntegerLiteral(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 48 || codePoint > 57) {
      return false;
    }
  }

  return true;
}

function hasOwnErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}
