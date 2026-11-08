export type WorkerReceipt = {
  status: number | null;
  signal: string | null;
  pid: number;
  error?: Error;
};

export const arrayWorkerBounds = {
  workerWatchdogMs: 10000,
  coordinatorWatchdogMs: 90000,
  oldSpaceMiB: 192,
  outputBytes: 2097152
} as const;

export function requireBoundedWorkerSuccess(receipt: WorkerReceipt): void {
  if (receipt.error !== undefined) throw receipt.error;
  if (receipt.signal !== null) throw new Error("Observation worker signal: " + receipt.signal);
  if (receipt.status !== 0) throw new Error("Observation worker exit: " + String(receipt.status));
  if (!Number.isInteger(receipt.pid) || receipt.pid <= 0) {
    throw new Error("Observation worker has no valid process identity");
  }
}
