export class FetchBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) { super(message); }
}

/** Bound bytes while reading, including bodies without Content-Length. */
export async function readFetchBody(request: Request, maxBytes: number): Promise<string> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) {
    await request.body?.cancel();
    throw new FetchBodyError(413, "Payload too large");
  }
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  let text = "";
  try {
    request.signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      request.signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new FetchBodyError(413, "Payload too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof FetchBodyError || request.signal.aborted) throw error;
    throw new FetchBodyError(400, "Invalid request body");
  } finally {
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
