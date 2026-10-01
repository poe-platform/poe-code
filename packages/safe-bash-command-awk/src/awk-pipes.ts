import { createBytePipe, type BytePipe, type CommandContext } from "safe-bash-contracts";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { Budget, ProgramError, bytes } from "safe-bash-io-engine/commands/text-programs/shared";
import { Reader } from "./awk-reader.js";
import { AwkRetention } from "./awk-retention.js";

interface CommandPipe {
  readonly channel: BytePipe;
  readonly abort: AbortController;
  readonly done: Promise<{ status: number } | { error: unknown }>;
  readonly reader?: Reader;
  closing?: Promise<number>;
}

/** Invocation-owned virtual shell children with bounded, backpressured streams. */
export class AwkPipes {
  private readonly reads = new Map<string, CommandPipe>();
  private readonly writes = new Map<string, CommandPipe>();
  private cleanup: Promise<void> | undefined;

  constructor(private readonly context: CommandContext, private readonly budget: Budget, private readonly retention: AwkRetention) {
    context.registerCleanup?.(() => this.closeAll(true));
  }

  private open(command: string, reading: boolean): CommandPipe {
    if (this.cleanup) throw new ProgramError("awk pipes are closed");
    const map = reading ? this.reads : this.writes;
    const existing = map.get(command);
    if (existing) return existing;
    if (!this.context.invoke) throw new ProgramError("command pipes require virtual command invocation");
    if (!command) throw new ProgramError("empty pipe command");
    if (this.reads.size + this.writes.size >= (this.budget.options.maxGetlineFiles ?? Infinity)) throw new ProgramError("awk open-pipe limit exceeded");
    this.budget.check(command);
    const size = shellValueByteLength(command);
    this.retention.admit(0, size);
    const abort = new AbortController();
    const signal = AbortSignal.any([this.context.signal, abort.signal]);
    const channel = createBytePipe({ highWaterMark: 1, signal });
    const invoke = this.context.invoke;
    const done = Promise.resolve().then(() => invoke("sh", ["-c", command], {
      signal, stdin: reading ? this.context.stdin : channel.endpoints!.read.readable,
      stdout: reading ? { write: async chunk => {
        this.retention.admit(0, chunk.byteLength);
        try { await channel.writable.write(chunk); }
        finally { this.retention.release(chunk.byteLength); }
      } } : this.context.stdout, stderr: this.context.stderr,
    })).then(async result => {
      if (reading) await channel.close();
      else await channel.endpoints?.read.close();
      return { status: result.exitCode };
    }).catch(async error => {
      await channel.abort(error);
      return { error };
    });
    const pipe: CommandPipe = { channel, abort, done, ...(reading ? { reader: new Reader(channel.endpoints!.read.readable, this.budget, this.retention) } : {}) };
    map.set(command, pipe);
    return pipe;
  }

  async read(command: string, separator: string): Promise<string | undefined> {
    const pipe = this.open(command, true);
    return pipe.reader!.read(separator);
  }

  async write(command: string, output: string): Promise<void> {
    const pipe = this.open(command, false);
    this.budget.step(output.length);
    this.retention.admit(0, output.length);
    try { await pipe.channel.writable.write(bytes(output)); }
    finally { this.retention.release(output.length); }
  }

  async close(command: string): Promise<number | undefined> {
    let status: number | undefined;
    for (const map of [this.reads, this.writes]) {
      const pipe = map.get(command);
      if (!pipe) continue;
      status = await (pipe.closing ??= this.finish(pipe).finally(() => {
        map.delete(command);
        this.retention.release(shellValueByteLength(command));
      }));
    }
    return status;
  }

  private async finish(pipe: CommandPipe): Promise<number> {
    let failed = false;
    let failure: unknown;
    try {
      if (pipe.reader) {
        await pipe.channel.endpoints!.read.close();
        await pipe.reader.close();
      } else await pipe.channel.close();
    } catch (error) { failed = true; failure = error; }
    const result = await pipe.done;
    if (failed && !pipe.abort.signal.aborted) throw failure;
    if ("error" in result) {
      if (!pipe.abort.signal.aborted) throw result.error;
      return -1;
    }
    return result.status;
  }

  closeAll(cancel = false): Promise<void> {
    if (cancel) for (const pipe of [...this.reads.values(), ...this.writes.values()]) pipe.abort.abort();
    return this.cleanup ??= (async () => {
      const results = await Promise.allSettled([...new Set([...this.reads.keys(), ...this.writes.keys()])].map(command => this.close(command)));
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })();
  }
}
