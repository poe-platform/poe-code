---
name: "MCP `generate_text` Drops a `__proto__` Tool Parameter Before the LLM Request"
---

# MCP `generate_text` Drops a `__proto__` Tool Parameter Before the LLM Request

## Summary

The public Poe MCP server accepts a `generate_text` tool call whose `params` object owns a string-valued `__proto__` property, but silently discards that property before invoking the LLM client. This happens in the MCP-specific parameter normalization layer, separately from the CLI `generate --param` parser.

## Reproduction

Create a disposable Vitest probe at `src/cli/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { setGlobalClient } from "../services/client-instance.js";
import { createMcpServer } from "./mcp-server.js";
import type { LlmClient } from "./services/llm-client.js";

it("drops an MCP tool parameter named __proto__ before invoking the LLM client", async () => {
  const client: LlmClient = {
    text: vi.fn(async () => ({ content: "ok" })),
    media: vi.fn(async () => ({}))
  };
  setGlobalClient(client);
  const server = createMcpServer();
  await server.handleMessage("initialize", {});

  await server.handleMessage("tools/call", {
    name: "generate_text",
    arguments: {
      bot_name: "test-bot",
      message: "Test",
      params: JSON.parse('{"__proto__":"visible"}')
    }
  });

  const params = (client.text as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].params;
  expect(params).toBeUndefined();
});
```

Run:

```sh
npm exec -- vitest run src/cli/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a successful public MCP tool invocation reaches `client.text()` without its submitted parameter. Remove the disposable probe after validation.

## Observed Behavior

After `createMcpServer()` handles an initialized `tools/call` request for `generate_text` containing `params: { "__proto__": "visible" }`, the LLM client is called with `params: undefined`. `src/cli/mcp-server.ts` receives tool input through the registered handler, then `normalizeParams()` copies each string-valued key into `result = {}` using `result[key] = value`; assigning `__proto__` does not create an own data property, and the empty result is converted to `undefined` before `generateText()` calls the client.

## Expected Behavior

The MCP server should faithfully forward accepted string-valued tool parameters, including an own `__proto__` field, or reject unsupported parameter names with an MCP error response instead of successfully issuing a modified model request.

## Impact

MCP clients can submit a valid generation tool request and receive a normal response even though one of their requested model parameters was omitted. This creates silent request corruption at the protocol boundary and makes remote-agent behavior difficult to audit or reproduce.
