import { Diff3Error, type Diff3Accounting, type Diff3Limits } from './contracts.js';
export class Budget {
  readonly limits: Diff3Limits;
  private aborted = false;
  private readonly onAbort = (): void => { this.aborted = true; };
  readonly pollSignal: boolean;
  inputBytes = 0; retainedBytes = 0; peakRetainedBytes = 0;
  tokens = 0; graphCells = 0; peakGraphCells = 0; work = 0;
  constructor(limits: Partial<Diff3Limits>, readonly signal?: AbortSignal) {
    this.limits = { inputBytes: Infinity, retainedBytes: Infinity, tokens: Infinity, graphCells: Infinity, work: Infinity, ...limits };
    for (const resource of ['inputBytes', 'retainedBytes', 'tokens', 'graphCells', 'work'] as const) {
      if (this.limits[resource] !== Infinity && (!Number.isSafeInteger(this.limits[resource]) || this.limits[resource] < 0)) throw new Diff3Error('LIMIT', 'Limits must be nonnegative safe integers', resource);
    }
    this.aborted = Boolean(signal?.aborted);
    this.pollSignal = Boolean(signal && (typeof signal.addEventListener !== "function" || Object.prototype.hasOwnProperty.call(signal, "aborted")));
    if (signal && !this.aborted && !this.pollSignal) {
      signal.addEventListener("abort", this.onAbort, { once: true });
    }
  }
  admit(resource: keyof Diff3Limits, amount: number): void {
    if (resource === "work" && !this.aborted && !this.pollSignal && amount >= 0 && this.work + amount <= this.limits.work) {
      this.work += amount;
      return;
    }
    if (this.aborted || (this.pollSignal && this.signal!.aborted)) throw new Diff3Error('CANCELLED', 'Diff3 invocation cancelled');
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits[resource] - this[resource]) throw new Diff3Error('LIMIT', `Diff3 ${resource} limit exceeded`, resource);
    this[resource] += amount;
    if (resource === "retainedBytes" && this.retainedBytes > this.peakRetainedBytes) this.peakRetainedBytes = this.retainedBytes;
    else if (resource === "graphCells" && this.graphCells > this.peakGraphCells) this.peakGraphCells = this.graphCells;
  }
  dispose(): void {
    this.signal?.removeEventListener?.("abort", this.onAbort);
    this.retainedBytes = this.tokens = this.graphCells = 0;
  }
  snapshot(): Diff3Accounting {
    return { inputBytes: this.inputBytes, retainedBytes: this.retainedBytes, peakRetainedBytes: this.peakRetainedBytes, tokens: this.tokens, graphCells: this.graphCells, peakGraphCells: this.peakGraphCells, work: this.work };
  }
}
