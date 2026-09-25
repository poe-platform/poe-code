import type { FsOptions } from "../contracts/filesystem.js";

export interface ScopedTransportBudgetFrame {
  credit: number;
  readonly admit: (options?: FsOptions) => void;
}
