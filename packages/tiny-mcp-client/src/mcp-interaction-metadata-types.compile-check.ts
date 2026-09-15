import type {
  CompleteParams, CreateMessageResult, ElicitationParams, ElicitationResult,
  Implementation, Root, SamplingMessage, ToolResultContent, ToolUseContent,
} from "./index.js";

const metadata = { source: "fixture" };
const implementation: Implementation = { name: "example", version: "1", title: "Example", description: "Example client", websiteUrl: "https://example.com", icons: [{ src: "https://example.com/icon.png" }] };
const root: Root = { uri: "file:///workspace", _meta: metadata };
const use: ToolUseContent = { type: "tool_use", id: "call", name: "read", input: {}, _meta: metadata };
const result: ToolResultContent = { type: "tool_result", toolUseId: "call", content: [], _meta: metadata };
const message: SamplingMessage = { role: "assistant", content: use, _meta: metadata };
const completion: CompleteParams = { ref: { type: "ref/prompt", name: "example" }, argument: { name: "subject", value: "a" }, context: { arguments: { language: "English" } } };
const sampled: CreateMessageResult = { role: "assistant", model: "mock", content: { type: "text", text: "ready" }, _meta: metadata };
const elicitation: ElicitationParams = { mode: "url", message: "Authorize", url: "https://example.com/authorize", elicitationId: "authorization" };
const elicited: ElicitationResult = { action: "decline", _meta: metadata };
void [implementation, root, result, message, completion, sampled, elicitation, elicited];

const invalidResourceSampling: SamplingMessage = {
  role: "assistant",
  // @ts-expect-error Sampling does not admit embedded resource blocks.
  content: { type: "resource", resource: { uri: "file:///data", text: "data" } },
};
const invalidLinkSampling: SamplingMessage = {
  role: "assistant",
  // @ts-expect-error Sampling does not admit direct resource links.
  content: { type: "resource_link", name: "data", uri: "file:///data" },
};
void [invalidResourceSampling, invalidLinkSampling];
