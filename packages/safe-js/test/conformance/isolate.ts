import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BudgetOptions } from "../../src/interp/budget.js";
import type { executeTest262 } from "./execute.js";
import type { Test262Variant } from "./metadata.js";

export const WORKER_STARTUP_TIMEOUT_MS = 10_000;
type VariantResult = Extract<Awaited<ReturnType<typeof executeTest262>>, { kind: "test" }>["results"][number];
type Pending = { id: string; started: boolean; mode: Test262Variant["mode"]; resolve: (result: VariantResult) => void; timer: ReturnType<typeof setTimeout> };
type Worker = { process: ChildProcess; ready: Promise<void>; rejectReady: (error: Error) => void;
  startupTimer?: ReturnType<typeof setTimeout>; exit: Promise<void>; retired: boolean; pending?: Pending; stderr: string };

export function createTest262Executor(options: { timeoutMs: number; budget?: BudgetOptions }) {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("Test262 wall timeout must be positive and finite");
  let worker: Worker | undefined;
  let closed = false;
  let busy = false;
  let nextId = 0;
  const failure = (mode: Test262Variant["mode"], code: string, message: string): VariantResult => ({
    mode, status: "failed", reason: "host-error", detail: { phase: "host", code, message }
  });
  const finish = (state: Worker, result: VariantResult) => {
    const pending = state.pending;
    if (!pending) return;
    state.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(result);
  };
  const retire = (state: Worker, error: Error, result?: VariantResult) => {
    if (state.retired) return;
    state.retired = true;
    if (worker === state) worker = undefined;
    clearTimeout(state.startupTimer);
    state.rejectReady(error);
    if (state.pending) finish(state, result ?? failure(state.pending.mode, "worker-error", error.message));
    state.process.kill("SIGKILL");
  };
  const start = (): Worker => {
    const child = fork(fileURLToPath(new URL("./worker.ts", import.meta.url)), [], {
      execArgv: process.execArgv, silent: true, serialization: "advanced"
    });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    let resolveExit!: () => void;
    let readyReceived = false;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const exit = new Promise<void>(resolve => { resolveExit = resolve; });
    const state: Worker = { process: child, ready, rejectReady, exit, retired: false, stderr: "" };
    worker = state;
    state.startupTimer = setTimeout(() => retire(state, Object.assign(new Error("Test262 worker did not become ready within its separate startup allowance"),
      { code: "worker-startup-timeout" })), WORKER_STARTUP_TIMEOUT_MS);
    child.stdout?.resume();
    child.stderr?.on("data", chunk => { state.stderr = (state.stderr + String(chunk)).slice(-8192); });
    child.on("error", error => retire(state, error));
    child.on("exit", (code, signal) => {
      if (!state.retired) {
        state.retired = true;
        if (worker === state) worker = undefined;
        clearTimeout(state.startupTimer);
        const message = `Test262 worker exited (${code ?? signal ?? "unknown"})${state.stderr ? `: ${state.stderr}` : ""}`;
        rejectReady(new Error(message));
        if (state.pending) finish(state, failure(state.pending.mode, "worker-exit", message));
      }
      resolveExit();
    });
    child.on("close", () => resolveExit());
    child.on("message", message => {
      if (state.retired) return;
      const response = message as { type?: string; id?: string; result?: VariantResult; message?: string };
      if (!readyReceived && response?.type === "ready") {
        readyReceived = true; clearTimeout(state.startupTimer); resolveReady(); return;
      }
      const pending = state.pending;
      if (!readyReceived || !pending || response?.id !== pending.id) {
        retire(state, new Error("Unexpected or stale Test262 worker message")); return;
      }
      if (response.type === "started" && !pending.started) { pending.started = true; return; }
      const result = response.result;
      if (response.type === "result" && pending.started && result?.mode === pending.mode &&
          (result.status === "passed" || ((result.status === "failed" || result.status === "unsupported") && typeof result.reason === "string"))) {
        finish(state, result); return;
      }
      retire(state, new Error(response.type === "error" ? response.message ?? "Test262 worker error" : "Invalid Test262 worker result"));
    });
    return state;
  };
  return {
    async execute(input: { filename: string; source: string; mode: Test262Variant["mode"]; harness: ReadonlyMap<string, string> }): Promise<VariantResult> {
      if (closed) throw new Error("Test262 executor is disposed");
      if (busy) throw new Error("Test262 executor accepts one variant at a time");
      busy = true;
      let state: Worker | undefined;
      try {
        state = worker ?? start();
        await state.ready;
        if (state.retired || closed) return failure(input.mode, "worker-disposed", "Test262 worker was disposed before dispatch");
        const active = state;
        const id = String(++nextId);
        const result = await new Promise<VariantResult>(resolve => {
          // The parent starts the hard wall clock before dispatch, so a missing
          // started acknowledgement cannot leave a variant running unbounded.
          const timer = setTimeout(() => retire(active, new Error("Test262 variant exceeded its hard wall timeout"), {
            mode: input.mode, status: "failed", reason: "timeout", detail: {
              phase: "host", code: "worker-wall-timeout", message: `Isolated variant exceeded ${options.timeoutMs} ms; child terminated`
            }
          }), options.timeoutMs);
          active.pending = { id, started: false, mode: input.mode, resolve, timer };
          try {
            active.process.send({ type: "execute", id, filename: input.filename, source: input.source, mode: input.mode,
              harness: [...input.harness], timeoutMs: options.timeoutMs, budget: options.budget }, error => {
              if (error) retire(active, error);
            });
          } catch (error) { retire(active, error instanceof Error ? error : new Error(String(error))); }
        });
        if (active.retired) await active.exit;
        return result;
      } catch (error) {
        if (state?.retired) await state.exit;
        return failure(input.mode, error instanceof Error && "code" in error ? String(error.code) : "worker-startup-error",
          error instanceof Error ? error.message : String(error));
      } finally { busy = false; }
    },
    async dispose(): Promise<void> {
      closed = true;
      const state = worker;
      if (state) { retire(state, new Error("Test262 executor disposed")); await state.exit; }
    }
  };
}
