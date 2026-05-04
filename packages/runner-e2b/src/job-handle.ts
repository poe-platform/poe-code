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
  pid: number;
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
      return processes.some((process) => process.pid === input.pid) ? "running" : "lost";
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
    async kill(): Promise<void> {
      await input.sandbox.commands.kill(input.pid);
    }
  };
}

export function createE2bLogStreamFs(sandbox: E2bSandbox): LogStreamFs {
  return {
    promises: {
      async readFile(filePath) {
        return Buffer.from(await sandbox.files.read(filePath, { format: "bytes" }));
      }
    },
    watch(filePath, listener) {
      let closed = false;
      let stop: (() => void) | null = null;
      void sandbox.files
        .watchDir(path.dirname(filePath), listener, { recursive: false })
        .then((handle) => {
          if (closed) {
            void handle.stop();
            return;
          }
          stop = () => {
            void handle.stop();
          };
        });
      return {
        close() {
          closed = true;
          stop?.();
        }
      } as ReturnType<NonNullable<LogStreamFs["watch"]>>;
    }
  };
}

async function readExitCode(sandbox: E2bSandbox, jobId: string): Promise<number | null> {
  try {
    const contents = await sandbox.files.read(`${JOB_DIR}/${jobId}.exit`);
    const exitCode = Number(contents.trim());
    return Number.isInteger(exitCode) ? exitCode : null;
  } catch {
    return null;
  }
}
