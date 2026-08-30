import { Worker } from "node:worker_threads";
import { taskInfo, type Engine, type Task, type CaseResult } from "./model.js";

export class EngineSession {
  readonly backgroundErrors: string[] = [];
  #worker: Worker | undefined;
  #nextId = 1;

  constructor(readonly engine: Engine, readonly timeoutMs = 6500) {}

  async run(task: Task): Promise<CaseResult> {
    const worker = this.#worker ??= new Worker(new URL("./worker-bootstrap.mjs", import.meta.url), {
      workerData: { engine: this.engine }, execArgv: ["--unhandled-rejections=strict"],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    if (worker.listenerCount("error") === 0) {
      worker.on("error", (error) => {
        this.backgroundErrors.push(error.message);
        if (this.#worker === worker) this.#worker = undefined;
      });
      worker.on("exit", () => { if (this.#worker === worker) this.#worker = undefined; });
    }
    const id = this.#nextId++;
    const start = performance.now();
    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
      };
      const finish = (result: CaseResult) => { cleanup(); resolve(result); };
      const failure = (status: "error" | "timeout", reason: string) => finish({ engine: this.engine,
        ...taskInfo(task), status, reason, assertions: [], durationMs: performance.now() - start });
      const onMessage = (message: { id: number; result: CaseResult }) => { if (message.id === id) finish(message.result); };
      const onError = (error: Error) => failure("error", error.message);
      const onExit = (code: number) => failure("error", `Worker exited before returning a result: ${code}`);
      const timer = setTimeout(() => {
        if (this.#worker === worker) this.#worker = undefined;
        failure("timeout", `Hard worker deadline exceeded: ${this.timeoutMs}ms`);
        void worker.terminate().catch(() => {});
      }, this.timeoutMs);
      worker.on("message", onMessage);
      worker.once("error", onError);
      worker.once("exit", onExit);
      worker.postMessage({ id, task });
    });
  }

  async dispose(): Promise<void> {
    const worker = this.#worker;
    this.#worker = undefined;
    if (worker) await worker.terminate();
  }
}
