export const requiresFiniteUrlLimits = false;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function validateHeaderName(name: string): void {
  if (!name.length) throw new TypeError("Invalid HTTP header name");
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (!(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || "!#$%&'*+-.^_`|~".includes(character))) {
      throw new TypeError("Invalid HTTP header name");
    }
  }
}

export function validateHeaderValue(_name: string, value: string): void {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code !== 9 && (code < 32 || code === 127 || code > 255)) throw new TypeError("Invalid HTTP header value");
  }
}
export { createFetchTransport as createDefaultHttpTransport } from "./fetch-transport.js";
