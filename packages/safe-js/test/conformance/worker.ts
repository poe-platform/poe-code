import { pathToFileURL } from "node:url";
import type { BudgetOptions } from "../../src/interp/budget.js";
import { executeTest262 } from "./execute.js";
import type { Test262Variant } from "./metadata.js";

export type ExecuteRequest = {
  type: "execute";
  id: string;
  filename: string;
  source: string;
  mode: Test262Variant["mode"];
  harness: Array<[string, string]>;
  timeoutMs: number;
  budget?: BudgetOptions;
};
export type WorkerMessage = { type: "ready" } | { type: "started"; id: string }
  | { type: "error"; id?: string; message: string }
  | { type: "result"; id: string; result: Extract<Awaited<ReturnType<typeof executeTest262>>, { kind: "test" }>["results"][number] };

export async function executeWorkerRequest(input: unknown, send: (message: WorkerMessage) => void): Promise<void> {
  const request = input as Partial<ExecuteRequest> | null;
  const id = request !== null && typeof request === "object" && typeof request.id === "string" ? request.id : undefined;
  if (request === null || typeof request !== "object" || request.type !== "execute" || id === undefined ||
      typeof request.filename !== "string" || typeof request.source !== "string" ||
      !["sloppy", "strict", "module", "raw"].includes(request.mode ?? "") ||
      !Number.isFinite(request.timeoutMs) || request.timeoutMs! <= 0 ||
      !Array.isArray(request.harness) || !request.harness.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === "string"))) {
    send({ type: "error", id, message: "Invalid Test262 worker request" });
    return;
  }
  try {
    send({ type: "started", id });
    const result = await executeTest262(request.filename, request.source, {
      mode: request.mode, timeoutMs: request.timeoutMs!, budget: request.budget, harness: new Map(request.harness)
    });
    if (result.kind !== "test" || result.results.length !== 1 || result.results[0].mode !== request.mode)
      throw new Error("Worker did not return exactly the requested Test262 variant");
    send({ type: "result", id, result: result.results[0] });
  } catch (error) {
    send({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let busy = false;
  process.on("message", (request: unknown) => {
    if (busy) {
      process.send?.({ type: "error", message: "Test262 worker received overlapping execution requests" });
      return;
    }
    busy = true;
    void executeWorkerRequest(request, message => { process.send?.(message); }).finally(() => { busy = false; });
  });
  process.on("disconnect", () => { process.exit(0); });
  process.send?.({ type: "ready" });
}
