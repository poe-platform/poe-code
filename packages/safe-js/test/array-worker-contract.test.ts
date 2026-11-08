import { describe, expect, it } from "vitest";

import { requireBoundedWorkerSuccess, type WorkerReceipt } from "./fixtures/array-worker.js";

describe("bounded Array observation worker receipts", () => {
  it("accepts only an observed successful worker", () => {
    expect(() => requireBoundedWorkerSuccess({ status: 0, signal: null, pid: 123 })).not.toThrow();
  });

  it.each<WorkerReceipt>([
    { status: null, signal: null, pid: 123 },
    { status: 1, signal: null, pid: 123 },
    { status: 0, signal: "SIGKILL", pid: 123 },
    {
      status: 0,
      signal: null,
      pid: 123,
      error: Object.assign(new Error("watchdog"), { code: "ETIMEDOUT" })
    },
    {
      status: 0,
      signal: null,
      pid: 123,
      error: Object.assign(new Error("output cap"), { code: "ENOBUFS" })
    },
    {
      status: 0,
      signal: null,
      pid: 0,
      error: Object.assign(new Error("spawn"), { code: "ENOENT" })
    },
    { status: 0, signal: null, pid: 0 }
  ])("rejects incomplete or failed process evidence %#", (receipt) => {
    expect(() => requireBoundedWorkerSuccess(receipt)).toThrow();
  });
});
