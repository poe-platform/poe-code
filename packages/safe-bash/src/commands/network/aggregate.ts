import { scheduleNetworkDeadline } from "./deadline.js";
import { createOutputOperation, type ByteSink, type CommandContext, type OutputOperation } from "../../contracts/index.js";
import { diagnostic } from "./shared.js";
import { CurlError } from "./types.js";

export function createDeadlineOutput(context: CommandContext, destination: ByteSink, remaining: number): OutputOperation {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([context.signal, lifetime.signal]);
  const operation = createOutputOperation({ ...context, signal }, destination);
  if (operation.signal.aborted) return operation;
  const cancel = scheduleNetworkDeadline(remaining, () => lifetime.abort(new CurlError(28, "Operation timed out")));
  operation.registerCleanup(cancel);
  return operation;
}

export async function deadlineDiagnostic(context: CommandContext, error: CurlError, remaining: number): Promise<void> {
  const operation = createDeadlineOutput(context, context.stderr, remaining);
  try { await diagnostic({ ...context, stderr: operation.output, signal: operation.signal }, error); }
  finally { await operation.close(); }
}
