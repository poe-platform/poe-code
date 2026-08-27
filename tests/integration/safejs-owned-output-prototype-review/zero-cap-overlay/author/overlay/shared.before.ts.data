import type { CommandContext } from "../../contracts/index.js";
import { writeBytes } from "../../contracts/index.js";
import { CurlError, defaultNetworkLimits, type HttpHeaders, type NetworkLimits } from "./types.js";

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export function limitsFor(overrides: Partial<NetworkLimits> = {}): NetworkLimits {
  const result = { ...defaultNetworkLimits, ...overrides };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1 || (name === "maxTimeMs" && value > 2_147_483_647)) {
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await withSignal(() => new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds); }), signal); }
  finally { clearTimeout(timer); }
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
  await writeBytes(context.stderr, encode(`curl: (${error.exitCode}) ${error.message}\n`), context.signal);
}
