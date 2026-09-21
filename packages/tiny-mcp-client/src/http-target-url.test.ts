import { expect, it, vi } from "vitest";
import { HttpTransport } from "./index.js";

const invalidUrls = ["not-a-url", "/relative", "file:///private/credential", "ftp://host.example/mcp",
  "https://user:private-secret@host.example/mcp", "https://host.example/mcp#private-marker", "https://host.example/mcp#"];

it.each(invalidUrls.flatMap(url => (["streamable-http", "sse"] as const).map(mode => ({ url, mode }))))(
  "rejects invalid $mode target $url before reading OAuth clocks", async ({ url, mode }) => {
    const now = vi.fn(() => 1000), fetch = vi.fn(async () => Response.json({}));
    let transport: HttpTransport | undefined;
    try {
      expect(() => { transport = new HttpTransport({ url, mode, fetch, headers: { Authorization: "Bearer private-access" }, oauth: {
        client: { mode: "static", clientId: "original" }, browser: {}, now,
        initialGrant: { resource: "https://host.example/mcp", tokens: { accessToken: "private-access", tokenType: "Bearer", expiresIn: 1 } },
        sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} }
      } }); }).toThrow(new Error("HTTP transport URL must be an absolute HTTP URL without credentials or fragment"));
      expect(now).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    } finally { transport?.dispose(); if (transport !== undefined) await transport.closed; }
  }
);

it.each(["http://127.0.0.1/mcp?", "https://host.example/mcp%23data?literal=%23", "https://host.example/path%3Fdata"])(
  "retains valid empty queries and escaped delimiters in target URLs: %s", async url => {
    const transport = new HttpTransport({ url });
    transport.dispose(); await transport.closed;
  }
);
