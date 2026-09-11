import type { ByteSource } from "../../../contracts/io.js";
import type { HttpHeaders } from "../../network/types.js";

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

export function credential(value: string): string {
  if (typeof value !== "string" || value.length === 0 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new TypeError("Invalid provider apiKey");
  return value;
}

export function jsonBody(value: unknown, limit: number): { body: ByteSource; headers: HttpHeaders } {
  const text = JSON.stringify(value);
  if (text.length > limit) throw new RangeError("Provider request byte limit exceeded");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > limit) throw new RangeError("Provider request byte limit exceeded");
  return { body: (async function* () { yield bytes; })(), headers: [["content-type", "application/json"]] };
}

export function multipart(options: Record<string, unknown>, files: readonly { field: string; mimeType: string; bytes: Uint8Array }[], limit: number): { body: ByteSource; headers: HttpHeaders } {
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
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="attachment-${index}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`), Uint8Array.from(file.bytes), encoder.encode("\r\n"));
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));
  if (parts.reduce((sum, part) => sum + part.length, 0) > limit) throw new RangeError("Provider request byte limit exceeded");
  return { body: (async function* () { yield* parts; })(), headers: [["content-type", `multipart/form-data; boundary=${boundary}`]] };
}
