import { describe, expect, it, vi } from "vitest";
import { S, type StandardSchema } from "toolcraft-schema";
import { createServer, defineSchema } from "./index.js";

function transformedSchema(): StandardSchema<{ count: string }, { count: number }> {
  return {
    "~standard": {
      version: 1, vendor: "test-library",
      async validate(value) {
        const { count } = value as { count: string };
        return count === "bad" ? { issues: [{ message: "not a count", path: [{ key: "count" }] }] }
          : { value: { count: Number(count) } };
      },
      jsonSchema: {
        input: () => ({ type: "object", properties: { count: { type: "string" } }, required: ["count"] }),
        output: () => ({ type: "object", properties: { count: { type: "number" } }, required: ["count"] })
      }
    }
  };
}

describe("standard tool schemas", () => {
  it.each(["tool", "registerTool"] as const)("supports standard and raw schemas through %s", async (registration) => {
    const server = createServer({ name: "standard", version: "1" });
    const input = S.Object({ count: S.Optional(S.Number({ default: 10 })) });
    const output = S.Object({ count: S.Number() });
    const handler = vi.fn((args: { count: number }) => args);
    if (registration === "tool") server.tool("count", "Count", input, handler, output);
    else server.registerTool({ name: "count", inputSchema: input, outputSchema: output, _meta: { custom: true } }, handler);
    server.tool("raw", "Raw", defineSchema({ name: { type: "string" } }), ({ name }) => name);
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/list", {})).toMatchObject({ result: { tools: [
      { name: "count", inputSchema: { type: "object", required: [] }, outputSchema: { type: "object", required: ["count"] } },
      { name: "raw" }
    ] } });
    expect(await server.handleMessage("tools/call", { name: "count", arguments: {} })).toMatchObject({ result: { structuredContent: { count: 10 } } });
    expect(handler.mock.calls[0][0]).toEqual({ count: 10 });
    expect(await server.handleMessage("tools/call", { name: "raw", arguments: { name: "Ada" } })).toMatchObject({ result: { content: [{ text: "Ada" }] } });
  });

  it("awaits refinements, passes transformed input and retains structured error paths", async () => {
    const handler = vi.fn(({ count }: { count: number }) => String(count + 1));
    const server = createServer({ name: "async", version: "1" }).tool("count", "Count", transformedSchema(), handler);
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/call", { name: "count", arguments: { count: "4" } })).toMatchObject({ result: { content: [{ text: "5" }] } });
    expect(await server.handleMessage("tools/call", { name: "count", arguments: { count: "bad" } })).toMatchObject({ error: { code: -32602, message: expect.stringContaining("not a count"), data: [{ path: [{ key: "count" }], message: "not a count" }] } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("parses output once before generating structured content and fallback text", async () => {
    const output = transformedSchema();
    const parse = vi.spyOn(output["~standard"], "validate");
    const server = createServer({ name: "output", version: "1" }).tool("count", "Count", defineSchema({}), () => ({ count: "4" }), output);
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/call", { name: "count", arguments: {} })).toMatchObject({ result: { structuredContent: { count: 4 }, content: [{ text: '{"count":4}' }] } });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("preserves explicit content and skips parsing error results", async () => {
    const output = transformedSchema();
    const parse = vi.spyOn(output["~standard"], "validate");
    const server = createServer({ name: "envelopes", version: "1" });
    server.tool("ok", "OK", defineSchema({}), () => ({ content: [{ type: "text", text: "custom" }], structuredContent: { count: "2" } }), output);
    server.tool("error", "Error", defineSchema({}), () => ({ content: [{ type: "text", text: "failed" }], isError: true }), output);
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/call", { name: "ok" })).toMatchObject({ result: { structuredContent: { count: 2 }, content: [{ text: "custom" }] } });
    expect(await server.handleMessage("tools/call", { name: "error" })).toMatchObject({ result: { isError: true } });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("fails registration clearly when standard conversion is unavailable", () => {
    const schema = { "~standard": { version: 1, vendor: "old-library", validate: () => ({ value: {} }) } };
    expect(() => createServer({ name: "missing", version: "1" }).tool("bad", "Bad", schema as never, () => "x")).toThrow("Standard JSON Schema");
  });

  it("recognizes standard interfaces on callable schemas", async () => {
    const schema = Object.assign(() => undefined, transformedSchema());
    const server = createServer({ name: "callable", version: "1" }).tool("count", "Count", schema, ({ count }) => String(count));
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/call", { name: "count", arguments: { count: "2" } })).toMatchObject({ result: { content: [{ text: "2" }] } });
  });

  it("keeps unexpected parser exceptions out of public tool results", async () => {
    const schema = transformedSchema();
    vi.spyOn(schema["~standard"], "validate").mockRejectedValue(new Error("private parser detail"));
    const server = createServer({ name: "parser-error", version: "1" }).tool("count", "Count", schema, () => "unused");
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/call", { name: "count", arguments: { count: "1" } })).toEqual({ error: { code: -32603, message: "Tool schema validation failed" } });
  });

  it("includes asynchronous validation in the tool timeout", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    const schema = transformedSchema();
    vi.spyOn(schema["~standard"], "validate").mockImplementation(async () => { await waiting; return { value: { count: 1 } }; });
    const handler = vi.fn(() => "unreachable");
    const server = createServer({ name: "timeout", version: "1", toolCallTimeoutMs: 5 }).tool("wait", "Wait", schema, handler);
    try {
      await server.handleMessage("initialize", {});
      const call = server.handleMessage("tools/call", { name: "wait", arguments: { count: "1" } });
      await vi.advanceTimersByTimeAsync(5);
      expect(await call).toMatchObject({ error: { code: -32603, message: "Tool call timed out: wait" } });
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).not.toHaveBeenCalled();
    } finally { finish(); vi.useRealTimers(); }
  });
});
