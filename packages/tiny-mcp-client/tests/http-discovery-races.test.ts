import { expect, it, vi } from "vitest";
import { callRemoteMcpTool } from "../../safe-bash-command-mcp/src/index.js";

for (const phase of ["initialize", "tools/call"] as const) {
  it.each([503, "rejection", 404] as const)(`ignores stale discovery %s during ${phase}`, async outcome => {
    const probe = Promise.withResolvers<Response>();
    const definitive = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const requests: string[] = [];
    let probeSignal: AbortSignal | undefined;
    let definitiveId: unknown;
    const response = new Response("stale probe", { status: outcome === "rejection" ? 503 : outcome });
    const cancelBody = vi.spyOn(response.body!, "cancel");
    const initialized = { protocolVersion: "2025-03-26", serverInfo: { name: "fixture", version: "1" }, capabilities: { tools: {} } };
    const called = { content: [{ type: "text", text: "ok" }] };
    const result = callRemoteMcpTool(
      { name: "fixture", url: "https://mcp.example.test/mcp" },
      { name: "echo", arguments: {} },
      {
        requestTimeoutMs: 5000,
        fetch: async (_url, init) => {
          const message = JSON.parse(String(init?.body));
          requests.push(message.method);
          if (message.method === "server/discover") {
            probeSignal = init?.signal ?? undefined;
            try { return await probe.promise; }
            finally { released.resolve(); }
          }
          if (message.method === phase) {
            definitiveId = message.id;
            started.resolve();
            return definitive.promise;
          }
          if (message.method === "initialize") return Response.json({ jsonrpc: "2.0", id: message.id, result: initialized });
          if (message.method === "tools/call") return Response.json({ jsonrpc: "2.0", id: message.id, result: called });
          return new Response(null, { status: 202 });
        }
      }
    ).then(value => ({ value }), error => ({ error }));
    await started.promise;
    const aborted = probeSignal?.aborted;
    if (outcome === "rejection") probe.reject(new Error("synthetic connection reset"));
    else probe.resolve(response);
    await released.promise;
    // Allow the stale fetch's full continuation to run while the definitive response is gated.
    await new Promise<void>(resolve => setImmediate(resolve));
    definitive.resolve(Response.json({ jsonrpc: "2.0", id: definitiveId, result: phase === "initialize" ? initialized : called }));
    const completed = await result;
    expect(completed).toEqual({ value: called });
    expect(aborted).toBe(true);
    expect(requests).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/call"]);
    if (outcome !== "rejection") expect(cancelBody).toHaveBeenCalledOnce();
  });
}
