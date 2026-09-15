export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  readers?: Set<ReadableStreamDefaultReader<Uint8Array>>
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("HTTP response byte limit must be a positive safe integer");
  const length = response.headers.get("Content-Length");
  if (length !== null && length.length > 0 &&
      [...length].every((character) => character >= "0" && character <= "9") &&
      Number(length) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP response exceeds ${maxBytes} bytes`);
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  readers?.add(reader);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error(`HTTP response exceeds ${maxBytes} bytes`);
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    readers?.delete(reader);
    reader.releaseLock();
  }
}
