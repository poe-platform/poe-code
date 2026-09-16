import { PandocError } from "./errors.js";
import type {
  AdapterContext,
  ConversionContext,
  Diagnostic,
  DiagnosticCode,
  Limits,
  Operation
} from "./types.js";

/** Finite hard ceilings; callers may only lower them. No ambient environment settings. */
export const defaultLimits: Limits = Object.freeze({
  inputBytes: 32 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  resourceBytes: 64 * 1024 * 1024,
  retainedBytes: 128 * 1024 * 1024,
  text: 32 * 1024 * 1024,
  nodes: 100_000,
  depth: 128,
  attributes: 100_000,
  tableCells: 100_000,
  tableFieldText: 1024 * 1024,
  tableRows: 10_000,
  tableColumns: 1_024,
  resources: 1_024,
  diagnostics: 1_024,
  references: 100_000,
  entities: 100_000,
  entityBytes: 8 * 1024 * 1024,
  work: 1_000_000,
  compressedBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  parts: 4_096,
  xmlDepth: 128,
  xmlNodes: 100_000,
  binaryBytes: 16 * 1024 * 1024,
  macros: 10_000,
  includes: 256,
  directives: 10_000,
  fonts: 64,
  glyphs: 1_000_000,
  pages: 1_000,
  objects: 100_000,
  images: 1_024,
  layoutWork: 1_000_000
});

type Chunks = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
// RTF's common ANSI page differs from Latin-1 only in this byte range.
const windows1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178
] as const;

export class ExecutionContext implements AdapterContext {
  readonly limits: Limits;
  readonly signal: AbortSignal | undefined;
  readonly resources: AdapterContext["resources"];
  private readonly usage: Record<keyof Limits, number>;
  private readonly cursors = new Map<string, number>();
  private readonly notices: Diagnostic[] = [];
  private readonly cleanups = new Set<() => Promise<unknown>>();
  private readonly closedSignal = new AbortController();
  private failure: PandocError | undefined;
  private closing: Promise<void> | undefined;
  private outputComplete = false;
  private completingOutput: Promise<void> | undefined;
  private outputStarted = false;
  private pendingOutput = false;
  private sinceYield = 0;

  constructor(
    readonly operation: Operation,
    readonly context: ConversionContext
  ) {
    this.signal = context.signal;
    const limits = { ...defaultLimits };
    this.usage = Object.fromEntries(Object.keys(limits).map((key) => [key, 0])) as Record<
      keyof Limits,
      number
    >;
    for (const [key, value] of Object.entries(context.limits ?? {})) {
      if (
        !Object.hasOwn(limits, key) ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > limits[key as keyof Limits]
      )
        this.fail("E_OPTION", `Invalid limit: ${key}`);
      limits[key as keyof Limits] = value;
    }
    this.limits = Object.freeze(limits);
    this.resources =
      context.resources === undefined
        ? undefined
        : {
            resolve: async (id, base) => {
              this.checkpoint();
              this.charge("resources", 1);
              const bytes = await this.call(() =>
                context.resources!.resolve(id, base, this.signal)
              );
              this.charge("resourceBytes", bytes.byteLength);
              this.charge("retainedBytes", bytes.byteLength);
              this.checkpoint(Math.ceil(bytes.byteLength / 4096));
              // Own before yielding or invoking another resolver.
              const owned = new Uint8Array(bytes);
              await this.cooperate(0);
              return owned;
            }
          };
    this.checkpoint(0);
  }

  fail(code: DiagnosticCode, message: string): never {
    this.failure ??= new PandocError(code, this.operation, message);
    throw this.failure;
  }

  checkpoint(units = 1): void {
    if (this.failure) throw this.failure;
    if (this.signal?.aborted) this.fail("E_CANCELLED", "Conversion cancelled");
    if (this.closing) this.fail("E_IO", "Execution context is closed");
    this.charge("work", units);
    this.sinceYield += units;
  }

  bound(key: keyof Limits, actual: number): void {
    if (this.failure) throw this.failure;
    if (this.signal?.aborted) this.fail("E_CANCELLED", "Conversion cancelled");
    if (this.closing) this.fail("E_IO", "Execution context is closed");
    if (!Object.hasOwn(this.limits, key) || !Number.isSafeInteger(actual) || actual < 0)
      this.fail("E_INTERNAL", "Invalid budget charge");
    if (actual > this.limits[key])
      this.fail("E_LIMIT", `${key}: ${actual} exceeds ${this.limits[key]}`);
  }

  charge(key: keyof Limits, units: number): void {
    if (this.failure) throw this.failure;
    if (this.signal?.aborted) this.fail("E_CANCELLED", "Conversion cancelled");
    if (this.closing) this.fail("E_IO", "Execution context is closed");
    if (!Number.isSafeInteger(units) || units < 0 || !Object.hasOwn(this.usage, key))
      this.fail("E_INTERNAL", "Invalid budget charge");
    const keys: (keyof Limits)[] =
      key === "expandedBytes" || key === "binaryBytes"
        ? [key, "resourceBytes", "retainedBytes"]
        : [key];
    // Admit the whole reservation before changing any counter.
    for (const budget of keys) this.bound(budget, this.usage[budget] + units);
    for (const budget of keys) this.usage[budget] += units;
  }

  remaining(key: keyof Limits): number {
    this.checkpoint(0);
    return this.limits[key] - this.usage[key];
  }

  async cooperate(units = 1): Promise<void> {
    this.checkpoint(units);
    if (this.sinceYield >= 256) {
      this.sinceYield = 0;
      await this.call(
        this.context.yield ?? (() => new Promise((resolve) => setTimeout(resolve, 0)))
      );
    }
    this.checkpoint(0);
  }

  progress(id: string, cursor: number): void {
    this.checkpoint();
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      (this.cursors.has(id) && cursor <= this.cursors.get(id)!)
    )
      this.fail("E_LIMIT", "Layout must make deterministic progress");
    this.charge("layoutWork", 1);
    if (!this.cursors.has(id)) {
      this.charge("references", 1);
      this.charge("text", id.length);
      this.charge("retainedBytes", id.length * 2);
    }
    this.cursors.set(id, cursor);
  }

  decodeEntity(code: number): string {
    this.checkpoint();
    if (
      !Number.isSafeInteger(code) ||
      code < 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      this.fail("E_ENCODING", "Invalid entity scalar");
    this.charge("entities", 1);
    this.charge("entityBytes", code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);
    const units = code > 0xffff ? 2 : 1;
    this.charge("text", units);
    this.charge("retainedBytes", units * 2);
    return String.fromCodePoint(code);
  }

  /** Decode only parser-selected RTF text runs, never control/binary sections. */
  async decodeCodepage(bytes: Uint8Array, codepage: 1252 | 28591 = 1252): Promise<string> {
    this.checkpoint(Math.ceil(bytes.byteLength / 4096));
    if (codepage !== 1252 && codepage !== 28591)
      this.fail("E_ENCODING", "Unsupported RTF codepage");
    this.charge("retainedBytes", bytes.byteLength);
    const owned = new Uint8Array(bytes);
    const parts: string[] = [];
    let fragment = "";
    for (let i = 0; i < owned.length; i++) {
      this.checkpoint();
      const byte = owned[i]!;
      const code =
        codepage === 1252 && byte >= 0x80 && byte <= 0x9f ? windows1252[byte - 0x80]! : byte;
      this.charge("text", 1);
      this.charge("retainedBytes", 2);
      if (!fragment) this.charge("references", 1);
      fragment += String.fromCodePoint(code);
      if (fragment.length === 2048) {
        parts.push(fragment);
        fragment = "";
      }
      if ((i + 1) % 256 === 0) await this.cooperate(0);
    }
    await this.cooperate(0);
    if (fragment) parts.push(fragment);
    this.charge("retainedBytes", owned.length * 2);
    return parts.join("");
  }

  retainBinaryBlock(bytes: Uint8Array): Uint8Array {
    this.checkpoint(Math.max(1, Math.ceil(bytes.byteLength / 4096)));
    this.charge("resources", 1);
    this.charge("binaryBytes", bytes.byteLength);
    return new Uint8Array(bytes);
  }

  report(diagnostic: Diagnostic): void {
    this.checkpoint(0);
    this.charge("diagnostics", 1);
    const text =
      diagnostic.message.length +
      (diagnostic.location?.length ?? 0) +
      (diagnostic.format?.length ?? 0);
    this.charge("text", text);
    this.charge("retainedBytes", text * 2);
    this.notices.push(structuredClone(diagnostic));
  }

  snapshotDiagnostics(): readonly Diagnostic[] {
    this.checkpoint(0);
    const text = this.notices.reduce(
      (total, diagnostic) =>
        total +
        diagnostic.message.length +
        (diagnostic.location?.length ?? 0) +
        (diagnostic.format?.length ?? 0),
      0
    );
    this.charge("retainedBytes", text * 2);
    return structuredClone(this.notices);
  }

  /** Cancellation races awaited capabilities; it cannot preempt synchronous host JavaScript. */
  async call<T>(callback: () => Promise<T>): Promise<T> {
    this.checkpoint(0);
    let cancel!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancel = () =>
        reject(
          new PandocError(
            this.signal?.aborted ? "E_CANCELLED" : "E_IO",
            this.operation,
            this.signal?.aborted ? "Conversion cancelled" : "Execution context is closed"
          )
        );
      this.signal?.addEventListener("abort", cancel, { once: true });
      this.closedSignal.signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      // Capture synchronous throws without leaving the abort promise unobserved.
      const result = await Promise.race([(async () => callback())(), interrupted]);
      this.checkpoint(0);
      return result;
    } catch (error) {
      if (this.signal?.aborted) this.fail("E_CANCELLED", "Conversion cancelled");
      if (error instanceof PandocError) {
        this.failure ??= new PandocError(error.code, this.operation, error.message, error.format, error.location);
        throw this.failure;
      }
      return this.fail("E_IO", "Capability failed");
    } finally {
      this.signal?.removeEventListener("abort", cancel);
      this.closedSignal.signal.removeEventListener("abort", cancel);
    }
  }

  async consume(
    chunks: Chunks,
    accept: (bytes: Uint8Array) => Promise<void>,
    budgets: readonly (keyof Limits)[] = []
  ): Promise<void> {
    this.checkpoint(0);
    const iterator =
      Symbol.asyncIterator in chunks ? chunks[Symbol.asyncIterator]() : chunks[Symbol.iterator]();
    let done = false;
    const cleanup = async () => {
      if (done) return;
      done = true;
      await iterator.return?.();
    };
    this.cleanups.add(cleanup);
    try {
      while (!done) {
        this.checkpoint(0);
        const part = await this.call(async () => iterator.next());
        if (part.done) {
          done = true;
          break;
        }
        if (!(part.value instanceof Uint8Array)) this.fail("E_IO", "Producer must yield bytes");
        for (const key of budgets) this.charge(key, part.value.byteLength);
        this.charge("retainedBytes", part.value.byteLength);
        this.checkpoint(Math.max(1, Math.ceil(part.value.byteLength / 4096)));
        const owned = new Uint8Array(part.value);
        await accept(owned);
        await this.cooperate(0);
      }
    } finally {
      if (done) this.cleanups.delete(cleanup);
      // Failure cleanup is owned by close(), so cancellation is not blocked by an
      // uncooperative iterator.return(). It is invoked at most once.
    }
  }

  async acquire(chunks: Chunks, additionalBudget?: keyof Limits): Promise<Uint8Array> {
    const retained: Uint8Array[] = [];
    let length = 0;
    let block: Uint8Array | undefined;
    let used = 0;
    await this.consume(
      chunks,
      async (bytes) => {
        for (let offset = 0; offset < bytes.length; ) {
          this.checkpoint();
          if (!block || used === block.length) {
            const capacity = Math.min(4096, this.limits.inputBytes - length);
            this.charge("retainedBytes", capacity);
            this.charge("references", 1);
            block = new Uint8Array(capacity);
            retained.push(block);
            used = 0;
          }
          const count = Math.min(block.length - used, bytes.length - offset);
          block.set(bytes.subarray(offset, offset + count), used);
          used += count;
          length += count;
          offset += count;
          await this.cooperate(0);
        }
      },
      additionalBudget === undefined ? ["inputBytes"] : ["inputBytes", additionalBudget]
    );
    this.charge("retainedBytes", length);
    this.checkpoint(Math.ceil(length / 4096));
    const result = new Uint8Array(length);
    let offset = 0;
    for (const bytes of retained) {
      const count = Math.min(bytes.length, length - offset);
      this.checkpoint(Math.max(1, Math.ceil(count / 4096)));
      result.set(bytes.subarray(0, count), offset);
      offset += count;
      await this.cooperate(0);
    }
    return result;
  }

  async decodeUtf8(chunks: Chunks): Promise<string> {
    const parts: string[] = [];
    let fragment = "";
    let cr = false;
    let first = true;
    let remaining = 0;
    let scalar = 0;
    let minimum = 0;
    const append = (text: string) => {
      if (!fragment) this.charge("references", 1);
      fragment += text;
      if (fragment.length >= 2048) {
        parts.push(fragment);
        fragment = "";
      }
    };
    const decoded = (code: number) => {
      if (first) {
        first = false;
        if (code === 0xfeff) return;
      }
      const units = code > 0xffff ? 2 : 1;
      this.charge("text", units);
      this.charge("retainedBytes", units * 2);
      if (cr) {
        append("\n");
        cr = false;
        if (code === 10) return;
      }
      if (code === 13) cr = true;
      else append(String.fromCodePoint(code));
    };
    await this.consume(chunks, async (bytes) => {
      for (let offset = 0; offset < bytes.length; offset++) {
        this.checkpoint();
        const byte = bytes[offset]!;
        if (remaining) {
          if (byte < 0x80 || byte > 0xbf) this.fail("E_ENCODING", "Invalid UTF-8 continuation");
          scalar = (scalar << 6) | (byte & 0x3f);
          if (--remaining === 0) {
            if (scalar < minimum || scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff))
              this.fail("E_ENCODING", "Invalid UTF-8 scalar");
            decoded(scalar);
          }
        } else if (byte < 0x80) decoded(byte);
        else if (byte >= 0xc2 && byte <= 0xdf) {
          remaining = 1;
          scalar = byte & 0x1f;
          minimum = 0x80;
        } else if (byte >= 0xe0 && byte <= 0xef) {
          remaining = 2;
          scalar = byte & 0x0f;
          minimum = 0x800;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          remaining = 3;
          scalar = byte & 7;
          minimum = 0x10000;
        } else this.fail("E_ENCODING", "Invalid UTF-8 leading byte");
        if ((offset + 1) % 256 === 0) await this.cooperate(0);
      }
      await this.cooperate(0);
    });
    if (remaining) this.fail("E_ENCODING", "Incomplete trailing UTF-8 sequence");
    if (cr) append("\n");
    if (fragment) parts.push(fragment);
    const length = parts.reduce((total, part) => total + part.length, 0);
    this.charge("retainedBytes", length * 2);
    this.checkpoint(0);
    return parts.join("");
  }

  async emit(bytes: Uint8Array): Promise<void> {
    this.checkpoint(0);
    if (this.completingOutput || this.pendingOutput)
      this.fail("E_IO", "Output is closed or a write is pending");
    this.charge("outputBytes", bytes.byteLength);
    this.charge("retainedBytes", bytes.byteLength);
    this.checkpoint(Math.ceil(bytes.byteLength / 4096));
    const owned = new Uint8Array(bytes);
    const output = this.context.output;
    if (!output) return;
    if ("publish" in output && this.outputStarted)
      this.fail("E_IO", "Atomic output may only be published once");
    this.outputStarted = true;
    this.pendingOutput = true;
    try {
      await this.call(() =>
        "publish" in output ? output.publish(owned, this.signal) : output.write(owned, this.signal)
      );
    } finally {
      this.pendingOutput = false;
    }
  }

  async completeOutput(): Promise<void> {
    this.checkpoint(0);
    if (this.completingOutput) return this.completingOutput;
    if (this.pendingOutput) this.fail("E_IO", "Output write is pending");
    const output = this.context.output;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.completingOutput = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Install the completion promise before invoking even a reentrant host.
    this.call(async () => {
      if (output && "write" in output) await output.close(this.signal);
    }).then(() => {
      this.outputComplete = true;
      resolve();
    }, reject);
    return this.completingOutput;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    // Install closing before invoking host cleanup, including reentrant cleanup.
    this.closing = Promise.resolve().then(async () => {
      this.closedSignal.abort();
      const output = this.context.output;
      const callbacks = [...this.cleanups];
      this.cleanups.clear();
      if (output && "write" in output && !this.outputComplete && (this.outputStarted || this.completingOutput))
        callbacks.push(() =>
          output.abort(this.failure ?? new PandocError("E_IO", this.operation, "Execution closed"))
        );
      await Promise.allSettled(callbacks.map(async (callback) => callback()));
    });
    return this.closing;
  }
}

export function createExecutionContext(
  operation: Operation,
  context: ConversionContext = {}
): ExecutionContext {
  return new ExecutionContext(operation, context);
}
