import { Worker as NodeWorker } from "node:worker_threads";
import { resolveObjectURL } from "node:buffer";

export function browserWorkerFixture(executionSource: string) {
  const active = new Set<Promise<number>>();
  const workers = new Set<InstanceType<typeof BrowserWorker>>();
  class BrowserWorker extends EventTarget {
    private terminated = false;
    private readonly worker: Promise<NodeWorker>;

    constructor(url: string | URL) {
      super();
      const source = String(url).endsWith("/execution-worker.ts")
        ? Promise.resolve(executionSource)
        : resolveObjectURL(String(url))?.text();
      if (!source) throw new Error(`Unknown test worker: ${String(url)}`);
      workers.add(this);
      this.worker = source.then((code) => {
        const worker = new NodeWorker(`
          const { parentPort } = require("node:worker_threads");
          globalThis.addEventListener = (event, handler) => parentPort.on(event, data => handler({ data }));
          globalThis.postMessage = value => parentPort.postMessage(value);
          (() => { ${code} })();
        `, { eval: true });
        worker.on("message", (data) => {
          if (!this.terminated) this.dispatchEvent(new MessageEvent("message", { data }));
        });
        worker.on("error", (error) => {
          if (!this.terminated) this.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: error.message }));
        });
        if (this.terminated) active.add(worker.terminate());
        return worker;
      });
    }

    postMessage(value: unknown) {
      const cloned = structuredClone(value);
      void this.worker.then((worker) => {
        if (!this.terminated) worker.postMessage(cloned);
      });
    }

    terminate() {
      if (this.terminated) return;
      this.terminated = true;
      workers.delete(this);
      active.add(this.worker.then((worker) => worker.terminate()));
    }
  }
  return {
    Worker: BrowserWorker,
    workers,
    async close() {
      for (const worker of workers) worker.terminate();
      await Promise.all(active);
      active.clear();
    }
  };
}
