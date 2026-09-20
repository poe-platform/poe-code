import { createRequire } from "node:module";
const { NativeResponseBudget, checkHttpRedirect } = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export async function fetchMcpResponse(fetchImpl, input, init = {}) {
  const response = await fetchImpl(input, { ...init, redirect: "error" });
  try { checkHttpRedirect(response.redirected, response.type); }
  catch (error) { void response.body?.cancel().catch(() => undefined); throw new Error(error.message); }
  return response;
}
export async function readBoundedResponseText(response, maxBytes, readers, signal) {
  let budget;
  try { budget = new NativeResponseBudget(maxBytes); }
  catch (error) { throw new Error(error.message); }
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw signal.reason;
  }
  try { budget.checkContentLength(response.headers.get("Content-Length")); }
  catch (error) { void response.body?.cancel().catch(() => undefined); throw new Error(error.message); }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  readers?.add(reader);
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) return text + decoder.decode();
      try { budget.admit(chunk.value.byteLength); }
      catch (error) { throw new Error(error.message); }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
  finally {
    signal?.removeEventListener("abort", abort);
    readers?.delete(reader);
    reader.releaseLock();
  }
}
