import { PublicDiagnostic } from "safe-bash-contracts/public-diagnostic";
import { hasYieldCheckpoint, monotonicNow, runYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import type { CommandContext } from "safe-bash-contracts";

const validatedTextProgramOptions = new WeakSet<TextProgramOptions>();

export interface TextProgramOptions {
  readonly replace?: boolean;
  readonly maxProgramInstructions?: number;
  readonly maxSteps?: number;
  readonly maxBufferBytes?: number | undefined;
  readonly maxArrayEntries?: number;
  readonly maxFields?: number;
  readonly maxGetlineFiles?: number;
  readonly maxRecursionDepth?: number;
  readonly maxArguments?: number;
  readonly maxRetainedBytes?: number;
}

export class ProgramError extends PublicDiagnostic {}

export class Budget {
  readonly maxBufferBytes: number;
  stepsUsed = 0;
  private remainingSmi: number;
  private remainingNum: number;
  private readonly unlimited: boolean;
  private readonly signal: AbortSignal;
  private checkpoints = 0;
  private lastYield = 0;
  constructor(readonly context: CommandContext, readonly options: TextProgramOptions) {
    const rem = options.maxSteps ?? Infinity;
    this.unlimited = rem === Infinity;
    this.remainingNum = this.unlimited ? 0 : rem;
    this.remainingSmi = !this.unlimited && rem <= 0x3fffffff ? (rem | 0) : 0x3fffffff;
    this.signal = context.signal;
    this.maxBufferBytes = options.maxBufferBytes ?? Infinity;
    if (!validatedTextProgramOptions.has(options)) {
      for (const [key, value] of Object.entries(options)) {
        if (!key.startsWith("max")) continue;
        if (value !== undefined && (typeof value !== "number" || value !== Infinity && !Number.isSafeInteger(value) || value < 1)) throw new ProgramError("limits must be positive safe integers");
      }
      validatedTextProgramOptions.add(options);
    }
  }
  step(count = 1): void {
    if (this.signal.aborted) this.signal.throwIfAborted();
    this.stepsUsed += count;
    if (this.unlimited) return;
    if ((count | 0) === count && count >= 0 && count <= this.remainingSmi) {
      this.remainingSmi = (this.remainingSmi - (count | 0)) | 0;
      this.remainingNum -= count;
      return;
    }
    if (count > this.remainingNum) throw new ProgramError("execution step limit exceeded");
    this.remainingNum -= count;
    this.remainingSmi = this.remainingNum <= 0x3fffffff ? (this.remainingNum | 0) : 0x3fffffff;
  }
  check(text: string): string {
    if (text.length > this.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    return text;
  }
  async checkpoint(): Promise<void> {
    const p = this.checkpointSync();
    if (p) await p;
  }
  checkpointSync(): Promise<void> | undefined {
    if (this.signal.aborted) this.signal.throwIfAborted();
    const count = ++this.checkpoints;
    if ((count & 255) === 0) {
      const now = monotonicNow();
      if (this.lastYield === 0) this.lastYield = now;
      if (!hasYieldCheckpoint(this.signal) && now - this.lastYield < 25) {
        runYieldCheckpoint(this.signal);
        return undefined;
      }
      return this.yieldCheckpointAsync();
    }
    return undefined;
  }
  private async yieldCheckpointAsync(): Promise<void> {
    await yieldTurn(this.signal);
    this.lastYield = monotonicNow();
    this.signal.throwIfAborted();
  }
}
