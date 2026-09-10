import type { ByteSource, CommandContext, FileSystem } from "../../../contracts/index.js";
import { inheritYieldCheckpoint } from "../../../contracts/yield.js";

export class FileOperation {
  readonly signal: AbortSignal;
  readonly fs: FileSystem;
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly sources: (() => Promise<IteratorResult<Uint8Array>>)[] = [];
  private closing: Promise<void> | undefined;
  private readonly caller: AbortSignal;

  constructor(context: CommandContext, cleanup?: () => Promise<void>) {
    this.caller = context.signal;
    this.signal = this.controller.signal;
    this.caller.throwIfAborted();
    inheritYieldCheckpoint(this.caller, this.signal);
    const filesystem = context.fs;
    this.caller.throwIfAborted();
    this.fs = new Proxy(filesystem, {
      get: (target, key) => {
        this.check();
        const value: unknown = Reflect.get(target, key, target);
        this.check();
        return typeof value === "function" ? (...args: unknown[]) => {
          this.check();
          const result: unknown = Reflect.apply(value, target, args);
          return key === "readStream" ? this.ownSource(result as ByteSource) : result;
        } : value;
      },
    });
    const abort = (): void => { void this.close().catch(() => {}); };
    this.close = (): Promise<void> => {
      if (!this.closing) {
        this.closing = Promise.resolve().then(async () => {
          try {
            const sources = Promise.allSettled(this.sources.map(close => close()));
            await Promise.allSettled([...this.pending]);
            const outcomes = await sources;
            await cleanup?.();
            const failures = outcomes.filter(outcome => outcome.status === "rejected").map(outcome => outcome.reason);
            if (failures.length === 1) throw failures[0];
            if (failures.length) throw new AggregateError(failures, "Compression source cleanup failed");
          } finally { this.caller.removeEventListener("abort", abort); }
        });
        void this.closing.catch(() => {});
        this.controller.abort(this.caller.aborted ? this.caller.reason : new Error("Compression file operation is closed"));
      }
      return this.closing;
    };
    const register = context.registerCleanup;
    this.check();
    if (register) Reflect.apply(register, context, [this.close]);
    this.check();
    this.caller.addEventListener("abort", abort, { once: true });
    if (this.caller.aborted) abort();
  }

  readonly close: () => Promise<void>;

  check(): void {
    this.caller.throwIfAborted();
    this.signal.throwIfAborted();
  }

  async run<Value>(start: () => Value | PromiseLike<Value>): Promise<Value> {
    this.check();
    const pending = Promise.resolve().then(() => { this.check(); return start(); });
    this.pending.add(pending);
    try { return await pending; }
    finally { this.pending.delete(pending); }
  }

  private ownSource(source: ByteSource): ByteSource {
    let iterator: AsyncIterator<Uint8Array> | undefined = undefined;
    let closing: Promise<IteratorResult<Uint8Array>> | undefined;
    const close = (): Promise<IteratorResult<Uint8Array>> => {
      closing ??= Promise.resolve().then(async () => {
        const method = iterator?.return;
        return method ? await Reflect.apply(method, iterator, []) : { done: true as const, value: undefined };
      });
      void closing.catch(() => {});
      return closing;
    };
    this.sources.push(close);
    const factory = source[Symbol.asyncIterator];
    iterator = Reflect.apply(factory, source, []) as AsyncIterator<Uint8Array>;
    this.check();
    let claimed = false;
    return {
      [Symbol.asyncIterator]: () => {
        this.check();
        if (claimed) throw new Error("Compression input was already acquired");
        claimed = true;
        return {
          next: async () => {
            this.check();
            if (closing) throw new Error("Compression input is closed");
            const method = iterator!.next;
            this.check();
            const result = await Reflect.apply(method, iterator, []);
            this.check();
            const done = result.done;
            this.check();
            const value = result.value;
            this.check();
            return done ? { done: true as const, value } : { done: false as const, value };
          },
          return: close,
        };
      },
    };
  }
}
