// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Ambient script declarations cannot be imported as a module; the optional build has one explicit root.
/// <reference path="./portable-buffer-package.d.ts" />

// Use the package path explicitly: bare "buffer" resolves to a Node builtin.
import { Buffer as PortableBuffer } from "buffer/index.js";

if (typeof globalThis.Buffer === "undefined") {
  // The shell borrows this Node fast-path method on plain Uint8Array chunks.
  // The portable package implements the public Buffer API but omits utf8Slice.
  const decoder = new TextDecoder("utf8", { ignoreBOM: true });
  Object.defineProperty(PortableBuffer.prototype, "utf8Slice", {
    configurable: true,
    writable: true,
    value(this: Uint8Array, start: number, end: number): string {
      return decoder.decode(this.subarray(start, end));
    },
  });
  globalThis.Buffer = PortableBuffer as unknown as typeof globalThis.Buffer;
}
