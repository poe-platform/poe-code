import { EventEmitter } from "@jspm/core/nodelibs/events";
import { sources } from "virtual:safe-bash-worker-sources";

export const isMainThread = true;

export const browserWorkerRuntime = {
  create(identity, workerData) {
    if (!Object.hasOwn(sources, identity)) throw new Error(`Unknown browser worker: ${identity}`);
    const bootstrap = `globalThis.__safeBashWorkerData = ${JSON.stringify(workerData ?? null)};\n`;
    const url = URL.createObjectURL(new Blob([bootstrap, sources[identity]], { type: "text/javascript" }));
    let worker;
    try {
      worker = new globalThis.Worker(url, { name: `safe-bash-${identity}` });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    return {
      worker,
      close() {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    };
  }
};

export class Worker extends EventEmitter {
  #worker;
  #close;
  #terminated = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  constructor(identity, options = {}) {
    super();
    const resource = browserWorkerRuntime.create(identity, options.workerData);
    this.#worker = resource.worker;
    this.#close = resource.close;
    this.#worker.addEventListener("message", (event) => {
      if (!this.#terminated) this.emit("message", event.data);
    });
    this.#worker.addEventListener("messageerror", (event) => {
      if (!this.#terminated) this.emit("messageerror", event);
    });
    this.#worker.addEventListener("error", (event) => {
      event.preventDefault();
      if (!this.#terminated) {
        try {
          this.emit("error", new Error(event.message || "Browser worker failed"));
        } finally {
          void this.terminate();
        }
      }
    });
  }

  postMessage(value, transfer = []) {
    if (this.#terminated) throw new Error("Browser worker is closed");
    this.#worker.postMessage(value, transfer);
  }

  async terminate() {
    if (this.#terminated) return 0;
    this.#close();
    this.#terminated = true;
    for (const stream of [this.stdout, this.stderr]) {
      stream.readableEnded = true;
      stream.closed = true;
      stream.emit("end");
      stream.emit("close");
    }
    this.emit("exit", 0);
    return 0;
  }

  ref() {
    return this;
  }
  unref() {
    return this;
  }
}
