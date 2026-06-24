import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../ansi.js";
import { main } from "../cli.js";
import { createTerminalPilotRuntime } from "../commands/runtime.js";

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");

export type TerminalPilotCliRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type TerminalPilotCliJsonRunResult<T> = {
  exitCode: number;
  stdout: T;
  stderr: string;
};

function appendJsonOutputFlag(args: string[]): string[] {
  if (
    args.includes("--json") ||
    args.includes("--output") ||
    args.some((arg) => arg.startsWith("--output="))
  ) {
    return [...args];
  }

  const ddashIndex = args.indexOf("--");

  if (ddashIndex === -1) {
    return [...args, "--output", "json"];
  }

  return [...args.slice(0, ddashIndex), "--output", "json", "--", ...args.slice(ddashIndex + 1)];
}

function toText(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString("utf8");
  }

  return String(chunk);
}

function normalizeOutput(text: string): string {
  return stripAnsi(text).replaceAll("\r", "").trim();
}

function canParseJson(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function createTerminalPilotCliRepl() {
  const terminalPilotRuntime = createTerminalPilotRuntime();

  return {
    async run(args: string[]): Promise<TerminalPilotCliRunResult> {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const previousExitCode = process.exitCode;

      process.exitCode = 0;
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        stdoutChunks.push(toText(chunk));
        const callback =
          typeof rest.at(-1) === "function" ? (rest.at(-1) as () => void) : undefined;
        callback?.();
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
        stderrChunks.push(toText(chunk));
        const callback =
          typeof rest.at(-1) === "function" ? (rest.at(-1) as () => void) : undefined;
        callback?.();
        return true;
      }) as typeof process.stderr.write;

      try {
        await main(["node", cliPath, ...args], { terminalPilotRuntime });
      } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      }

      const exitCode = process.exitCode ?? 0;
      process.exitCode = previousExitCode;

      let stdout = normalizeOutput(stdoutChunks.join(""));
      let stderr = normalizeOutput(stderrChunks.join(""));

      if (exitCode !== 0 && stderr.length === 0 && !canParseJson(stdout)) {
        stderr = stdout;
        stdout = "";
      }

      return {
        exitCode,
        stdout,
        stderr
      };
    },

    async runJson<T>(args: string[]): Promise<TerminalPilotCliJsonRunResult<T>> {
      const result = await this.run(appendJsonOutputFlag(args));

      if (result.exitCode !== 0) {
        return {
          exitCode: result.exitCode,
          stdout: undefined as T,
          stderr: result.stderr
        };
      }

      if (result.stdout.length === 0) {
        throw new Error(
          `Expected JSON output for terminal-pilot ${args.join(" ")}, but stdout was empty.`
        );
      }

      return {
        exitCode: result.exitCode,
        stdout: JSON.parse(result.stdout) as T,
        stderr: result.stderr
      };
    },

    async close(): Promise<void> {
      await terminalPilotRuntime.close();
    }
  };
}
