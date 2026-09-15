import { expect, it } from "vitest";
import { decorateModernResult } from "./protocol.js";

const identity = { name: "mrtr", version: "1" };

it("allows null and fractional numbers in sampling metadata", () => {
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { sample: { method: "sampling/createMessage", params: {
      messages: [], maxTokens: 10, metadata: { optional: null, fraction: 0.5 }
    } } }
  } }, identity, { sampling: {} })).toHaveProperty("result");
});

it.each([{ tools: [] }, { toolChoice: { mode: "required" } }])(
  "requires sampling tool support for %j",
  (fields) => {
    expect(decorateModernResult("tools/call", { result: {
      resultType: "input_required", inputRequests: { sample: { method: "sampling/createMessage", params: {
        messages: [], maxTokens: 10, ...fields
      } } }
    } }, identity, { sampling: {} })).toMatchObject({
      error: { code: -32021, data: { requiredCapabilities: { sampling: { tools: {} } } } }
    });
  }
);

it.each(["not a URL", "https://[invalid"])("rejects invalid elicitation URL %s", (url) => {
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { open: { method: "elicitation/create", params: {
      mode: "url", message: "Open", url
    } } }
  } }, identity, { elicitation: { url: {} } })).toMatchObject({ error: { code: -32603 } });
});

it("rejects cyclic input requests before schema evaluation", () => {
  const request: Record<string, unknown> = { method: "roots/list" };
  request.extra = request;
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { roots: request }
  } }, identity, { roots: {} })).toMatchObject({ error: { code: -32603 } });
});

it.each([NaN, Infinity, BigInt(1), undefined])("rejects non-JSON embedded input value %s", (extra) => {
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { roots: { method: "roots/list", extra } }
  } }, identity, { roots: {} })).toMatchObject({ error: { code: -32603 } });
});

it.each([
  [{}, "url"],
  [{ form: {} }, "url"],
  [{ url: {} }, "form"]
])("requires the requested elicitation mode for capabilities %j, mode %s", (elicitation, mode) => {
  const params = mode === "url"
    ? { mode, message: "Open", url: "https://example.com" }
    : { mode, message: "Details", requestedSchema: { type: "object", properties: {} } };
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { details: { method: "elicitation/create", params } }
  } }, identity, { elicitation })).toMatchObject({
    error: { code: -32021, data: { requiredCapabilities: { elicitation: { [mode]: {} } } } }
  });
});

it("treats empty elicitation capabilities as implicit form support", () => {
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { details: { method: "elicitation/create", params: {
      message: "Details", requestedSchema: { type: "object", properties: {} }
    } } }
  } }, identity, { elicitation: {} })).toHaveProperty("result");
});

it.each([
  { method: "sampling/createMessage" },
  { method: "sampling/createMessage", params: { messages: [], maxTokens: "10" } },
  { method: "sampling/createMessage", params: { messages: [{ role: "system", content: { type: "text", text: "x" } }], maxTokens: 10 } },
  { method: "sampling/createMessage", params: { messages: [{ role: "user", content: { type: "text" } }], maxTokens: 10 } },
  { method: "elicitation/create", params: {} },
  { method: "elicitation/create", params: { mode: "url", message: "Open" } },
  { method: "elicitation/create", params: { mode: "invalid", message: "Open", url: "https://example.com" } },
  { method: "elicitation/create", params: { message: "Details", requestedSchema: { type: "object", properties: { nested: { type: "object" } } } } },
  { method: "elicitation/create", params: { message: "Details", requestedSchema: { type: "object", properties: {}, required: [1] } } }
])("rejects malformed nested input requests %j", (request) => {
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { input: request }
  } }, identity, { sampling: {}, elicitation: {} })).toMatchObject({ error: { code: -32603 } });
});

it.each([
  { method: "sampling/createMessage", params: { messages: [{ role: "user", content: { type: "text", text: "x" } }], maxTokens: 10 } },
  { method: "elicitation/create", params: { message: "Details", requestedSchema: { type: "object", properties: { value: { type: "string" } } } } },
  { method: "elicitation/create", params: { mode: "url", message: "Open", url: "https://example.com" } }
])("preserves spec-legal nested input requests %j", (request) => {
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { input: request }
  } }, identity, { sampling: {}, elicitation: { form: {}, url: {} } })).toHaveProperty("result");
});

it.each(["tools/list", "server/discover", "custom"])("rejects input_required for %s", (method) => {
  expect(
    decorateModernResult(
      method,
      { result: { resultType: "input_required", requestState: "opaque" } },
      identity
    )
  ).toMatchObject({ error: { code: -32603 } });
});

it.each([
  {},
  { requestState: 1 },
  { inputRequests: null },
  { inputRequests: [] },
  { inputRequests: { login: { method: "custom", params: {} } } }
])("rejects malformed or unadvertised input requirements %j", (fields) => {
  expect(
    decorateModernResult(
      "tools/call",
      { result: { resultType: "input_required", ...fields } },
      identity
    )
  ).toMatchObject({ error: { code: -32603 } });
});

it.each(["tools/call", "prompts/get", "resources/read"])(
  "preserves opaque request state for %s",
  (method) => {
    expect(
      decorateModernResult(
        method,
        { result: { resultType: "input_required", requestState: "\u0000opaque\ud83d\udd12" } },
        identity
      )
    ).toMatchObject({
      result: { resultType: "input_required", requestState: "\u0000opaque\ud83d\udd12" }
    });
  }
);

it("permits input requests supported by client capabilities", () => {
  const inputRequests = { roots: { method: "roots/list", params: {} } };
  expect(
    decorateModernResult(
      "tools/call",
      { result: { resultType: "input_required", inputRequests } },
      identity,
      { roots: {} }
    )
  ).toMatchObject({ result: { resultType: "input_required", inputRequests } });
});

it("reports all missing client capabilities before requesting inputs", () => {
  expect(decorateModernResult("tools/call", {
    result: {
      resultType: "input_required",
      inputRequests: {
        roots: { method: "roots/list" },
        sample: { method: "sampling/createMessage", params: { messages: [], maxTokens: 1 } }
      }
    }
  }, identity)).toMatchObject({
    error: { code: -32021, data: { requiredCapabilities: { roots: {}, sampling: {} } } }
  });
});

import { createServer, defineSchema } from "./index.js";

it.each(["tools/call", "prompts/get", "resources/read"])(
  "supports %s input retries through registered handlers",
  async (method) => {
    const server = createServer({ name: "mrtr", version: "1" });
    const contexts: unknown[] = [];
    const handler = (
      _argument: unknown,
      context: { requestState?: string; inputResponses?: Record<string, unknown> }
    ) => {
      contexts.push(context);
      return context?.requestState === "opaque"
        ? method === "tools/call"
          ? { value: "done" }
          : method === "prompts/get"
            ? { messages: [] }
            : { contents: [] }
        : { resultType: "input_required", requestState: "opaque" };
    };
    server.tool(
      "retry",
      "Retry",
      defineSchema({}),
      handler as never,
      defineSchema({ value: { type: "string" } })
    );
    server.prompt({ name: "retry" }, handler as never);
    server.resource({ name: "retry", uri: "memo://retry" }, handler as never);
    const params = {
      name: "retry",
      uri: "memo://retry",
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    };
    expect(await server.handleMessage(method, params)).toMatchObject({
      result: { resultType: "input_required", requestState: "opaque" }
    });
    expect(
      await server.handleMessage(method, {
        ...params,
        requestState: "opaque",
        inputResponses: { login: { action: "accept" } }
      })
    ).toMatchObject({ result: { resultType: "complete" } });
    expect(contexts[1]).toMatchObject({
      requestState: "opaque",
      inputResponses: { login: { action: "accept" } },
      signal: expect.any(AbortSignal)
    });
  }
);

it.each([
  { requestState: 1 }, { inputResponses: null }, { inputResponses: [] },
  { inputResponses: { reply: {} } },
  { inputResponses: { reply: { roots: [{ uri: 1 }] } } },
  { inputResponses: { reply: { action: "unknown" } } }
])(
  "rejects malformed retry params %j before calling a handler",
  async (fields) => {
    const server = createServer({ name: "mrtr", version: "1" });
    let called = false;
    server.resource({ name: "retry", uri: "memo://retry" }, () => {
      called = true;
      return { contents: [] };
    });
    expect(
      await server.handleMessage("resources/read", {
        ...fields,
        uri: "memo://retry",
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      })
    ).toMatchObject({ error: { code: -32602 } });
    expect(called).toBe(false);
  }
);
