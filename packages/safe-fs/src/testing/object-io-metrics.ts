export interface ObjectIoOperationMetrics {
  count: number;
  failed: number;
  elapsedMs: number;
}

export interface ObjectIoPhaseMetrics {
  elapsedMs: number;
  operations: Record<string, ObjectIoOperationMetrics>;
}

export class ObjectIoMetrics {
  private readonly phases: Record<string, ObjectIoPhaseMetrics> = {};
  private current = "setup";
  private started: number;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = now();
    this.phases[this.current] = { elapsedMs: 0, operations: {} };
  }

  phase(name: string): void {
    const time = this.now();
    this.phases[this.current]!.elapsedMs += time - this.started;
    this.started = time;
    this.current = name;
    this.phases[name] ??= { elapsedMs: 0, operations: {} };
  }

  async measure<Value>(category: string, name: string, operation: () => Value | Promise<Value>): Promise<Value> {
    const operations = this.phases[this.current]!.operations;
    const entry = operations[`${category}.${name}`] ??= { count: 0, failed: 0, elapsedMs: 0 };
    entry.count++;
    const started = this.now();
    try { return await operation(); }
    catch (error) { entry.failed++; throw error; }
    finally { entry.elapsedMs += this.now() - started; }
  }

  snapshot(): Record<string, ObjectIoPhaseMetrics> {
    const result = structuredClone(this.phases);
    result[this.current]!.elapsedMs += this.now() - this.started;
    return result;
  }
}

export function delayObjectIoBackend<Backend extends object>(
  backend: Backend,
  metrics: ObjectIoMetrics,
  delayMs: number,
  sleep: (duration: number) => Promise<void> = duration => new Promise(resolve => setTimeout(resolve, duration)),
): Backend {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new RangeError("Backend delay must be a nonnegative integer");
  return new Proxy(backend, { get(target, property) {
    const value: unknown = Reflect.get(target, property, target);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => metrics.measure("backend", String(property), async () => {
      if (delayMs) await sleep(delayMs);
      return value.apply(target, args);
    });
  } });
}

export interface ObjectIoReadbackOptions {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly metrics: ObjectIoMetrics;
  dispose(): Promise<void>;
  summary(): Record<string, unknown>;
}

export function createObjectIoReadbackStream(options: ObjectIoReadbackOptions): ReadableStream<Uint8Array> {
  const reader = options.body.getReader({ mode: "byob" });
  const encoder = new TextEncoder();
  let offset = 0;
  let cleanup: Promise<void> | undefined;
  const dispose = (): Promise<void> => cleanup ??= (async () => {
    options.metrics.phase("fixtureCleanup");
    await options.dispose();
    options.metrics.phase("complete");
  })();
  options.metrics.phase("canonicalStream");
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await options.metrics.measure("stream", "read", () => reader.read(new Uint8Array(65536)));
        if (chunk.done) {
          if (offset !== options.size) throw new Error("Canonical readback size mismatch");
          await dispose();
          controller.enqueue(encoder.encode(JSON.stringify({ ...options.summary(), type: "summary", completed: true,
            canonicalBytes: offset, phases: options.metrics.snapshot() }) + "\n"));
          controller.close();
          reader.releaseLock();
          return;
        }
        if (offset + chunk.value.length > options.size) throw new Error("Canonical readback size mismatch");
        const base64 = btoa(String.fromCharCode(...chunk.value));
        controller.enqueue(encoder.encode(JSON.stringify({ type: "chunk", offset, base64 }) + "\n"));
        offset += chunk.value.length;
      } catch (error) {
        let failure = error;
        try { await reader.cancel(error); }
        catch (cancelError) { if (cancelError !== error) failure = new AggregateError([error, cancelError], "Readback and cancellation failed"); }
        try { await dispose(); }
        catch (cleanupError) { failure = new AggregateError([failure, cleanupError], "Readback and cleanup failed"); }
        reader.releaseLock();
        controller.error(failure);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); }
      finally { await dispose(); reader.releaseLock(); }
    },
  });
}
