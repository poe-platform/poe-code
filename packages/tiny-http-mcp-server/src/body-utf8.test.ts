import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { readAndClassifyBody } from "./parse-body.js";

it.each([[0xff], [0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f]])(
  "rejects malformed UTF-8 request bytes %j",
  async (...bytes) => {
    const body = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"value":"'), Buffer.from(bytes), Buffer.from('"}}')]);
    const request = Readable.from([body]) as IncomingMessage;
    await expect(readAndClassifyBody(request, undefined, { maxBytes: 1024 })).rejects.toThrow("Parse error");
  }
);

it("rejects a truncated UTF-8 sequence at request EOF", async () => {
  const request = Readable.from([Buffer.from([0xf0, 0x9f])]) as IncomingMessage;
  await expect(readAndClassifyBody(request, undefined, { maxBytes: 1024 })).rejects.toThrow("Parse error");
});

it("preserves valid UTF-8 characters split across every byte boundary", async () => {
  const body = { jsonrpc: "2.0", id: 1, method: "ping", params: { value: "é🚀" } };
  const bytes = Buffer.from(JSON.stringify(body));
  const request = Readable.from([...bytes].map(byte => Buffer.from([byte]))) as IncomingMessage;
  expect(await readAndClassifyBody(request, undefined, { maxBytes: bytes.length })).toMatchObject({ requests: [body] });
});
