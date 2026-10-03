export const outputBytes = Uint8Array.from.bind(Uint8Array);

type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  private readonly listeners = new Map<string, Set<Listener>>();
  on<Args extends unknown[]>(event: string, listener: (...args: Args) => void): this {
    let listeners = this.listeners.get(event);
    if (!listeners) this.listeners.set(event, listeners = new Set());
    listeners.add(listener as Listener);
    return this;
  }
  once<Args extends unknown[]>(event: string, listener: (...args: Args) => void): this {
    const once = (...args: Args): void => { this.removeListener(event, once); listener(...args); };
    return this.on(event, once);
  }
  removeListener<Args extends unknown[]>(event: string, listener: (...args: Args) => void): this {
    this.listeners.get(event)?.delete(listener as Listener);
    return this;
  }
  listenerCount(event:string):number{return this.listeners.get(event)?.size??0;}
  emit(event: string, ...args: unknown[]): boolean {
    const listeners = [...this.listeners.get(event) ?? []];
    for (const listener of listeners) listener(...args);
    return listeners.length > 0;
  }
}

/** Browser Sharp streams use standard Web Streams for pressure and cancellation. */
export class Duplex extends EventEmitter {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  writableFinished = false;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private closed = false;
  private destruction?: Promise<void>;

  constructor() {
    super();
    this.readable = new ReadableStream({
      start: controller => { this.controller = controller; },
      pull: async () => {
        try { await this._read(); }
        catch (error) { this.destroy(error instanceof Error ? error : new Error(String(error))); }
      },
      cancel: reason => this.dispose(reason instanceof Error ? reason : undefined),
    }, { highWaterMark: 0 });
    this.writable = new WritableStream({
      write: chunk => new Promise<void>((resolve, reject) => {
        this._write(chunk, "utf8", error => {
          if (error) { this.destroy(error); reject(error); }
          else resolve();
        });
      }),
      close: () => { this.writableFinished = true; this.emit("finish"); },
      abort: reason => this.dispose(reason instanceof Error ? reason : undefined),
    });
  }

  _write(_chunk: unknown, _encoding: string, callback: (error?: Error | null) => void): void {
    callback(new Error("Writable operation is not implemented"));
  }
  _read(): void | Promise<void> { throw new Error("Readable operation is not implemented"); }
  push(chunk: Uint8Array | null): boolean {
    if (this.closed) return false;
    if (chunk === null) { this.closed = true; this.controller.close(); }
    else this.controller.enqueue(new Uint8Array(chunk));
    return (this.controller.desiredSize ?? 0) > 0;
  }
  /** Release asynchronous backing resources; subclasses retain their own error policy. */
  _destroy(_error?: Error): void | Promise<void> {}
  async dispose(error?: Error): Promise<void> {
    this.destroy(error);
    await this.destruction;
  }
  destroy(error?: Error): this {
    if (this.destruction) return this;
    // Install the promise before invoking hooks or listeners, which may reenter.
    this.destruction = Promise.resolve().then(() => this._destroy(error));
    // Synchronous callers cannot await cleanup; dispose/cancel/abort still observe it.
    void this.destruction.catch(() => {});
    if (!this.closed) {
      this.closed = true;
      this.controller.error(error ?? new Error("Stream cancelled"));
      this.emit("error", error ?? new Error("Stream cancelled"));
    }
    return this;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    const reader = this.readable.getReader();
    let failed=false;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        yield result.value;
      }
    } catch(error){failed=true;throw error;}
    finally {await this.finishIteration(reader,failed);}
  }
  private async finishIteration(reader:ReadableStreamDefaultReader<Uint8Array>,failed:boolean):Promise<void>{
    let cleanup:{error:unknown}|undefined;
    try{await reader.cancel();}catch(error){cleanup={error};}
    try{await this.destruction;}catch(error){cleanup??={error};}
    reader.releaseLock();
    if(!failed&&cleanup)throw cleanup.error;
  }
}
