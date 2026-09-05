import type { CommandContext } from "./command.js";
import { FsError } from "./errors.js";
import type { ByteSink } from "./io.js";

export type CountedFileWrite = (chunk: Uint8Array, write: () => Promise<number>) => Promise<number>;

export const filesystemOutputBudgets = new WeakMap<NonNullable<CommandContext["registerCleanup"]>, {
  readonly sinkBudget: (sink: ByteSink) => ByteSink;
  readonly countedWrite?: CountedFileWrite;
}>();

export type FileOutputContext = Pick<CommandContext, "fs" | "signal" | "registerCleanup"> & {
  readonly cleanupFailurePrioritySignal?: AbortSignal | undefined;
};

export function bindFileOutputBudget(context: Pick<CommandContext, "registerCleanup">, budget: (sink: ByteSink) => ByteSink, countedWrite?: CountedFileWrite): void {
  if (!context.registerCleanup) throw new TypeError("Shell output budgets require invocation cleanup ownership");
  filesystemOutputBudgets.set(context.registerCleanup, { sinkBudget: budget, ...(countedWrite === undefined ? {} : { countedWrite }) });
}

export function assertCountedFileOutput(context: Pick<CommandContext, "registerCleanup" | "signal">): void {
  context.signal.throwIfAborted();
  const budget = context.registerCleanup && filesystemOutputBudgets.get(context.registerCleanup);
  if (budget && !budget.countedWrite) throw new FsError("ENOTSUP", { syscall: "write", message: "counted filesystem output budget is not bound" });
}

export async function writeFileOutputCounted(context: Pick<CommandContext, "registerCleanup" | "signal">,
  chunk: Uint8Array, write: () => Promise<number>): Promise<number> {
  assertCountedFileOutput(context);
  if (!(chunk instanceof Uint8Array)) throw new TypeError("Filesystem output must be Uint8Array");
  const budget = context.registerCleanup && filesystemOutputBudgets.get(context.registerCleanup);
  const requested = chunk.byteLength;
  let called = false;
  let accepting = true;
  let accepted: number | undefined;
  let active: Promise<number> | undefined;
  const guarded = (): Promise<number> => {
    try {
      context.signal.throwIfAborted();
      if (!accepting) throw new FsError("EBADF", { syscall: "write" });
      if (called) throw new FsError("EIO", { syscall: "write", message: "counted writer invoked more than once" });
      called = true;
    } catch (error) { return Promise.reject(error); }
    active = (async () => {
      const count = await write();
      context.signal.throwIfAborted();
      if (!Number.isSafeInteger(count) || count < 0 || count > requested) throw new FsError("EIO", { syscall: "write", message: "invalid byte count" });
      accepted = count;
      return count;
    })();
    void active.catch(() => {});
    return active;
  };
  let result: number | undefined;
  let failure: { reason: unknown } | undefined;
  try {
    result = await (budget?.countedWrite ? budget.countedWrite(chunk, guarded) : guarded());
  } catch (reason) { failure = { reason }; }
  accepting = false;
  try { await active; } catch (reason) { failure ??= { reason }; }
  context.signal.throwIfAborted();
  if (failure) throw failure.reason;
  if (accepted === undefined || result !== accepted) throw new FsError("EIO", { syscall: "write", message: "counted writer changed the accepted byte count" });
  return accepted;
}
