import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type CommandContext } from "../../../src/contracts/index.js";
import { createTimeEnvCommands, type TimeEnvCommandsOptions, type SleepScheduler } from "../../../src/commands/time-env/index.js";

export async function run(name: string, args: readonly string[], options: TimeEnvCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: name, args, cwd: "/", fs: createMemoryFileSystem(), env: Object.create(null) as Record<string, string>,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides };
  const definition = createTimeEnvCommands(options).find(entry => entry.name === name);
  if (!definition) throw new Error(`missing definition ${name}`);
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(),
    stdoutHex: Buffer.concat(stdout).toString("hex"), fs: context.fs };
}

export class Timers implements SleepScheduler {
  milliseconds = 0;
  sequence = 0;
  readonly scheduled: number[] = [];
  readonly pending = new Map<number, () => void>();
  readonly cleared: unknown[] = [];
  now() { return this.milliseconds; }
  setTimeout(callback: () => void, milliseconds: number) {
    this.scheduled.push(milliseconds);
    const handle = ++this.sequence;
    this.pending.set(handle, callback);
    return handle;
  }
  clearTimeout(handle: unknown) { this.cleared.push(handle); this.pending.delete(handle as number); }
  tick(milliseconds: number) {
    this.milliseconds += milliseconds;
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback();
  }
}
