import { Diff3Error, type Diff3Accounting, type Diff3Limits } from './contracts.js';
export class Budget {
  readonly limits: Diff3Limits;
  private aborted = false;
  private readonly pollSignal: boolean;
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
      signal.addEventListener("abort", () => { this.aborted = true; }, { once: true });
    }
  }
  admit(resource: keyof Diff3Limits, amount: number): void {
    if (this.aborted || (this.pollSignal && this.signal!.aborted)) throw new Diff3Error('CANCELLED', 'Diff3 invocation cancelled');
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits[resource] - this[resource]) throw new Diff3Error('LIMIT', `Diff3 ${resource} limit exceeded`, resource);
    this[resource] += amount;
    if (resource === "retainedBytes" && this.retainedBytes > this.peakRetainedBytes) this.peakRetainedBytes = this.retainedBytes;
    else if (resource === "graphCells" && this.graphCells > this.peakGraphCells) this.peakGraphCells = this.graphCells;
  }
  snapshot(): Diff3Accounting {
    return { inputBytes: this.inputBytes, retainedBytes: this.retainedBytes, peakRetainedBytes: this.peakRetainedBytes, tokens: this.tokens, graphCells: this.graphCells, peakGraphCells: this.peakGraphCells, work: this.work };
  }
}
