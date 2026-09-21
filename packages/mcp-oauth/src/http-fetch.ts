export async function fetchMcpResponse(
  fetchImplementation: (input: string | URL, init?: RequestInit) => Promise<Response>,
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  const signal = init.signal;
  signal?.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, response?: Response): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (response === undefined) reject(error);
      else resolve(response);
    };
    const abort = () => finish(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    let pending: Promise<Response>;
    try { pending = fetchImplementation(input, { ...init, redirect: "error" }); }
    catch (error) { finish(error); return; }
    void pending.then(response => {
      if (settled || signal?.aborted) {
        void response.body?.cancel().catch(() => undefined);
        if (!settled) abort();
        return;
      }
      if (response.redirected || response.type === "opaqueredirect") {
        void response.body?.cancel().catch(() => undefined);
        finish(new Error("MCP HTTP redirects are not allowed"));
      } else finish(undefined, response);
    }, error => finish(error));
  });
}
