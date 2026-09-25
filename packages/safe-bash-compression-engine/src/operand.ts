import { readBytes, writeBytes, type CommandContext } from "safe-bash-contracts";
import { FileOperation } from "./file-operation.js";
import { sourceBytes, unchangedSource, writeFileOperand, type Operand } from "./files.js";
import type { CompressionOptions } from "./options.js";
import { transform, type DecodedBudget } from "./stream.js";

export async function runOperand(context: CommandContext, plan: Operand, options: CompressionOptions, budget: DecodedBudget): Promise<boolean> {
  if (plan.destination) return writeFileOperand(context, plan, options, budget);
  const operation = new FileOperation(context);
  try {
    await operation.run(() => unchangedSource({ ...context, fs: operation.fs, signal: operation.signal }, plan));
    const source = plan.source === "-" ? context.stdin
      : (signal: AbortSignal) => operation.ownSource(sourceBytes(context, plan, signal));
    return await operation.run(() => transform(source, async (bytes, signal) => {
      for await (const chunk of readBytes(bytes, signal)) {
        if (!options.test) await writeBytes(context.stdout, chunk, signal);
      }
    }, { ...options, force: options.force && (options.stdout || options.test || plan.source === "-") }, operation.signal, Infinity, budget));
  } finally { await operation.close(); context.signal.throwIfAborted(); }
}
