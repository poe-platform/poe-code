import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { McpTransport, McpTransportClosedEvent } from "./internal.js";

export type StdioSpawn = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions
) => ChildProcessWithoutNullStreams;

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: StdioSpawn;
}

function defaultStdioSpawn(
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions
): ChildProcessWithoutNullStreams {
  return spawn(command, args, options) as ChildProcessWithoutNullStreams;
}

export class StdioTransport implements McpTransport {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly closed: Promise<McpTransportClosedEvent>;
  private readonly child: ChildProcessWithoutNullStreams;
  private disposed = false;
  private stderrOutput = "";
  private static readonly STDERR_MAX_LENGTH = 65_536;

  constructor({
    command,
    args = [],
    cwd,
    env,
    spawn: spawnProcess = defaultStdioSpawn,
  }: StdioTransportOptions) {
    this.child = spawnProcess(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const child = this.child;

    this.readable = child.stdout;
    this.writable = child.stdin;
    const stderrDecoder = new TextDecoder();
    child.stderr.on("data", (chunk: unknown) => {
      const decoded =
        chunk instanceof Uint8Array
          ? stderrDecoder.decode(chunk, { stream: true })
          : `${stderrDecoder.decode()}${String(chunk)}`;
      this.appendStderrOutput(decoded);
    });
    child.stderr.once("end", () => {
      this.appendStderrOutput(stderrDecoder.decode());
    });
    this.closed = new Promise((resolve) => {
      let settled = false;
      let streamError: Error | undefined;
      const resolveClosed = (event: McpTransportClosedEvent) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(event);
      };

      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream.once("error", (reason: Error) => {
          streamError ??= reason;
          this.dispose(reason);
        });
      }

      child.once("exit", (code, signal) => {
        const closedEvent: McpTransportClosedEvent = {
          reason: streamError ?? new Error("Stdio transport process exited"),
        };

        if (code !== null) {
          closedEvent.code = code;
        }

        if (signal !== null) {
          closedEvent.signal = signal;
        }

        resolveClosed(closedEvent);
      });

      child.once("error", (error) => {
        const closedEvent: McpTransportClosedEvent = {
          reason: error instanceof Error ? error : new Error(String(error)),
        };

        if (child.exitCode !== null) {
          closedEvent.code = child.exitCode;
        }

        if (child.signalCode !== null) {
          closedEvent.signal = child.signalCode;
        }

        resolveClosed(closedEvent);
      });
    });
  }

  getStderrOutput(): string {
    return this.stderrOutput;
  }

  private appendStderrOutput(chunk: string): void {
    if (chunk.length === 0) {
      return;
    }

    this.stderrOutput += chunk;
    if (this.stderrOutput.length > StdioTransport.STDERR_MAX_LENGTH) {
      this.stderrOutput = this.stderrOutput.slice(-StdioTransport.STDERR_MAX_LENGTH);
    }
  }

  dispose(reason = new Error("Stdio transport disposed")): void {
    void reason;

    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.end();
    }

    if (this.child.exitCode === null && this.child.signalCode === null && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }
}
