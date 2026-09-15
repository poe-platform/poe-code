export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  readers?: Set<ReadableStreamDefaultReader<Uint8Array>>,
  signal?: AbortSignal
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("HTTP response byte limit must be a positive safe integer");
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw signal.reason;
  }
  const length = response.headers.get("Content-Length");
  if (
    length !== null &&
    length.length > 0 &&
    [...length].every((character) => character >= "0" && character <= "9") &&
    Number(length) > maxBytes
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP response exceeds ${maxBytes} bytes`);
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  readers?.add(reader);
  const abort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error(`HTTP response exceeds ${maxBytes} bytes`);
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    readers?.delete(reader);
    reader.releaseLock();
  }
}
