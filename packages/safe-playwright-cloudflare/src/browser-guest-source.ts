/** Trusted build output, inflated only for run-code; cache no request-owned I/O. */
export function createCompressedGuestSource(base64: string, byteLength: number) {
  let source: string | undefined;
  return async (signal: AbortSignal): Promise<string> => {
    signal.throwIfAborted();
    if (source !== undefined) return source;
    const encoded = atob(base64);
    const compressed = new Uint8Array(encoded.length);
    for (let index = 0; index < encoded.length; index++) compressed[index] = encoded.charCodeAt(index);
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"), { signal }).getReader();
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength > byteLength - offset) throw new Error("Browser guest source exceeds its build size");
        bytes.set(value, offset);
        offset += value.byteLength;
      }
      signal.throwIfAborted();
      if (offset !== byteLength) throw new Error("Browser guest source size mismatch");
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return source;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
}
