import { scheduleNetworkDeadline } from "./deadline.js";
import { collectBytes, readBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { writeDiagnostic } from "../../escaping.js";
import { CurlError, defaultNetworkLimits, type HttpHeaders, type NetworkLimits } from "./types.js";

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export function limitsFor(overrides: Partial<NetworkLimits> = {}): NetworkLimits {
  const result = { ...defaultNetworkLimits, ...overrides };
  for (const [name, value] of Object.entries(overrides)) {
    const minimum = name === "maxRedirects" || name === "maxRetries" ? 0 : 1;
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < minimum)) {
      throw new RangeError(`Invalid network limit: ${name}`);
    }
  }
  return Object.freeze(result);
}

export async function withSignal<Value>(operation: () => PromiseLike<Value> | Value, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const onAbort = (): void => { cleanup(); reject(signal.reason); };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(operation).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  let cancel: (() => void) | undefined;
  try { await withSignal(() => new Promise<void>(resolve => { cancel = scheduleNetworkDeadline(milliseconds, resolve); }), signal); }
  finally { cancel?.(); }
}

export function header(headers: HttpHeaders, name: string): string | undefined {
  return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

export function networkError(error: unknown): CurlError {
  if (error instanceof CurlError) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return new CurlError(6, "Could not resolve host");
  if (["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code)) return new CurlError(7, "Failed to connect");
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return new CurlError(60, "TLS certificate verification failed");
  if (/TLS|SSL/.test(code)) return new CurlError(35, "TLS handshake failed");
  return new CurlError(56, "Network transfer failed");
}

export async function diagnostic(context: CommandContext, error: CurlError): Promise<void> {
  await writeDiagnostic(context.stderr, `${context.command}: (${error.exitCode}) ${error.message}\n`, context.signal);
}

/** Buffered operands use a quota only when the host supplies one. */
export async function collectNetworkBytes(source: ByteSource, options: { signal: AbortSignal; maxBytes: number }): Promise<Uint8Array> {
  if (Number.isFinite(options.maxBytes)) return collectBytes(source, options);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of readBytes(source, options.signal)) {
    chunks.push(new Uint8Array(chunk));
    size += chunk.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
