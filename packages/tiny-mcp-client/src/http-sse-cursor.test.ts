import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { HttpTransport } from "./index.js";

it.each(["notification", "keepalive", "explicit reset", "explicit reset with configured cursor"] as const)("preserves SSE cursor semantics through a reconnected %s", async mode => {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [], cursors: (string | null)[] = [];
  const encoder = new TextEncoder();
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    if (init?.method === "GET") {
      cursors.push(new Headers(init.headers).get("Last-Event-ID"));
      if (cursors.length === 3) return new Response(null, { status: 405 });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }), { headers: { "Content-Type": "text/event-stream" } });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "original-session" } });
  });
  const initialCursor = mode === "explicit reset with configured cursor" ? "configured-cursor" : null;
  const transport = new HttpTransport({ url: "https://resource.example/mcp", fetch,
    ...(initialCursor === null ? {} : { headers: { "Last-Event-ID": initialCursor } }) });
  transport.readable.resume();
  try {
    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await setImmediate();
    streams[0].enqueue(encoder.encode('id: original-cursor\ndata: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n'));
    await setImmediate();
    streams[0].close(); await setImmediate();
    expect(cursors).toEqual([initialCursor, "original-cursor"]);
    streams[1].enqueue(encoder.encode(mode === "keepalive" ? ':keepalive\n\n' : mode.startsWith("explicit reset") ? 'id:\n\n'
      : 'data: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n'));
    await setImmediate(); streams[1].close(); await setImmediate();
    expect(cursors).toEqual([initialCursor, "original-cursor", mode.startsWith("explicit reset") ? null : "original-cursor"]);
  } finally { transport.dispose(); await transport.closed; }
});
