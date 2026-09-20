import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMessage, parseMessageUtf8 } from "../dist/index.js";
import { parseMessage as referenceParseMessage } from "tiny-stdio-mcp-server/jsonrpc";
import {
  JSONRPCRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCErrorResponseSchema
} from "@modelcontextprotocol/sdk/types.js";

test("native parser preserves notification and legacy request object shape", () => {
  assert.deepEqual(parseMessage('{"jsonrpc":"2.0","method":"ping"}'), {
    success: true,
    isNotification: true,
    request: { jsonrpc: "2.0", method: "ping", params: undefined }
  });
  assert.deepEqual(parseMessage('{"jsonrpc":"2.0","id":null,"method":"ping"}'), {
    success: true,
    isNotification: false,
    request: { jsonrpc: "2.0", id: null, method: "ping", params: undefined }
  });
  assert.deepEqual(
    parseMessage('{"jsonrpc":"2.0","id":1.5,"method":"echo","params":{"x":1},"extra":true}'),
    {
      success: true,
      isNotification: false,
      request: { jsonrpc: "2.0", id: 1.5, method: "echo", params: { x: 1 } }
    }
  );
});

test("native parser distinguishes parse errors from invalid envelopes", () => {
  assert.deepEqual(parseMessage("invalid"), {
    success: false,
    id: null,
    error: { code: -32700, message: "Parse error" }
  });
  assert.deepEqual(parseMessage('{"jsonrpc":"1.0","id":"recover","method":"ping"}'), {
    success: false,
    id: "recover",
    error: { code: -32600, message: "Invalid Request" }
  });
  assert.deepEqual(parseMessageUtf8(Buffer.from([0xff])), {
    success: false,
    id: null,
    error: { code: -32700, message: "Parse error" }
  });
});

test("native parser enforces modern IDs without applying modern rules to legacy IDs", () => {
  const params = { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } };
  for (const id of [null, 1.5, 2 ** 53, true]) {
    assert.deepEqual(
      parseMessage(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params })),
      {
        success: false,
        id: null,
        error: { code: -32600, message: "Invalid Request ID" }
      }
    );
  }
  for (const id of [0, Number.MAX_SAFE_INTEGER, "", "\ud800"]) {
    const source = JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params });
    assert.deepEqual(parseMessageUtf8(Buffer.from(source)), parseMessage(source));
    assert.equal(parseMessage(source).request.id, id);
  }
});

test("native request parser agrees with the existing TypeScript implementation", () => {
  for (const source of [
    "",
    "invalid",
    "null",
    "[]",
    "[{}]",
    "0",
    "{}",
    '{"id":"recover"}',
    '{"jsonrpc":"2.0","method":"ping"}',
    '{"jsonrpc":"2.0","id":null,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1.5,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1e400,"method":"ping"}',
    '{"jsonrpc":"2.0","id":"\ud800","method":"ping"}',
    '{"jsonrpc":"2.0","id":[],"method":"ping"}',
    '{"jsonrpc":"2.0","id":"recover","method":null}',
    '{"jsonrpc":"2.0","method":"echo","params":{"__proto__":1,"\\ud800":"\\udfff"}}',
    '{"jsonrpc":"2.0","method":"echo","params":null}',
    '{"jsonrpc":"2.0","method":"echo","params":[]}'
  ]) {
    assert.deepEqual(parseMessage(source), referenceParseMessage(source), source);
  }
  const versions = [undefined, "2025-11-25", "2026-07-28"];
  for (const id of [undefined, null, "", "\ud800", 0, -1, 1.5, 2 ** 53, {}, false]) {
    for (const version of versions) {
      const source = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": version } }
      });
      assert.deepEqual(parseMessage(source), referenceParseMessage(source), source);
      assert.deepEqual(
        parseMessageUtf8(Buffer.from(source)),
        referenceParseMessage(source),
        source
      );
    }
  }
});

test("shared valid envelopes conform to the official MCP SDK schemas", () => {
  for (const source of [
    '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":"call","method":"tools/call","params":{"name":"echo","arguments":{}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  ]) {
    const result = parseMessage(source);
    assert.equal(result.success, true);
    const schema = result.isNotification ? JSONRPCNotificationSchema : JSONRPCRequestSchema;
    assert.equal(schema.safeParse(result.request).success, true, source);
  }
  const result = parseMessage('{"jsonrpc":"1.0","id":1,"method":"ping"}');
  assert.equal(
    JSONRPCErrorResponseSchema.safeParse({ jsonrpc: "2.0", id: result.id, error: result.error })
      .success,
    true
  );
});

test("legacy null IDs retain repository compatibility where the SDK schema differs", () => {
  const source = '{"jsonrpc":"2.0","id":null,"method":"ping"}';
  const result = parseMessage(source);
  assert.deepEqual(result, referenceParseMessage(source));
  assert.equal(JSONRPCRequestSchema.safeParse(result.request).success, false);
  const failure = parseMessage("invalid");
  assert.deepEqual(failure, referenceParseMessage("invalid"));
  assert.equal(
    JSONRPCErrorResponseSchema.safeParse({ jsonrpc: "2.0", id: failure.id, error: failure.error })
      .success,
    false
  );
});
