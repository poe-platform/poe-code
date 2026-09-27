import type { FsOptions } from "../contracts/filesystem.js";

export interface ScopedTransportBudgetFrame {
  credit: number;
  readonly admit: (options?: FsOptions) => void;
}

export let hasRegisteredS3FileSystem = false;

export function enableS3TransportBudget(): void {
  hasRegisteredS3FileSystem = true;
}

const budgetKey = Symbol("scoped-transport-budget");
type BudgetOptions = FsOptions & { readonly [budgetKey]?: readonly ScopedTransportBudgetFrame[] };

export function scopeTransportOptions(options: FsOptions, admit: (options?: FsOptions) => void, credit: number): FsOptions {
  const parent = (options as BudgetOptions)[budgetKey] ?? [];
  return { ...options, [budgetKey]: [...parent, { credit, admit }] } as BudgetOptions;
}

export function chargeTransportOptions(options?: FsOptions): void {
  for (const frame of (options as BudgetOptions | undefined)?.[budgetKey] ?? []) {
    if (frame.credit > 0) frame.credit--;
    else frame.admit(options);
  }
}
