import { createRequire } from "node:module";
const { NativeResponseBudget, checkHttpRedirect } = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export async function fetchMcpResponse(fetchImpl, input, init = {}) {
  const signal = init.signal;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (response === undefined) reject(error);
      else resolve(response);
    };
    const abort = () => finish(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    let pending;
    try { pending = fetchImpl(input, { ...init, redirect: "error" }); }
    catch (error) { finish(error); return; }
    void pending.then(response => {
      if (settled || signal?.aborted) {
        void response.body?.cancel().catch(() => undefined);
        if (!settled) abort();
        return;
      }
      try { checkHttpRedirect(response.redirected, response.type); }
      catch (error) {
        void response.body?.cancel().catch(() => undefined);
        finish(new Error(error.message));
        return;
      }
      finish(undefined, response);
    }, error => finish(error));
  });
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
