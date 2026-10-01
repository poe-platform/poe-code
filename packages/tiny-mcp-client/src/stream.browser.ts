/** Internal HTTP message channel. The browser build never exposes stdio streams. */
export class PassThrough implements AsyncIterable<Uint8Array> {
  destroyed = false;
  writableEnded = false;
  private readonly chunks: Uint8Array[] = [];
  private wake: (() => void) | undefined;
  private failure: Error | undefined;
  private readonly listeners = new Map<string, Set<(error?: Error) => void>>();

  once(event: string, listener: (error?: Error) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  write(value: string | Uint8Array): boolean {
    if (this.destroyed || this.writableEnded) throw this.failure ?? new Error("HTTP message channel is closed");
    this.chunks.push(typeof value === "string" ? new TextEncoder().encode(value) : value.slice());
    this.wake?.();
    return true;
  }

  end(): this {
    this.writableEnded = true;
    this.wake?.();
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.failure = error;
    this.chunks.length = 0;
    this.wake?.();
    const errors = this.listeners.get("error"), close = this.listeners.get("close");
    this.listeners.clear();
    if (error !== undefined) for (const listener of errors ?? []) listener(error);
    for (const listener of close ?? []) listener();
    return this;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    try {
      for (;;) {
        if (this.failure !== undefined) throw this.failure;
        const chunk = this.chunks.shift();
        if (chunk !== undefined) { yield chunk; continue; }
        if (this.writableEnded || this.destroyed) return;
        await new Promise<void>(resolve => { this.wake = resolve; });
        this.wake = undefined;
      }
    } finally { this.destroy(); }
  }
}
