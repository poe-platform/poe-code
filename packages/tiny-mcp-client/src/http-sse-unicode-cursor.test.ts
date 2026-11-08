import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { HttpTransport } from "./index.js";

it.each(["café", "世界", "cursor🔒"])("encodes completed Unicode SSE cursors as UTF-8 HTTP header bytes: %s", async cursor => {
  const cursors: (string | null)[] = [];
  const transport = new HttpTransport({ url: "https://resource.example/mcp", fetch: async (_url, init) => {
    if (init?.method === "GET") {
      cursors.push(new Headers(init.headers).get("Last-Event-ID"));
      return cursors.length === 1 ? new Response(`id: ${cursor}\ndata: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n`, { headers: { "Content-Type": "text/event-stream" } })
        : new Response(null, { status: 405 });
    }
    return init?.method === "DELETE" ? new Response(null, { status: 204 })
      : new Response(null, { status: 202, headers: { "Mcp-Session-Id": "original-session" } });
  } });
  transport.readable.resume();
  try {
    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await setImmediate(); await setImmediate();
    expect(cursors).toEqual([null, Buffer.from(cursor, "utf8").toString("latin1")]);
  } finally { transport.dispose(); await transport.closed; }
});
