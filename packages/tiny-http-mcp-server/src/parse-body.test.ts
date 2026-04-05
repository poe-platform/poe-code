import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { readAndClassifyBody } from "./parse-body.js";

function createRequest(
  body: string,
  extras?: { body?: unknown }
): IncomingMessage & { body?: unknown } {
  return Object.assign(Readable.from([body]), extras) as IncomingMessage & {
    body?: unknown;
  };
}

describe("readAndClassifyBody", () => {
  it("P1 parses single request", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
    );

    expect(parsed.messages).toEqual([
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    expect(parsed.requests).toEqual(parsed.messages);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual([]);
  });

  it("P2 parses single notification", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('{"jsonrpc":"2.0","method":"notifications/initialized"}')
    );

    expect(parsed.messages).toEqual([
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual(parsed.messages);
    expect(parsed.responses).toEqual([]);
  });

  it("P3 parses single response", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
    );

    expect(parsed.messages).toEqual([
      { jsonrpc: "2.0", id: 1, result: { ok: true } },
    ]);
    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual(parsed.messages);
  });

  it("P4 parses batch of requests", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"pong"}]'
      )
    );

    expect(parsed.requests).toEqual([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "pong" },
    ]);
    expect(parsed.messages).toEqual(parsed.requests);
  });

  it("P5 parses batch of notifications", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","method":"note/one"},{"jsonrpc":"2.0","method":"note/two"}]'
      )
    );

    expect(parsed.notifications).toEqual([
      { jsonrpc: "2.0", method: "note/one" },
      { jsonrpc: "2.0", method: "note/two" },
    ]);
    expect(parsed.messages).toEqual(parsed.notifications);
  });

  it("P6 parses batch of responses", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":1,"result":"ok"},{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"boom"}}]'
      )
    );

    expect(parsed.responses).toEqual([
      { jsonrpc: "2.0", id: 1, result: "ok" },
      {
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32603, message: "boom" },
      },
    ]);
    expect(parsed.messages).toEqual(parsed.responses);
  });

  it("P7 parses mixed batch with requests and notifications", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":"r1","method":"tools/list"},{"jsonrpc":"2.0","method":"notifications/initialized"}]'
      )
    );

    expect(parsed.requests).toEqual([
      { jsonrpc: "2.0", id: "r1", method: "tools/list" },
    ]);
    expect(parsed.notifications).toEqual([
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(parsed.responses).toEqual([]);
  });

  it("P8 classifies requests-only payload", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":1,"method":"a"},{"jsonrpc":"2.0","id":2,"method":"b"}]'
      )
    );

    expect(parsed.hasRequests).toBe(true);
    expect(parsed.hasNotifications).toBe(false);
    expect(parsed.hasResponses).toBe(false);
  });

  it("P9 classifies notifications-only payload", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","method":"a"},{"jsonrpc":"2.0","method":"b"}]'
      )
    );

    expect(parsed.hasRequests).toBe(false);
    expect(parsed.hasNotifications).toBe(true);
    expect(parsed.hasResponses).toBe(false);
  });

  it("P10 classifies responses-only payload", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":1,"result":"a"},{"jsonrpc":"2.0","id":2,"result":"b"}]'
      )
    );

    expect(parsed.hasRequests).toBe(false);
    expect(parsed.hasNotifications).toBe(false);
    expect(parsed.hasResponses).toBe(true);
  });

  it("P11 rejects invalid JSON", async () => {
    await expect(
      readAndClassifyBody(createRequest('{"jsonrpc":"2.0"'))
    ).rejects.toThrow("Parse error");
  });

  it("P12 rejects non-object number body", async () => {
    await expect(readAndClassifyBody(createRequest("123"))).rejects.toThrow(
      "Invalid Request"
    );
  });

  it("P13 rejects non-object string body", async () => {
    await expect(
      readAndClassifyBody(createRequest('"hello"'))
    ).rejects.toThrow("Invalid Request");
  });

  it("P14 rejects non-object null body", async () => {
    await expect(readAndClassifyBody(createRequest("null"))).rejects.toThrow(
      "Invalid Request"
    );
  });

  it("P15 rejects message missing jsonrpc field", async () => {
    await expect(
      readAndClassifyBody(createRequest('{"id":1,"method":"ping"}'))
    ).rejects.toThrow("Invalid Request");
  });

  it("P16 rejects empty array", async () => {
    await expect(readAndClassifyBody(createRequest("[]"))).rejects.toThrow(
      "Invalid Request"
    );
  });

  it("P17 accepts pre-parsed body object", async () => {
    const parsed = await readAndClassifyBody(createRequest("ignored"), {
      jsonrpc: "2.0",
      id: 7,
      method: "ping",
    });

    expect(parsed.messages).toEqual([
      { jsonrpc: "2.0", id: 7, method: "ping" },
    ]);
    expect(parsed.requests).toEqual(parsed.messages);
  });

  it("P18 accepts pre-parsed body array", async () => {
    const parsed = await readAndClassifyBody(createRequest("ignored"), [
      { jsonrpc: "2.0", method: "note/one" },
      { jsonrpc: "2.0", id: "res-1", result: { ok: true } },
    ]);

    expect(parsed.notifications).toEqual([
      { jsonrpc: "2.0", method: "note/one" },
    ]);
    expect(parsed.responses).toEqual([
      { jsonrpc: "2.0", id: "res-1", result: { ok: true } },
    ]);
  });

  it("P19 identifies request by method and id", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("ignored", {
        body: { jsonrpc: "2.0", id: "req-1", method: "tools/call" },
      })
    );

    expect(parsed.requests).toEqual([
      { jsonrpc: "2.0", id: "req-1", method: "tools/call" },
    ]);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual([]);
  });

  it("P20 identifies notification by method and no id", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("ignored", {
        body: { jsonrpc: "2.0", method: "notifications/progress" },
      })
    );

    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual([
      { jsonrpc: "2.0", method: "notifications/progress" },
    ]);
    expect(parsed.responses).toEqual([]);
  });

  it("P21 identifies response by result or error, id, and no method", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("ignored", {
        body: { jsonrpc: "2.0", id: "req-1", result: { ok: true } },
      })
    );

    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual([
      { jsonrpc: "2.0", id: "req-1", result: { ok: true } },
    ]);
  });

  it("rejects a message that mixes request and response fields", async () => {
    await expect(
      readAndClassifyBody(
        createRequest(
          '{"jsonrpc":"2.0","id":1,"method":"ping","result":{"ok":true}}'
        )
      )
    ).rejects.toThrow("Invalid Request");
  });

  it("prefers req.body over the stream body when both exist", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("not-json", {
        body: { jsonrpc: "2.0", id: "req-1", method: "tools/list" },
      })
    );

    expect(parsed.requests).toEqual([
      { jsonrpc: "2.0", id: "req-1", method: "tools/list" },
    ]);
  });
});
