import { writeBytes, type CommandContext } from "safe-bash-contracts";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
export { UsageError } from "safe-bash-contracts/diagnostics";
export { pathOf } from "safe-bash-contracts/path";

export function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

export async function output(context: CommandContext, text: string | Uint8Array): Promise<void> {
  context.signal.throwIfAborted();
  await writeBytes(context.stdout, typeof text === "string" ? new TextEncoder().encode(text) : text, context.signal);
}

export async function diagnostic(context: CommandContext, error: unknown): Promise<void> {
  context.signal.throwIfAborted();
  await writeDiagnostic(context.stderr, `${context.command}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
}
