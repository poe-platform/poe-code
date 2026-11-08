import { native } from "./native.js";
export class EventQueue {
  constructor() {
    this.native = new native.NativeSpawnQueue();
    this.values = new Map();
    this.token = 0;
    this.waiters = [];
    this.failed = false;
    this.actions = [];
    this.actionIndex = 0;
  }
  push(value) {
    const token = ++this.token;
    if (this.native.push(token)) {
      this.values.set(token, value);
      this.flush();
    }
  }
  pushMany(values) {
    const tokens = values.map(() => ++this.token);
    if (this.native.pushMany(tokens)) {
      for (let index = 0; index < tokens.length; index++)
        this.values.set(tokens[index], values[index]);
      this.flush();
    }
  }
  takeAction() {
    if (this.actionIndex === this.actions.length) {
      const batch = this.native.pollMany(64);
      this.actions = batch.tokens.map((value) => ({ type: "value", value }));
      this.actionIndex = 0;
      if (batch.kind && (batch.kind !== "wait" || !batch.tokens.length))
        this.actions.push({ type: batch.kind });
    }
    const action = this.actions[this.actionIndex];
    this.actions[this.actionIndex++] = undefined;
    if (this.actionIndex === this.actions.length) {
      this.actions = [];
      this.actionIndex = 0;
    }
    return action;
  }
  abandon() {
    this.abandoned = true;
    this.values.clear();
    this.actions = [];
    this.actionIndex = 0;
    this.native.abandon();
    this.flush();
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
      const action = this.takeAction();
      if (action.type === "wait") return;
      this.settle(action, this.waiters.shift());
    }
  }
  next() {
    const action = this.takeAction();
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
