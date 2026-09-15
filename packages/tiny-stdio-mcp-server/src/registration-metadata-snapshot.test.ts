import { expect, it } from "vitest";
import { createServer } from "./index.js";

const _meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

it("isolates prompt argument and icon metadata from caller mutation", async () => {
  const descriptor = { name: "describe", arguments: [{ name: "subject", title: "Subject", required: true }], icons: [{ src: "https://example.com/prompt.png" }], _meta: { source: "original" } };
  const server = createServer({ name: "metadata", version: "1" }).prompt(descriptor, () => ({ messages: [] }));
  descriptor.arguments[0].title = "mutated";
  descriptor.icons[0].src = "https://example.com/mutated.png";
  descriptor._meta.source = "mutated";
  expect(await server.handleMessage("prompts/list", { _meta })).toMatchObject({ result: { prompts: [{ arguments: [{ title: "Subject" }], icons: [{ src: "https://example.com/prompt.png" }], _meta: { source: "original" } }] } });
});

it.each(["resource", "resourceTemplate"] as const)("isolates %s annotations, icons and metadata from caller mutation", async (kind) => {
  const descriptor = { name: "data", uri: "file:///data", uriTemplate: "file:///{name}", annotations: { priority: 0.5 }, icons: [{ src: "https://example.com/data.png" }], _meta: { source: "original" } };
  const server = createServer({ name: "metadata", version: "1" });
  server[kind](descriptor, () => ({ contents: [] }));
  descriptor.annotations.priority = 2;
  descriptor.icons[0].src = "https://example.com/mutated.png";
  descriptor._meta.source = "mutated";
  const result = await server.handleMessage(kind === "resource" ? "resources/list" : "resources/templates/list", { _meta });
  expect(result.error).toBeUndefined();
  expect(result.result).toMatchObject({ [kind === "resource" ? "resources" : "resourceTemplates"]: [{ annotations: { priority: 0.5 }, icons: [{ src: "https://example.com/data.png" }], _meta: { source: "original" } }] });
});

it.each(["tools/list", "prompts/list", "resources/list", "resources/templates/list"])("does not let %s response mutation alter later discovery", async (method) => {
  const server = createServer({ name: "metadata", version: "1" });
  const icons = [{ src: "https://example.com/original.png" }];
  server.registerTool({ name: "work", inputSchema: { type: "object" }, icons }, () => "ready");
  server.prompt({ name: "describe", icons }, () => ({ messages: [] }));
  server.resource({ name: "data", uri: "file:///data", icons }, () => ({ contents: [] }));
  server.resourceTemplate({ name: "data", uriTemplate: "file:///{name}", icons }, () => ({ contents: [] }));
  const key = method === "tools/list" ? "tools" : method === "prompts/list" ? "prompts" : method === "resources/list" ? "resources" : "resourceTemplates";
  const first = await server.handleMessage(method, { _meta });
  const items = (first.result as Record<string, Array<{ icons: Array<{ src: string }> }>>)[key];
  items[0].icons[0].src = "https://example.com/mutated.png";
  expect((await server.handleMessage(method, { _meta })).result).toMatchObject({ [key]: [{ icons: [{ src: "https://example.com/original.png" }] }] });
});
