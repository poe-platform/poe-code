import { expect, it } from "vitest";
import { decorateModernResult } from "./protocol.js";

const use = { type: "tool_use", id: "a", name: "lookup", input: {} };
const result = { type: "tool_result", toolUseId: "a", content: [] };
const text = { type: "text", text: "continue" };

it.each([
  [{ role: "assistant", content: use }],
  [{ role: "assistant", content: use }, { role: "user", content: text }],
  [{ role: "assistant", content: use }, { role: "user", content: [result, text] }],
  [{ role: "user", content: result }],
  [{ role: "user", content: use }],
  [{ role: "assistant", content: result }],
  [{ role: "assistant", content: [use, use] }, { role: "user", content: result }],
  [{ role: "assistant", content: [use, { ...use, id: "b" }] }, { role: "user", content: result }],
  [{ role: "assistant", content: use }, { role: "user", content: { ...result, toolUseId: "b" } }],
  [{ role: "assistant", content: use }, { role: "user", content: [result, result] }]
].map((messages) => [messages]))("rejects invalid sampling tool sequence %j", (messages) => {
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { sample: { method: "sampling/createMessage", params: {
      messages, maxTokens: 10
    } } }
  } }, { name: "sampling", version: "1" }, { sampling: { tools: {} } })).toMatchObject({ error: { code: -32603 } });
});

it("accepts mixed assistant text/tool uses followed by exactly matching results in any order", () => {
  const messages = [
    { role: "assistant", content: [text, use, { ...use, id: "b" }] },
    { role: "user", content: [{ ...result, toolUseId: "b" }, result] },
    { role: "assistant", content: text }
  ];
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { sample: { method: "sampling/createMessage", params: {
      messages, maxTokens: 10
    } } }
  } }, { name: "sampling", version: "1" }, { sampling: { tools: {} } })).toHaveProperty("result");
});

it("requires sampling.tools for a tool-enabled message history", () => {
  const messages = [{ role: "assistant", content: use }, { role: "user", content: result }];
  expect(decorateModernResult("tools/call", { result: {
    resultType: "input_required", inputRequests: { sample: { method: "sampling/createMessage", params: {
      messages, maxTokens: 10
    } } }
  } }, { name: "sampling", version: "1" }, { sampling: {} })).toMatchObject({
    error: { code: -32021, data: { requiredCapabilities: { sampling: { tools: {} } } } }
  });
});
