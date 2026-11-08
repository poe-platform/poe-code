import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");

export class AsyncEventQueue {
  #queue = new native.NativeAgentEventQueue();
  #roots = new Map();
  #free = [];
  #next = 0;
  constructor(onReturn) {
    this.onReturn = onReturn;
  }
  #store(value) {
    const handle = this.#free.length ? this.#free.pop() : this.#next++;
    if (handle > 0xffffffff) throw new RangeError("Too many simultaneous queued agent events.");
    this.#roots.set(handle, value);
    return handle;
  }
  #take(handle) {
    const value = this.#roots.get(handle);
    this.#roots.delete(handle);
    this.#free.push(handle);
    return value;
  }
  push(item) {
    const handle = this.#store(item),
      waiter = this.#queue.push(handle);
    if (waiter === -2) {
      this.#take(handle);
      return;
    }
    if (waiter !== -1) {
      const resolve = this.#take(waiter);
      resolve({ done: false, value: this.#take(handle) });
    }
  }
  close() {
    for (const waiter of this.#queue.close()) this.#take(waiter)({ done: true, value: undefined });
  }
  async next() {
    const item = this.#queue.take();
    if (item === -2) return { done: true, value: undefined };
    if (item !== -1) return { done: false, value: this.#take(item) };
    return new Promise((resolve) => this.#queue.wait(this.#store(resolve)));
  }
  async return() {
    this.onReturn();
    this.close();
    return { done: true, value: undefined };
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}
