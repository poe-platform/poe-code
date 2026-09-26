import { PublicDiagnostic } from "safe-bash-contracts/public-diagnostic";
import { monotonicNow, yieldTurn } from "safe-bash-contracts/yield";
import type { CommandContext } from "safe-bash-contracts";

const validatedTextProgramOptions = new WeakSet<TextProgramOptions>();
const DUMMY_ABORT_SIGNAL = new AbortController().signal;
const DUMMY_COMMAND_CONTEXT = { signal: DUMMY_ABORT_SIGNAL } as unknown as CommandContext;
let pooledBudgetA: Budget | undefined;
let pooledBudgetB: Budget | undefined;
let pooledBudgetToggle = 0;

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
  maxBufferBytes: number;
  stepsUsed = 0;
  inUse = false;
  private remainingSmi: number;
  private remainingNum: number;
  private unlimited: boolean;
  private signal: AbortSignal;
  private checkpoints = 0;
  private lastYield = monotonicNow();
  static acquire(context: CommandContext, options: TextProgramOptions): Budget {
    if (!pooledBudgetA) {
      pooledBudgetA = new Budget(DUMMY_COMMAND_CONTEXT, options);
    }
    if (!pooledBudgetB) {
      pooledBudgetB = new Budget(DUMMY_COMMAND_CONTEXT, options);
    }
    const first = (pooledBudgetToggle++ & 1) === 0 ? pooledBudgetA : pooledBudgetB;
    const second = first === pooledBudgetA ? pooledBudgetB : pooledBudgetA;
    if (!first.inUse) {
      first.inUse = true;
      first.resetForRun(context, options);
      return first;
    }
    if (!second.inUse) {
      second.inUse = true;
      second.resetForRun(context, options);
      return second;
    }
    return new Budget(context, options);
  }
  static release(budget: Budget): void {
    if (budget === pooledBudgetA || budget === pooledBudgetB) {
      budget.inUse = false;
      budget.context = DUMMY_COMMAND_CONTEXT;
      budget.signal = DUMMY_ABORT_SIGNAL;
    }
  }
  constructor(public context: CommandContext, public options: TextProgramOptions) {
    const rem = options.maxSteps ?? Infinity;
    this.unlimited = rem === Infinity;
    this.remainingNum = this.unlimited ? 0 : rem;
    this.remainingSmi = !this.unlimited && rem <= 0x3fffffff ? (rem | 0) : 0x3fffffff;
    this.signal = context.signal;
    this.maxBufferBytes = options.maxBufferBytes ?? Infinity;
    if (context.signal.aborted) context.signal.throwIfAborted();
    if (!validatedTextProgramOptions.has(options)) {
      for (const [key, value] of Object.entries(options)) {
        if (!key.startsWith("max")) continue;
        if (value !== undefined && (typeof value !== "number" || value !== Infinity && !Number.isSafeInteger(value) || value < 1)) throw new ProgramError("limits must be positive safe integers");
      }
      validatedTextProgramOptions.add(options);
    }
  }
  resetForRun(context: CommandContext, options: TextProgramOptions): void {
    if (context.signal.aborted) context.signal.throwIfAborted();
    const rem = options.maxSteps ?? Infinity;
    this.context = context;
    this.options = options;
    this.stepsUsed = 0;
    this.unlimited = rem === Infinity;
    this.remainingNum = this.unlimited ? 0 : rem;
    this.remainingSmi = !this.unlimited && rem <= 0x3fffffff ? (rem | 0) : 0x3fffffff;
    this.signal = context.signal;
    this.checkpoints = 0;
    this.lastYield = monotonicNow();
    this.maxBufferBytes = options.maxBufferBytes ?? Infinity;
  }
  step(count = 1): void {
    const nextSteps = this.stepsUsed + count;
    this.stepsUsed = nextSteps;
    if ((nextSteps & 1023) < count && this.signal.aborted) this.signal.throwIfAborted();
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
    // Neither elapsed work nor a stationary clock may postpone host cancellation.
    if ((count & 255) === 0) {
      return this.yieldCheckpointAsync();
    }
    if (monotonicNow() - this.lastYield >= 25) {
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
