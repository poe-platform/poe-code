import { createMemoryFileSystem } from "poe-code/safe-fs";
import { CommandRegistry, Shell, createStandardCommands, type ShellOptions } from "poe-code/safe-bash";
import { createServer, type Server, type Transport, type TypedSchema } from "tiny-stdio-mcp-server";

export interface SafeBashMcpOptions extends Partial<ShellOptions> {
  readonly createShell?: (options: ShellOptions) => Shell;
}

export interface ShellExecuteInput {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly stdin?: string;
}

export interface ShellExecuteOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type SafeBashMcpServer = Server & { readonly shell: Shell; close(): Promise<void> };

const inputSchema: TypedSchema<ShellExecuteInput> = {
  type: "object",
  properties: {
    command: { type: "string", minLength: 1, description: "Bash source interpreted by safe-bash, never a host shell" },
    cwd: { type: "string", description: "Working directory in the configured virtual filesystem for this call" },
    env: { type: "object", additionalProperties: { type: "string" }, description: "Environment overrides for this call" },
    stdin: { type: "string", description: "Standard input for this call" }
  },
  required: ["command"],
  additionalProperties: false
};

const outputSchema: TypedSchema<ShellExecuteOutput> = {
  type: "object",
  properties: {
    stdout: { type: "string" },
    stderr: { type: "string" },
    exitCode: { type: "integer" }
  },
  required: ["stdout", "stderr", "exitCode"],
  additionalProperties: false
};

export function createSafeBashMcpServer(options: SafeBashMcpOptions = {}): SafeBashMcpServer {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Safe-bash MCP options must be an object");
  }
  const { createShell, ...shellOptions } = options;
  const resolvedOptions: ShellOptions = {
    ...shellOptions,
    fs: options.fs ?? createMemoryFileSystem(),
    commands: options.commands ?? new CommandRegistry(createStandardCommands())
  };
  const shell = createShell ? createShell(resolvedOptions) : new Shell(resolvedOptions);
  const lifetime = new AbortController();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing === undefined) {
      closing = shell.dispose();
      lifetime.abort();
    }
    return closing;
  };
  let pending = Promise.resolve();
  const server = createServer({ name: "safe-bash-mcp", version: "0.1.0" });
  server.tool<ShellExecuteInput, ShellExecuteOutput>(
    "shell_execute",
    "Execute Bash in a shared virtual filesystem. Calls run in order; cwd and environment changes do not persist across calls.",
    inputSchema,
    async ({ command, ...execOptions }) => {
      const execution = pending.then(() => {
        if (lifetime.signal.aborted) throw new Error("Safe-bash MCP server is closed");
        return shell.exec(command, execOptions);
      });
      pending = execution.then(() => undefined, () => undefined);
      const { stdout, stderr, exitCode } = await execution;
      const output = { stdout, stderr, exitCode };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
        isError: exitCode !== 0
      };
    },
    outputSchema
  );
  const connect = server.connect;
  return Object.assign(server, {
    shell,
    close,
    async connect(transport: Transport): Promise<void> {
      const readable = new PassThrough();
      let stopped = false;
      let failure: unknown;
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        void close().catch(() => undefined);
        transport.readable.unpipe(readable);
        readable.end();
      };
      const fail = (error: unknown): void => {
        failure ??= error;
        stop();
      };
      const writable = new Writable({
        write(chunk, encoding, callback) {
          if (!stopped) {
            try { transport.writable.write(chunk, encoding); }
            catch (error) { fail(error); }
          }
          callback();
        }
      });
      const connection = connect({ readable, writable });
      transport.readable.once("end", stop);
      transport.readable.once("close", stop);
      transport.readable.on("error", fail);
      transport.writable.once("close", stop);
      transport.writable.on("error", fail);
      lifetime.signal.addEventListener("abort", stop, { once: true });
      try {
        if (lifetime.signal.aborted ||
          (transport.readable as NodeJS.ReadableStream & { readableEnded?: boolean; destroyed?: boolean }).readableEnded ||
          (transport.readable as NodeJS.ReadableStream & { destroyed?: boolean }).destroyed ||
          (transport.writable as NodeJS.WritableStream & { destroyed?: boolean }).destroyed) {
          stop();
        } else {
          transport.readable.pipe(readable);
        }
        await connection;
      } catch (error) {
        failure ??= error;
      } finally {
        stop();
        transport.readable.removeListener("end", stop);
        transport.readable.removeListener("close", stop);
        transport.readable.removeListener("error", fail);
        transport.writable.removeListener("close", stop);
        transport.writable.removeListener("error", fail);
        lifetime.signal.removeEventListener("abort", stop);
        readable.destroy();
        writable.destroy();
      }
      try { await close(); }
      catch (error) {
        if (failure !== undefined) throw new AggregateError([failure, error], "MCP transport and shell cleanup failed");
        throw error;
      }
      if (failure !== undefined) throw failure;
    }
  });
}
import { PassThrough, Writable } from "node:stream";
