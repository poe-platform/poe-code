import { inspectFormats } from "./inspection.js";
import { PandocError } from "./errors.js";
import type { ConversionContext } from "./types.js";

/** Structural subset of safe-bash CommandContext: no filesystem or ambient host access. */
export interface FormatInspectionContext {
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  readonly stdout: { write(bytes: Uint8Array): Promise<void> };
  readonly stderr: { write(bytes: Uint8Array): Promise<void> };
}
/** Opt-in safe-bash command for registry inspection; conversion command wiring is separate. */
export function createFormatInspectionCommand(capabilities: ConversionContext = {}) {
  return {
    name: "pandoc",
    description: "List available document formats and dialect extensions",
    async execute(context: FormatInspectionContext): Promise<{ exitCode: number }> {
      context.signal.throwIfAborted();
      let text: string;
      try {
        text = inspectFormats(context.args, capabilities);
      } catch (error) {
        if (!(error instanceof PandocError)) throw error;
        await context.stderr.write(new TextEncoder().encode(`${error.code}: ${error.message}\n`));
        context.signal.throwIfAborted();
        return { exitCode: 2 };
      }
      await context.stdout.write(new TextEncoder().encode(text));
      context.signal.throwIfAborted();
      return { exitCode: 0 };
    }
  };
}
