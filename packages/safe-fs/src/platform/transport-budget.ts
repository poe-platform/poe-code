import type { FsOptions } from "../contracts/filesystem.js";

export interface ScopedTransportBudgetFrame {
  credit: number;
  readonly admit: (options?: FsOptions) => void;
}

export let hasRegisteredS3FileSystem = false;

export function enableS3TransportBudget(): void {
  hasRegisteredS3FileSystem = true;
}
