import type { CommandInput } from "./command.js";
import type { FileStat } from "./filesystem.js";

export type DescriptorRight = "read" | "write" | "seek" | "stat";

/** Borrow one admitted open description. Closing a lease drains its work without
 * closing the shell descriptor. Duplicates retain one identity and cursor. */
export interface DescriptorLease {
  readonly identity: object;
  readonly position?: number;
  readonly consumerClosed?: AbortSignal;
  read?: CommandInput["read"];
  write?(bytes: Uint8Array, signal: AbortSignal): Promise<number>;
  seek?: CommandInput["seek"];
  stat?(signal: AbortSignal): Promise<FileStat>;
  close(): Promise<void>;
}

export interface AdmittedHandles {
  acquire(fd: number, rights: readonly DescriptorRight[], signal: AbortSignal): Promise<DescriptorLease>;
}
