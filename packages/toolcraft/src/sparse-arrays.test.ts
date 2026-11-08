import { describe, expect, it, vi } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createSDK } from "./sdk.js";
import { createMCPServer } from "./mcp.js";

const items: Array<{ name: string; schema: AnySchema; value: unknown }> = [
  { name: "string", schema: S.String(), value: "ready" },
  { name: "number", schema: S.Number(), value: 1 },
  { name: "object", schema: S.Object({ value: S.String() }), value: { value: "ready" } },
  { name: "array", schema: S.Array(S.String()), value: ["ready"] },
  { name: "json", schema: S.Json(), value: { ready: true } }
];

describe.each(["direct", "object", "record", "oneOf", "union"])("SDK sparse arrays via %s", (placement) => {
  describe.each(items)("$name items", ({ schema: itemSchema, value }) => {
    it.each([0, 1, 2])("rejects missing index %s before invocation", async (hole) => {
      const values = Array.from({ length: 3 }, () => structuredClone(value));
      const branch = S.Object({ items: S.Array(itemSchema) });
      const params = placement === "direct" ? branch : S.Object({ payload:
        placement === "object" ? branch : placement === "record" ? S.Record(S.Array(itemSchema))
          : placement === "oneOf" ? S.OneOf({ discriminator: "kind", branches: { chosen: branch } }) : S.Union([branch])
      });
      const input = placement === "direct" ? { items: values } : { payload:
        placement === "record" ? { selected: values } : { ...(placement === "oneOf" ? { kind: "chosen" } : {}), items: values }
      };
      const handler = vi.fn(({ params }: { params: unknown }) => params);
      const sdk = createSDK(defineGroup({ name: "audit", children: [defineCommand({ name: "check", params, handler })] })) as unknown as { check(input: unknown): Promise<unknown> };
      await expect(sdk.check(input)).resolves.toEqual(input);
      handler.mockClear();
      delete values[hole];
      await expect(sdk.check(input)).rejects.toThrow(`[${hole}]`);
      expect(handler).not.toHaveBeenCalled();
      expect(Object.hasOwn(values, hole)).toBe(false);
    });
  });
});

describe("SDK array boundaries", () => {
  it.each([false, true])("normalizes optional missing items, defaulted=%s", async (defaulted) => {
    const original = ["seed"];
    const itemSchema = defaulted ? S.Optional(S.Array(S.String(), { default: original })) : S.Optional(S.String());
    const sdk = createSDK(defineGroup({ name: "audit", children: [defineCommand({ name: "check", params: S.Object({ items: S.Array(itemSchema) }), handler: ({ params }) => params })] }));
    const result = await sdk.check({ items: Array(2) });
    expect(result.items).toStrictEqual(defaulted ? [["seed"], ["seed"]] : [undefined, undefined]);
    if (defaulted) {
      expect(result.items[0]).not.toBe(result.items[1]);
      (result.items[0] as string[]).push("changed");
      expect(result.items[1]).toEqual(["seed"]);
      expect(original).toEqual(["seed"]);
    }
  });

  it.each(["direct", "array", "object"])("rejects holes inside %s JSON", async (placement) => {
    const value = placement === "direct" ? Array(1) : placement === "array" ? [Array(1)] : { items: Array(1) };
    const handler = vi.fn(() => "unexpected");
    const sdk = createSDK(defineGroup({ name: "audit", children: [defineCommand({ name: "check", params: S.Object({ value: S.Json() }), handler })] }));
    await expect(sdk.check({ value })).rejects.toThrow("JSON");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([false, true])("validates indices instead of a custom iterator, invalid=%s", async (invalid) => {
    const values = [invalid ? 42 : "ready"];
    Object.defineProperty(values, Symbol.iterator, { value: function* () { yield invalid ? "ready" : 42; } });
    const sdk = createSDK(defineGroup({ name: "audit", children: [defineCommand({ name: "check", params: S.Object({ items: S.Array(S.String()) }), handler: ({ params }) => params })] }));
    if (invalid) await expect(sdk.check({ items: values as string[] })).rejects.toThrow();
    else await expect(sdk.check({ items: values as string[] })).resolves.toEqual({ items: ["ready"] });
  });

  it("does not delegate validation to an array's own map method", async () => {
    const values = [42];
    Object.defineProperty(values, "map", { value: () => ["ready"] });
    const sdk = createSDK(defineGroup({ name: "audit", children: [defineCommand({ name: "check", params: S.Object({ items: S.Array(S.String()) }), handler: ({ params }) => params })] }));
    await expect(sdk.check({ items: values as unknown as string[] })).rejects.toThrow();
  });
});

describe.each([false, true])("MCP existing sparse-array defense, stream=%s", (stream) => {
  it.each([false, true])("keeps invalid=%s data off the transport", async (invalid) => {
    const value = invalid ? Array(1) : ["ready"];
    const config = { name: "check", scope: ["mcp"] as const, params: S.Object({}) };
    const command = stream
      ? defineStreamCommand({ ...config, event: S.Array(S.String()), async *handler() { yield value; } })
      : defineCommand({ ...config, result: S.Object({ items: S.Array(S.String()) }), handler: () => ({ items: value }) });
    const notifications: Array<Record<string, unknown>> = [];
    let complete: () => void;
    const ended = new Promise<void>((resolve) => { complete = resolve; });
    const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false })
      .createMessageSession((notification) => {
        if (notification.params === undefined) return;
        notifications.push(notification.params);
        if (notification.params.type === "end" || notification.params.type === "error") complete();
      });
    try {
      await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      await session.handleMessage("notifications/initialized");
      const response = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", { name: "audit__check", arguments: {} });
      if (stream) {
        await ended;
        expect(notifications.filter((entry) => entry.type === "data")).toHaveLength(invalid ? 0 : 1);
        expect(notifications.filter((entry) => entry.type === "error")).toHaveLength(invalid ? 1 : 0);
      } else if (invalid) expect(response).toMatchObject({ error: { code: -32603 } });
      else expect(response.result?.structuredContent).toEqual({ items: ["ready"] });
    } finally { session.close(); }
  });
});
