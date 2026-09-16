import { createOutputOperation, type ByteSource, type CommandContext, type InvocationCleanup } from "../../contracts/index.js";
import { yieldTurn } from "../../contracts/yield.js";

export const mikeLimits = Object.freeze({
  maxInputBytes: 8 * 1024 * 1024, maxDocumentBytes: 1024 * 1024,
  maxScalarBytes: 256 * 1024, maxNodes: 100_000, maxParserNodes: 4096,
  maxDepth: 64, maxAliases: 1024, maxDocuments: 1024,
  maxOutputBytes: 16 * 1024 * 1024, maxSteps: 8_000_000,
});
export type MikeLimits = { readonly [Key in keyof typeof mikeLimits]: number };

export class MikeError extends Error {
  constructor(message: string, readonly usage = false) { super(message); }
}

export function limitsFor(options: Partial<MikeLimits> = {}): MikeLimits {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("invalid yq limits");
  const limits: { -readonly [Key in keyof MikeLimits]: number } = { ...mikeLimits };
  for (const [name, value] of Object.entries(options)) {
    if (!Object.hasOwn(limits, name) || !Number.isSafeInteger(value) || value < 1 || value > mikeLimits[name as keyof MikeLimits]) {
      throw new TypeError(`invalid yq limit: ${name}`);
    }
    limits[name as keyof MikeLimits] = value;
  }
  return Object.freeze(limits);
}

export class NativeWork {
  readonly implicitTags = new WeakSet<object>();
  readonly controller = new AbortController();
  readonly signal: AbortSignal = this.controller.signal;
  readonly #cleanup: InvocationCleanup[] = [];
  readonly #pending = new Set<Promise<unknown>>();
  #closing: Promise<void> | undefined;
  #open = true;
  #steps = 0;
  #yieldAt = 1024;
  #input = 0;
  #nodes = 0;
  #aliases = 0;
  #output = 0;
  #documents = 0;

  constructor(readonly context: CommandContext, readonly limits: MikeLimits) {
    context.registerCleanup?.(() => this.close());
    const abort = () => this.controller.abort(context.signal.reason);
    if (context.signal.aborted) abort();
    else context.signal.addEventListener("abort", abort, { once: true });
    this.#cleanup.push(() => { context.signal.removeEventListener("abort", abort); });
  }

  assertOpen(): void {
    this.context.signal.throwIfAborted();
    this.signal.throwIfAborted();
    if (!this.#open) throw new MikeError("yq invocation is closed");
  }

  async tick(units = 1): Promise<void> {
    this.assertOpen();
    this.#steps += units;
    if (!Number.isSafeInteger(this.#steps) || this.#steps > this.limits.maxSteps) throw new MikeError("yq limit exceeded: maxSteps");
    if (this.#steps >= this.#yieldAt) {
      this.#yieldAt = this.#steps + 1024;
      await yieldTurn(this.signal);
      this.assertOpen();
    }
  }

  input(bytes: number): void {
    this.assertOpen();
    if (bytes > this.limits.maxInputBytes - this.#input) throw new MikeError("yq limit exceeded: maxInputBytes");
    this.#input += bytes;
  }

  node(count = 1): void {
    this.assertOpen();
    this.#nodes += count;
    if (this.#nodes > this.limits.maxNodes) throw new MikeError("yq limit exceeded: maxNodes");
  }

  alias(): void {
    if (++this.#aliases > this.limits.maxAliases) throw new MikeError("yq limit exceeded: maxAliases");
  }

  document(): void {
    this.assertOpen();
    if (++this.#documents > this.limits.maxDocuments) throw new MikeError("yq limit exceeded: maxDocuments");
  }

  depth(depth: number): void {
    if (depth > this.limits.maxDepth) throw new MikeError("yq limit exceeded: maxDepth");
  }

  output(bytes: number): void {
    this.assertOpen();
    if (bytes > this.limits.maxOutputBytes - this.#output) throw new MikeError("yq limit exceeded: maxOutputBytes");
    this.#output += bytes;
  }

  register(cleanup: InvocationCleanup): void { this.assertOpen(); this.#cleanup.push(cleanup); }

  track<Value>(promise: Promise<Value>): Promise<Value> {
    this.#pending.add(promise);
    void promise.then(() => this.#pending.delete(promise), () => this.#pending.delete(promise));
    return promise;
  }

  async acquire<Value>(start: () => Value | Promise<Value>, release: (value: Value) => void | Promise<void>): Promise<Value> {
    this.assertOpen();
    let resource: { value: Value } | undefined;
    let settled!: () => void;
    const ready = new Promise<void>(resolve => { settled = resolve; });
    let released: Promise<void> | undefined;
    const dispose = () => released ??= ready.then(async () => { if (resource) await release(resource.value); });
    this.register(dispose);
    try {
      const value = await this.track(Promise.resolve().then(() => { this.assertOpen(); return start(); }));
      resource = { value };
      settled();
      this.assertOpen();
      return value;
    } catch (error) { settled(); await dispose(); throw error; }
  }

  async collect(start: () => ByteSource): Promise<Uint8Array> {
    const iterator = await this.acquire(() => start()[Symbol.asyncIterator](), async value => { await value.return?.(); });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      this.assertOpen();
      const next = await this.track(Promise.resolve(iterator.next()));
      this.assertOpen();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
      this.input(next.value.byteLength);
      if (next.value.byteLength) { const copy = new Uint8Array(next.value); chunks.push(copy); size += copy.length; }
      await this.tick();
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; await this.tick(); }
    return result;
  }

  async write(bytes: Uint8Array, stderr = false): Promise<void> {
    this.assertOpen();
    const operation = createOutputOperation({ signal: this.signal, registerCleanup: cleanup => this.register(cleanup) }, stderr ? this.context.stderr : this.context.stdout);
    try { await this.track(operation.output.write(bytes)); this.assertOpen(); }
    finally { await operation.close(); }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#open = false;
    this.controller.abort(new MikeError("yq invocation is closed"));
    this.#closing = (async () => {
      const closed = Promise.allSettled(this.#cleanup.map(async cleanup => cleanup()));
      while (this.#pending.size) await Promise.allSettled([...this.#pending]);
      const failures = (await closed).filter(result => result.status === "rejected").map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, "yq cleanup failed");
    })();
    void this.#closing.catch(() => {});
    return this.#closing;
  }
}
