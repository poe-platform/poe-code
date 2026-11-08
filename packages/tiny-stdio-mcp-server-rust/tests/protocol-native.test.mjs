import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, validateProtocolValue } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";
import { validateProtocolValue as referenceValidate } from "../../tiny-stdio-mcp-server/dist/protocol-validation.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

test("native normative protocol definitions match the TypeScript validator", () => {
  for (const [name, values] of [
    [
      "ClientCapabilities",
      [
        {},
        { roots: {} },
        { sampling: { tools: {} } },
        { roots: false },
        { sampling: [] },
        { elicitation: { url: true } },
        { extensions: { "example.test/feature": {} } },
        { extensions: { invalid: {} } }
      ]
    ],
    [
      "InputResponses",
      [
        {},
        { one: { action: "accept" } },
        { one: { action: "cancel" } },
        { one: { action: "decline", content: { number: 0.5, flags: ["a"] } } },
        { one: {} },
        { one: { action: "other" } },
        { one: { roots: [{ uri: "file:///a" }] } },
        { one: { roots: [{ uri: 1 }] } },
        { one: { role: "assistant", model: "test", content: { type: "text", text: "hi" } } }
      ]
    ],
    [
      "InputRequest",
      [
        { method: "roots/list" },
        { method: "roots/list", params: {} },
        { method: "sampling/createMessage", params: { messages: [], maxTokens: 1 } },
        {
          method: "elicitation/create",
          params: {
            message: "Details",
            requestedSchema: { type: "object", properties: { a: { type: "string" } } }
          }
        },
        {
          method: "elicitation/create",
          params: { mode: "url", message: "Open", url: "https://example.test" }
        },
        { method: "sampling/createMessage" },
        { method: "elicitation/create", params: { mode: "url", message: "Open", url: "not a URL" } }
      ]
    ],
    [
      "ListRootsResult",
      [
        { roots: [] },
        { roots: [{ uri: "file:///a" }] },
        { roots: [{ uri: "https://example.test" }] }
      ]
    ],
    [
      "Result",
      [{}, { _meta: { "example.test/receipt": null } }, { _meta: { "invalid key": true } }]
    ],
    [
      "CallToolResult",
      [
        { content: [], resultType: "complete" },
        {
          content: [{ type: "image", data: "YQ==", mimeType: "image/png" }],
          resultType: "complete"
        },
        {
          content: [{ type: "image", data: "YR==", mimeType: "image/png" }],
          resultType: "complete"
        }
      ]
    ]
  ]) {
    for (const value of [null, [], 1, ...values])
      assert.equal(
        validateProtocolValue(name, value),
        referenceValidate(name, value),
        JSON.stringify({ name, value })
      );
  }
  let calls = 0;
  const getter = Object.defineProperty({}, "roots", {
    enumerable: true,
    get() {
      calls++;
      return {};
    }
  });
  assert.equal(validateProtocolValue("ClientCapabilities", getter), false);
  assert.equal(
    validateProtocolValue("ClientCapabilities", {
      toJSON() {
        calls++;
        return {};
      }
    }),
    false
  );
  assert.equal(calls, 0);
});

test("modern retry schemas reject malformed fields before handlers execute", async () => {
  const native = createServer({ name: "test", version: "0" }),
    reference = referenceCreateServer({ name: "test", version: "0" });
  const calls = [];
  for (const server of [native, reference])
    server.resource({ name: "retry", uri: "memo://retry" }, () => {
      calls.push(server);
      return { contents: [] };
    });
  for (const fields of [
    { requestState: 1 },
    { inputResponses: null },
    { inputResponses: [] },
    { inputResponses: { reply: {} } },
    { inputResponses: { reply: { roots: [{ uri: 1 }] } } },
    { inputResponses: { reply: { action: "unknown" } } }
  ]) {
    const request = { ...fields, uri: "memo://retry", _meta: metadata };
    assert.deepEqual(
      await native.handleMessage("resources/read", request),
      await reference.handleMessage("resources/read", request)
    );
  }
  assert.deepEqual(calls, []);
});
