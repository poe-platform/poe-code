import { Buffer } from "buffer";

export function createDefaultHttpTransport() {
  throw new TypeError("Portable network commands require an explicit HTTP transport; inject createFetchTransport() or a host transport");
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

export function validateHeaderName(name) {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new TypeError("Invalid HTTP header name");
}

export function validateHeaderValue(_name, value) {
  if (/[^\t\x20-\x7e\x80-\xff]/.test(value)) throw new TypeError("Invalid HTTP header value");
}
