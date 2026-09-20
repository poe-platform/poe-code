import { WkhtmltopdfError } from "./errors.js";

export interface ResourceLimits {
  readonly maxInputBytes: number;
  readonly maxDecodedBytes: number;
  readonly maxRetainedBytes: number;
  readonly maxWork: number;
  readonly maxResources: number;
}
export interface ResourceUsage {
  readonly inputBytes: number;
  readonly decodedBytes: number;
  readonly retainedBytes: number;
  readonly work: number;
  readonly resources: number;
}
export interface ResourceLease {
  readonly chunks: AsyncIterable<Uint8Array>;
  /** Must stop pending reads, release underlying resources and settle promptly. */
  close(): Promise<void>;
}
/**
 * Trusted, explicitly supplied capabilities. VFS opens must authorize canonical
 * identity, not host paths. Network opens must authorize every redirect, bound
 * transport buffering and preserve TLS validation. Opens must honor cancellation.
 */
export type ResourceOpen = (reference: string, signal: AbortSignal) => Promise<ResourceLease>;
export interface ResourceOptions {
  readonly limits: ResourceLimits;
  readonly signal: AbortSignal;
  readonly vfs?: ResourceOpen;
  readonly fonts?: ResourceOpen;
  readonly network?: ResourceOpen;
}
export interface Resources {
  load(reference: string, base?: string): Promise<Uint8Array>;
  font(name: string): Promise<Uint8Array>;
  readonly usage: ResourceUsage;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// Intrinsic access checks typed-array slots across realms without consulting
// producer-owned properties, tags or iterators (including Buffer subclasses).
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const byteTypeGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const copyBytes = Uint8Array.prototype.set;

/** One bounded invocation. Returned byte arrays are caller-owned, never borrowed. */
export async function withResources<T>(options: ResourceOptions, run: (resources: Resources) => Promise<T>): Promise<T> {
  const limits = { ...options.limits };
  for (const key of ["maxInputBytes", "maxDecodedBytes", "maxRetainedBytes", "maxWork", "maxResources"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) {
      throw new WkhtmltopdfError("INVALID_VALUE", "Resource limits must be positive safe integers");
    }
  }
  const { vfs, fonts, network } = options;
  const controller = new AbortController();
  const signal = controller.signal;
  const sourceSignal = options.signal;
  const abort = () => controller.abort(sourceSignal.reason);
  sourceSignal.addEventListener("abort", abort, { once: true });
  if (sourceSignal.aborted) abort();
  const usage = { inputBytes: 0, decodedBytes: 0, retainedBytes: 0, work: 0, resources: 0 };
  let active = true;
  let busy = false;
  const pending = new Set<Promise<Uint8Array>>();
  const check = () => {
    if (signal.aborted) throw signal.reason;
    if (!active) throw new WkhtmltopdfError("INVALID_VALUE", "Resource invocation has ended");
  };
  const charge = (key: keyof ResourceUsage, amount: number, limit: number) => {
    check();
    if (amount > limit - usage[key]) throw new WkhtmltopdfError("LIMIT_EXCEEDED", `Resource ${key} limit exceeded`);
    usage[key] += amount;
  };
  const work = (amount = 1) => charge("work", amount, limits.maxWork);
  const admitText = (reference: string) => {
    for (let i = 0; i < reference.length; i++) {
      work();
      const c = reference.charCodeAt(i);
      let size = c < 128 ? 1 : c < 2048 ? 2 : 3;
      if (c >= 0xd800 && c <= 0xdbff && reference.charCodeAt(i + 1) >= 0xdc00 && reference.charCodeAt(i + 1) <= 0xdfff) {
        size = 4; i++; work();
      }
      charge("inputBytes", size, limits.maxInputBytes);
      if (c === 0) throw new WkhtmltopdfError("INVALID_VALUE", "NUL resource reference");
    }
  };
  const retain = (size: number) => {
    charge("decodedBytes", size, limits.maxDecodedBytes);
    charge("retainedBytes", size, limits.maxRetainedBytes);
  };
  const data = (reference: string): Uint8Array => {
    const comma = reference.indexOf(",");
    if (comma < 0) throw new WkhtmltopdfError("INVALID_VALUE", "Data URL requires a comma");
    const base64 = reference.slice(5, comma).toLowerCase().endsWith(";base64");
    const start = comma + 1;
    let size = 0;
    const invalid = () => { throw new WkhtmltopdfError("INVALID_VALUE", "Malformed data URL byte encoding"); };
    const hex = (c: string): number => {
      const code = c.charCodeAt(0);
      if (code >= 48 && code <= 57) return code - 48;
      if (code >= 65 && code <= 70) return code - 55;
      if (code >= 97 && code <= 102) return code - 87;
      return invalid();
    };
    if (base64) {
      const length = reference.length - start;
      if (length % 4 !== 0) invalid();
      for (let i = start; i < reference.length; i += 4) {
        work(4);
        const a = alphabet.indexOf(reference[i]!);
        const b = alphabet.indexOf(reference[i + 1]!);
        const c = alphabet.indexOf(reference[i + 2]!);
        const d = alphabet.indexOf(reference[i + 3]!);
        if (a < 0 || b < 0) invalid();
        if (reference[i + 2] === "=") {
          if (reference[i + 3] !== "=" || i + 4 !== reference.length || (b & 15) !== 0) invalid();
          size++;
        } else if (reference[i + 3] === "=") {
          if (c < 0 || i + 4 !== reference.length || (c & 3) !== 0) invalid();
          size += 2;
        } else {
          if (c < 0 || d < 0) invalid();
          size += 3;
        }
      }
    } else {
      for (let i = start; i < reference.length; i++) {
        work();
        const code = reference.charCodeAt(i);
        if (code > 127 || code <= 32) invalid();
        if (reference[i] === "%") {
          if (i + 2 >= reference.length) invalid();
          hex(reference[i + 1]!); hex(reference[i + 2]!); i += 2; work(2);
        }
        size++;
      }
    }
    work(size);
    retain(size);
    const result = new Uint8Array(size);
    let offset = 0;
    if (base64) {
      for (let i = start; i < reference.length; i += 4) {
        const a = alphabet.indexOf(reference[i]!);
        const b = alphabet.indexOf(reference[i + 1]!);
        const c = alphabet.indexOf(reference[i + 2]!);
        const d = alphabet.indexOf(reference[i + 3]!);
        result[offset++] = (a << 2) | (b >> 4);
        if (c >= 0) result[offset++] = (b << 4) | (c >> 2);
        if (d >= 0) result[offset++] = (c << 6) | d;
      }
    } else {
      for (let i = start; i < reference.length; i++) {
        result[offset++] = reference[i] === "%"
          ? (hex(reference[++i]!) << 4) | hex(reference[++i]!) : reference.charCodeAt(i);
      }
    }
    return result;
  };
  const read = async (reference: string, open: ResourceOpen): Promise<Uint8Array> => {
    const lease = await open(reference, signal);
    let temporary = 0;
    const chunks: Uint8Array[] = [];
    let primary = false;
    let failure: unknown;
    let result: Uint8Array | undefined;
    try {
      check();
      const iterator = lease.chunks[Symbol.asyncIterator]();
      for (;;) {
        work();
        let abortRead: (() => void) | undefined;
        let next: IteratorResult<Uint8Array>;
        try {
          next = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
            abortRead = () => reject(signal.reason);
            signal.addEventListener("abort", abortRead, { once: true });
            if (signal.aborted) abortRead();
            Promise.resolve().then(() => { check(); return iterator.next(); }).then(resolve, reject);
          });
        } finally {
          if (abortRead) signal.removeEventListener("abort", abortRead);
        }
        check();
        if (next.done) break;
        if (byteTypeGetter.call(next.value) !== "Uint8Array") {
          throw new WkhtmltopdfError("INVALID_VALUE", "Expected resource byte chunks");
        }
        const size = byteLengthGetter.call(next.value) as number;
        charge("inputBytes", size, limits.maxInputBytes);
        work(size);
        retain(size);
        temporary += size;
        if (size) {
          const chunk = new Uint8Array(size);
          copyBytes.call(chunk, next.value);
          chunks.push(chunk);
        }
      }
      work(temporary);
      charge("retainedBytes", temporary, limits.maxRetainedBytes);
      result = new Uint8Array(temporary);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    } catch (error) {
      primary = true;
      failure = error;
    } finally {
      usage.retainedBytes -= temporary;
      try {
        await lease.close();
        check();
      } catch (error) {
        if (!primary) { primary = true; failure = error; }
      }
    }
    if (primary) {
      if (result) usage.retainedBytes -= result.byteLength;
      throw failure;
    }
    return result!;
  };
  const load = (reference: string, font: boolean, base?: string): Promise<Uint8Array> => {
    const operation = (async () => {
      check();
      if (busy) throw new WkhtmltopdfError("INVALID_VALUE", "Resource reads must be sequential");
      busy = true;
      try {
        charge("resources", 1, limits.maxResources);
        admitText(reference);
        if (base !== undefined) {
          admitText(base);
          try { reference = new URL(reference, base).href; }
          catch { throw new WkhtmltopdfError("INVALID_VALUE", "Invalid resource URL or base"); }
          // Count the normalized representation too, including Unicode escaping.
          admitText(reference);
        }
        if (!font) {
          work(reference.length);
          const fragment = reference.indexOf("#");
          if (fragment >= 0) reference = reference.slice(0, fragment);
        }
        if (!font && reference.startsWith("data:")) return data(reference);
        const open = font ? fonts : reference.startsWith("vfs:") ? vfs :
          reference.startsWith("https:") || reference.startsWith("http:") ? network : undefined;
        if (!open) throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "Resource requires an explicitly supplied capability");
        return await read(reference, open);
      } finally { busy = false; }
    })();
    pending.add(operation);
    void operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  try {
    check();
    const result = await run({ load: (reference, base) => load(reference, false, base), font: name => load(name, true), get usage() { return { ...usage }; } });
    check();
    if (pending.size) throw new WkhtmltopdfError("INVALID_VALUE", "Resource reads must finish before the invocation ends");
    return result;
  } finally {
    active = false;
    controller.abort(new WkhtmltopdfError("INVALID_VALUE", "Resource invocation has ended"));
    await Promise.allSettled(pending);
    sourceSignal.removeEventListener("abort", abort);
    usage.retainedBytes = 0;
  }
}
