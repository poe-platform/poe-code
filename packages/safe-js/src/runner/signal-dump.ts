import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile as nodeWriteFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { hasOwnErrorCode } from "../error-codes.js";
import type { RunResult } from "../run.js";
import { dump } from "../snapshot/dump.js";

type SignalName = "SIGUSR1";

type SignalProcess = Pick<NodeJS.Process, "off" | "on">;

type CliStream = {
  write(chunk: string): void;
};

type WriteDumpFile = (
  filepath: string,
  content: string,
  options: { encoding: "utf8"; flag: "wx" }
) => Promise<void>;

export function attachSignalDumpHandler(
  result: PromiseLike<RunResult>,
  options: {
    dumpPath?: string;
    dumpResult?: (result: PromiseLike<RunResult>) => Promise<string>;
    onError?: (error: unknown, signal: SignalName) => Promise<void> | void;
    onSnapshot?: (snapshot: string, signal: SignalName) => Promise<void> | void;
    process?: SignalProcess;
    stderr?: CliStream;
    writeFile?: WriteDumpFile;
  } = {}
): () => void {
  const signalProcess = options.process ?? process;
  const stderr = options.stderr ?? process.stderr;
  const writeDumpFile = options.writeFile ?? nodeWriteFile;

  const onSigusr1 = () => {
    void writeDump("SIGUSR1");
  };

  signalProcess.on("SIGUSR1", onSigusr1);
  Promise.resolve(result).then(cleanup, cleanup);

  return cleanup;

  function cleanup(): void {
    signalProcess.off("SIGUSR1", onSigusr1);
  }

  async function writeDump(signal: SignalName): Promise<void> {
    try {
      const snapshot =
        options.dumpResult === undefined
          ? await dump(result, { mode: "replay" })
          : await options.dumpResult(result);
      if (options.dumpPath !== undefined) {
        const parentPath = dirname(options.dumpPath);
        const tempPath = join(parentPath, `.${basename(options.dumpPath)}.${randomUUID()}.tmp`);
        await mkdir(parentPath, { recursive: true });
        let tempCreated = false;
        try {
          await writeDumpFile(tempPath, snapshot, { encoding: "utf8", flag: "wx" });
          tempCreated = true;
          await rename(tempPath, options.dumpPath);
        } catch (error) {
          if (tempCreated || !isAlreadyExistsError(error)) {
            await rm(tempPath, { force: true }).catch(() => undefined);
          }
          throw error;
        }
      }
      await options.onSnapshot?.(snapshot, signal);
    } catch (error) {
      await options.onError?.(error, signal);
      stderr.write(
        `Failed to write ${signal} dump to ${options.dumpPath ?? "<memory>"}: ${readErrorMessage(error)}\n`
      );
    }
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && hasOwnErrorCode(error, "EEXIST");
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
