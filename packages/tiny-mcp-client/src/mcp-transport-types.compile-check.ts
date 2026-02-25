import type { Readable, Writable } from "node:stream";

import { HttpTransport, type HttpTransportFetch } from "./index.js";
import type { McpTransport, McpTransportClosedEvent } from "./index.js";

declare const readable: Readable;
declare const writable: Writable;

const closedEvent: McpTransportClosedEvent = {
  reason: new Error("transport closed"),
};

const transport: McpTransport = {
  readable,
  writable,
  closed: Promise.resolve(closedEvent),
  dispose(reason?: Error): void {
    void reason;
  },
};

const closed: Promise<McpTransportClosedEvent> = transport.closed;
const customFetch: HttpTransportFetch = async () => new Response(null, { status: 202 });
const httpTransport: McpTransport = new HttpTransport({
  url: "https://example.com/mcp",
  headers: {
    Authorization: "Bearer test",
  },
  fetch: customFetch,
});

// @ts-expect-error reason must be an Error.
const invalidClosedEvent: McpTransportClosedEvent = { reason: "closed" };

void closed;
void httpTransport;
void invalidClosedEvent;
