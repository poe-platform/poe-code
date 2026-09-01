class Timer {
  #handle;

  constructor(callback, delay, args) {
    this.#handle = globalThis.setTimeout(callback, delay, ...args);
  }

  close() {
    globalThis.clearTimeout(this.#handle);
  }

  ref() {
    return this;
  }
  unref() {
    return this;
  }
}

export function setTimeout(callback, delay = 0, ...args) {
  return new Timer(callback, delay, args);
}

export function clearTimeout(timer) {
  if (timer instanceof Timer) timer.close();
  else globalThis.clearTimeout(timer);
}
