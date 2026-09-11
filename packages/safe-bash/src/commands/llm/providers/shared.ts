import { collectBytes, readBytes, type ByteSource } from "../../../contracts/io.js";
import type { HttpHeaders, HttpResponse, HttpTransport } from "../../network/types.js";
import { withSignal } from "../../network/shared.js";

export interface LlmProviderLimits {
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxEventBytes: number;
  readonly maxPolls: number;
  readonly pollIntervalMs: number;
}

export function providerLimits(input: Partial<LlmProviderLimits> = {}): LlmProviderLimits {
  const limits = { maxRequestBytes: 64 * 1024 * 1024, maxResponseBytes: 64 * 1024 * 1024, maxEventBytes: 1024 * 1024, maxPolls: 120, pollIntervalMs: 1000, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (name === "maxPolls" || name === "pollIntervalMs" ? 0 : 1)) throw new RangeError(`Invalid provider limit: ${name}`);
  }
  return Object.freeze(limits);
}

export function baseUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError("Invalid provider baseUrl");
  return url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
}

export function credential(value: string): string {
  if (typeof value !== "string" || value.length === 0 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new TypeError("Invalid provider apiKey");
  return value;
}

export function fields(options: Readonly<Record<string, string>>, numbers: readonly string[], booleans: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(options)) {
    if (numbers.includes(key)) {
      let numeric: unknown;
      try { numeric = JSON.parse(value); } catch { throw new TypeError(`Invalid numeric option: ${key}`); }
      if (typeof numeric !== "number" || !Number.isFinite(numeric)) throw new TypeError(`Invalid numeric option: ${key}`);
      result[key] = numeric;
    } else if (booleans.includes(key)) {
      if (value !== "true" && value !== "false") throw new TypeError(`Invalid boolean option: ${key}`);
      result[key] = value === "true";
    } else result[key] = value;
  }
  return result;
}

export function jsonBody(value: unknown, limit: number): { body: ByteSource; contentType: string } {
  const text = JSON.stringify(value);
  if (text.length > limit) throw new RangeError("Provider request byte limit exceeded");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > limit) throw new RangeError("Provider request byte limit exceeded");
  return { body: (async function* () { yield bytes; })(), contentType: "application/json" };
}

export function toBase64(bytes: Uint8Array, limit: number): string {
  if (Math.ceil(bytes.length / 3) * 4 > limit) throw new RangeError("Provider request byte limit exceeded");
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(text);
}

export function fromBase64(value: unknown, limit: number): Uint8Array {
  if (typeof value !== "string" || value.length % 4 !== 0 || value.length > Math.ceil(limit / 3) * 4) throw new TypeError("Invalid bounded image base64 response");
  const text = atob(value);
  if (btoa(text) !== value || text.length > limit) throw new TypeError("Invalid bounded image base64 response");
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

export function multipart(options: Record<string, unknown>, files: readonly { field: string; mimeType: string; bytes: Uint8Array }[], limit: number): { body: ByteSource; contentType: string } {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const entries = Object.entries(options).map(([name, value]) => {
    if (![...name].every(char => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".includes(char))) throw new TypeError("Invalid multipart option name");
    return [name, String(value)] as const;
  });
  let size = files.reduce((sum, file) => sum + file.bytes.length, 0);
  for (const [, value] of entries) {
    if (value.length > limit) throw new RangeError("Provider request byte limit exceeded");
    size += encoder.encode(value).length;
  }
  if (size > limit) throw new RangeError("Provider request byte limit exceeded");
  let boundary = "safe-bash-llm-boundary";
  const contains = (bytes: Uint8Array, needle: Uint8Array): boolean => {
    outer: for (let start = 0; start <= bytes.length - needle.length; start++) {
      for (let index = 0; index < needle.length; index++) if (bytes[start + index] !== needle[index]) continue outer;
      return true;
    }
    return false;
  };
  let attempts = 0;
  while (entries.some(([, value]) => value.includes(boundary)) || files.some(file => contains(file.bytes, encoder.encode(boundary)))) {
    if (attempts++ === 32) throw new RangeError("Provider multipart boundary collision limit exceeded");
    boundary += "x";
  }
  for (const [name, value] of entries) parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const [index, file] of files.entries()) {
    if ([...file.mimeType].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126)) throw new TypeError("Invalid attachment MIME type");
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="attachment-${index}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`), file.bytes, encoder.encode("\r\n"));
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));
  if (parts.reduce((sum, part) => sum + part.length, 0) > limit) throw new RangeError("Provider request byte limit exceeded");
  return { body: (async function* () { yield* parts; })(), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function* responseBytes(transport: HttpTransport, url: string, headers: HttpHeaders, signal: AbortSignal, limit: number, payload?: { body: ByteSource; contentType: string }): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  let response: HttpResponse | undefined;
  let abandoned = false;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposal ??= Promise.resolve().then(() => response!.dispose());
    void disposal.catch(() => {});
    return disposal;
  };
  const acquiring = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return transport({ url, method: payload ? "POST" : "GET", headers: payload ? [...headers, ["Content-Type", payload.contentType]] : headers, signal, ...(payload ? { body: payload.body } : {}) });
  }).then(value => {
    response = value;
    if (abandoned) { void dispose(); throw signal.reason; }
    return value;
  });
  try {
    response = await withSignal(() => acquiring, signal);
    if (response.status < 200 || response.status >= 300) throw new Error(`Provider HTTP ${response.status}`);
    let size = 0;
    for await (const chunk of readBytes(response.body, signal)) {
      size += chunk.length;
      if (size > limit) throw new RangeError("Provider response byte limit exceeded");
      yield chunk;
    }
  } finally {
    abandoned = true;
    if (response) {
      const disposing = dispose();
      if (!signal.aborted) await withSignal(() => disposing, signal);
    }
  }
}

export async function responseJson(source: ByteSource, limit: number, signal: AbortSignal): Promise<Record<string, unknown>> {
  const bytes = await collectBytes(source, { maxBytes: limit, signal });
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid provider JSON response");
  return value as Record<string, unknown>;
}

export async function* chatEvents(source: ByteSource, limit: number, signal: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "", data: string[] = [], size = 0, afterCR = false, done = false;
  const processLine = (): string | undefined => {
    const value = line; line = "";
    if (value === "") {
      const event = data.join("\n"); data = []; size = 0;
      if (!event) return;
      if (event === "[DONE]") { done = true; return; }
      const parsed = JSON.parse(event) as { error?: unknown; choices?: { delta?: { content?: unknown } }[] };
      if (parsed.error) throw new Error("Provider chat error");
      if (!Array.isArray(parsed.choices)) throw new TypeError("Invalid chat event");
      const content = parsed.choices[0]?.delta?.content;
      if (content !== undefined && content !== null && typeof content !== "string") throw new TypeError("Invalid chat content");
      return typeof content === "string" ? content : undefined;
    }
    if (value.startsWith("data:")) data.push(value.slice(value[5] === " " ? 6 : 5));
  };
  for await (const chunk of readBytes(source, signal)) {
    const text = decoder.decode(chunk, { stream: true });
    for (const char of text) {
      if (afterCR && char === "\n") { afterCR = false; continue; }
      afterCR = char === "\r";
      const codePoint = char.codePointAt(0)!;
      size += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
      if (size > limit) throw new RangeError("Provider SSE event byte limit exceeded");
      if (char === "\r" || char === "\n") {
        const output = processLine();
        if (output !== undefined) yield output;
        if (done) return;
      } else line += char;
    }
  }
  decoder.decode();
  throw new Error("Truncated provider chat stream");
}
