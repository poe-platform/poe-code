import { Worker } from "node:worker_threads";
import type { Request } from "./worker.js";
import type { Execution } from "./model.js";

export class VirtualSession {
  #worker: Worker | undefined;
  #identifier = 0;
  readonly backgroundErrors: string[] = [];

  async run(request: Request): Promise<Execution> {
    if (!this.#worker) {
      const worker = new Worker(new URL("./worker-bootstrap.mjs", import.meta.url), {
        execArgv: ["--unhandled-rejections=strict"], resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      worker.on("error", error => { this.backgroundErrors.push(error.message); if (this.#worker === worker) this.#worker = undefined; });
      worker.on("exit", () => { if (this.#worker === worker) this.#worker = undefined; });
      this.#worker = worker;
    }
    const worker = this.#worker;
    const id = ++this.#identifier;
    const started = performance.now();
    return new Promise(resolve => {
      const finish = (result: Execution) => { clearTimeout(timer); worker.off("message", message); worker.off("error", error); worker.off("exit", exit); resolve(result); };
      const message = (value: { id: number; result: Execution }) => { if (value.id === id) finish(value.result); };
      const error = (value: Error) => finish({ status: "error", reason: String(value), durationMs: performance.now() - started });
      const exit = (code: number) => error(new Error(`Worker exited before result: ${code}`));
      const timer = setTimeout(() => {
        this.#worker = undefined;
        finish({ status: "timeout", reason: "Virtual text worker exceeded 3000ms", durationMs: performance.now() - started });
        void worker.terminate().catch(reason => this.backgroundErrors.push(String(reason)));
      }, 3000);
      worker.on("message", message); worker.once("error", error); worker.once("exit", exit);
      worker.postMessage({ id, request });
    });
  }

  async dispose(): Promise<void> { const worker = this.#worker; this.#worker = undefined; if (worker) await worker.terminate(); }
}
