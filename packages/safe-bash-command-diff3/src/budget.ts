import { Diff3Error, type Diff3Accounting, type Diff3Limits } from './contracts.js';
export class Budget {
  readonly limits: Diff3Limits;
  inputBytes = 0; retainedBytes = 0; peakRetainedBytes = 0;
  tokens = 0; graphCells = 0; peakGraphCells = 0; work = 0;
  constructor(limits: Partial<Diff3Limits>, readonly signal?: AbortSignal) {
    this.limits = { inputBytes: Infinity, retainedBytes: Infinity, tokens: Infinity, graphCells: Infinity, work: Infinity, ...limits };
    for (const resource of ['inputBytes', 'retainedBytes', 'tokens', 'graphCells', 'work'] as const) {
      if (this.limits[resource] !== Infinity && (!Number.isSafeInteger(this.limits[resource]) || this.limits[resource] < 0)) throw new Diff3Error('LIMIT', 'Limits must be nonnegative safe integers', resource);
    }
  }
  admit(resource: keyof Diff3Limits, amount: number): void {
    if (this.signal?.aborted) throw new Diff3Error('CANCELLED', 'Diff3 invocation cancelled');
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits[resource] - this[resource]) throw new Diff3Error('LIMIT', `Diff3 ${resource} limit exceeded`, resource);
    this[resource] += amount;
    this.peakRetainedBytes = Math.max(this.peakRetainedBytes, this.retainedBytes);
    this.peakGraphCells = Math.max(this.peakGraphCells, this.graphCells);
  }
  snapshot(): Diff3Accounting {
    return { inputBytes: this.inputBytes, retainedBytes: this.retainedBytes, peakRetainedBytes: this.peakRetainedBytes, tokens: this.tokens, graphCells: this.graphCells, peakGraphCells: this.peakGraphCells, work: this.work };
  }
}
