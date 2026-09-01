import { EventEmitter } from "@jspm/core/nodelibs/events";
import { sources } from "virtual:safe-bash-worker-sources";

export const isMainThread = true;

export class Worker extends EventEmitter {
  #worker;
  #url;
  #terminated = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  constructor(identity, options = {}) {
    super();
    if (!Object.hasOwn(sources, identity)) throw new Error(`Unknown browser worker: ${identity}`);
    const bootstrap = `globalThis.__safeBashWorkerData = ${JSON.stringify(options.workerData ?? null)};\n`;
    this.#url = URL.createObjectURL(
      new Blob([bootstrap, sources[identity]], { type: "text/javascript" })
    );
    try {
      this.#worker = new globalThis.Worker(this.#url, { name: `safe-bash-${identity}` });
    } catch (error) {
      URL.revokeObjectURL(this.#url);
      throw error;
    }
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
    this.#worker.terminate();
    this.#terminated = true;
    URL.revokeObjectURL(this.#url);
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
