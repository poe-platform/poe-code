import { native } from "./native.js";
export class EventQueue {
  constructor() {
    this.native = new native.NativeSpawnQueue();
    this.values = new Map();
    this.token = 0;
    this.waiters = [];
    this.failed = false;
  }
  push(value) {
    const token = ++this.token;
    if (this.native.push(token)) {
      this.values.set(token, value);
      this.flush();
    }
  }
  close() {
    this.native.close();
    this.flush();
  }
  fail(error) {
    if (!this.failed) {
      this.failed = true;
      this.failure = error;
    }
    this.native.fail();
    this.flush();
  }
  settle(action, { resolve, reject }) {
    if (action.type === "error") reject(this.failure);
    else {
      const value = this.values.get(action.value);
      this.values.delete(action.value);
      resolve({ done: action.type === "done", value });
    }
  }
  flush() {
    while (this.waiters.length) {
      const action = this.native.poll();
      if (action.type === "wait") return;
      this.settle(action, this.waiters.shift());
    }
  }
  next() {
    const action = this.native.poll();
    return new Promise((resolve, reject) => {
      if (action.type === "wait") this.waiters.push({ resolve, reject });
      else this.settle(action, { resolve, reject });
    });
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = await this.next();
      if (item.done) return;
      yield item.value;
    }
  }
}
