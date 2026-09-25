import { PublicDiagnostic } from "../../diagnostics.js";
import { type CommandContext, type CommandDefinition, type CommandHandler } from "../../contracts/index.js";
import { diagnostic } from "../internal.js";
import { gnuInformation } from "../gnu-information.js";
import { fail } from "safe-bash-table-text-engine";
export { settings, fail, empty, encode, Budget, RecordReader, Inputs, argument } from "safe-bash-table-text-engine";
export type { TableTextLimits, TableTextCommandsOptions } from "safe-bash-table-text-engine";

export function command(name: string, handler: CommandHandler): CommandDefinition {
  return { name, async execute(context) {
    context.signal.throwIfAborted();
    try {
      const infoPromise = gnuInformation(name, context);
      if (infoPromise) {
        const info = await infoPromise;
        if (info) return info;
      }
      return await handler(context);
    }
    catch (error) { context.signal.throwIfAborted(); await diagnostic(context, error); return { exitCode: 1 }; }
  } };
}

export function compare(left: Uint8Array, right: Uint8Array, fold = false): number {
  for (let offset = 0; offset < Math.min(left.length, right.length); offset++) {
    let first = left[offset]!, second = right[offset]!;
    if (fold && first >= 65 && first <= 90) first += 32;
    if (fold && second >= 65 && second <= 90) second += 32;
    if (first !== second) return first - second;
  }
  return left.length - right.length;
}

export type OrderMode = "default" | "check" | "none";

export class OrderCheck {
  unpaired = false;
  failed = false;
  private warned = new Set<number>();
  constructor(readonly mode: OrderMode, readonly context: CommandContext) {}
  async check(previous: Uint8Array | undefined, next: Uint8Array | undefined, file: number, fold = false): Promise<void> {
    if (this.mode === "none" || (this.mode === "default" && !this.unpaired) || this.warned.has(file)) return;
    if (previous && next && compare(previous, next, fold) > 0) {
      const message = `file ${file} is not in sorted order`;
      if (this.mode === "check") fail(message);
      this.warned.add(file); this.failed = true;
      await diagnostic(this.context, new PublicDiagnostic(message));
    }
  }
  async finish(): Promise<void> {
    if (this.failed) await diagnostic(this.context, new PublicDiagnostic("input is not in sorted order"));
  }
}
