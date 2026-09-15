import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, type JsonSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";

describe.each(["snake", "camel"] as const)("MCP %s discriminator annotations", (casing) => {
  describe.each([false, true])("stream=%s", (stream) => {
    it.each(["oneOf", "union"])("advertises and executes nullable parent %s defaults", async (kind) => {
      const text = S.Object({ title: S.String() }, { nullable: true, default: null });
      const count = S.Object({ count: S.Number() }, { nullable: true, default: null });
      const choice = {
        ...(kind === "oneOf" ? S.OneOf({ discriminator: "kind", branches: { text, count } }) : S.Union([text, count])),
        nullable: true as const,
        default: null
      };
      const params = S.Object({ choice: S.Optional(choice) });
      const received: unknown[] = [];
      const config = { name: "check", scope: ["mcp"] as const, params };
      const command = stream
        ? defineStreamCommand({ ...config, event: params, async *handler({ params: input }) { received.push(input.choice); yield input; } })
        : defineCommand({ ...config, result: params, handler: ({ params: input }) => { received.push(input.choice); return input; } });
      let finish: () => void;
      let finished = new Promise<void>((resolve) => { finish = resolve; });
      const notifications: Array<Record<string, unknown>> = [];
      const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", casing, errorReports: false }).createMessageSession((notification) => {
        if (notification.params === undefined) return;
        notifications.push(notification.params);
        if (notification.params.type === "end" || notification.params.type === "error") finish();
      });
      try {
        await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        await session.handleMessage("notifications/initialized");
        const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
        const definition = (listing.result?.[stream ? "streams" : "tools"] as Array<{ inputSchema: JsonSchema; outputSchema?: JsonSchema; eventSchema?: JsonSchema }>)[0]!;
        const output = stream ? definition.eventSchema : definition.outputSchema;
        for (const advertised of [definition.inputSchema, output]) {
          const projected = advertised?.properties?.choice;
          if (projected === undefined) throw new Error("Expected choice schema");
          expect(projected.default).toBeNull();
          expect(projected.oneOf).toHaveLength(3);
          expect(compileJsonSchema(projected).validate(null).ok).toBe(true);
        }
        for (const args of [{}, { choice: null }]) {
          const response = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", { name: "audit__check", arguments: args });
          expect(response).not.toHaveProperty("error");
          if (stream) {
            expect(response.result?.eventSchema).toEqual(output);
            await finished;
            expect(notifications.filter((notification) => notification.type === "error")).toEqual([]);
            finished = new Promise<void>((resolve) => { finish = resolve; });
          } else {
            expect(response.result?.structuredContent).toEqual({ choice: null });
          }
        }
        expect(received).toEqual([null, null]);
        if (stream) expect(notifications.filter((notification) => notification.type === "data").map((notification) => notification.event)).toEqual([{ choice: null }, { choice: null }]);
      } finally {
        session.close();
      }
    });

    it.each(["absent", "object", "authoritative", "nullable object", "null"])("keeps %s branch defaults consistent with runtime", async (scenario) => {
      const canonicalKey = casing === "camel" ? "display_name" : "displayName";
      const wireKey = casing === "camel" ? "displayName" : "display_name";
      const wireTag = casing === "camel" ? "deliveryKind" : "delivery_kind";
      const defaultValue = scenario === "absent" ? undefined : scenario === "null" ? null : {
        [canonicalKey]: "Ada",
        ...(scenario === "authoritative" ? { delivery_kind: "wrong" } : {})
      };
      const branch = S.Object({ [canonicalKey]: S.String() }, { nullable: scenario === "nullable object" || scenario === "null", additionalProperties: scenario === "authoritative", ...(defaultValue === undefined ? {} : { default: defaultValue }) });
      const choice = S.OneOf({ discriminator: "delivery_kind", branches: { text: branch } });
      const original = structuredClone(branch);
      const params = S.Object({ choice });
      const received: unknown[] = [];
      const config = { name: "check", scope: ["mcp"] as const, params };
      const command = stream
        ? defineStreamCommand({ ...config, event: params, async *handler({ params: input }) { received.push(input.choice); yield input; } })
        : defineCommand({ ...config, result: params, handler: ({ params: input }) => { received.push(input.choice); return input; } });
      let finish: () => void;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const notifications: Array<Record<string, unknown>> = [];
      const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", casing, errorReports: false }).createMessageSession((notification) => {
        if (notification.params === undefined) return;
        notifications.push(notification.params);
        if (notification.params.type === "end" || notification.params.type === "error") finish();
      });
      try {
        await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        await session.handleMessage("notifications/initialized");
        const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
        const definition = (listing.result?.[stream ? "streams" : "tools"] as Array<{ inputSchema: JsonSchema; outputSchema?: JsonSchema; eventSchema?: JsonSchema }>)[0]!;
        const output = stream ? definition.eventSchema : definition.outputSchema;
        const expected = { [wireKey]: "Ada", [wireTag]: "text" };
        let inputDefault: unknown;
        for (const advertised of [definition.inputSchema, output]) {
          const projected = advertised?.properties?.choice;
          if (projected === undefined) throw new Error("Expected choice schema");
          expect(projected).not.toHaveProperty("default");
          expect(compileJsonSchema(projected).validate(null).ok).toBe(false);
          const selected = projected.oneOf?.[0];
          if (selected === undefined) throw new Error("Expected branch schema");
          if (defaultValue === undefined || defaultValue === null) {
            expect(selected).not.toHaveProperty("default");
          } else {
            expect(selected.default).toStrictEqual(expected);
            expect(compileJsonSchema(projected).validate(selected.default).ok).toBe(true);
            inputDefault = selected.default;
          }
        }
        const method = stream ? "toolcraft/streams/subscribe" : "tools/call";
        expect(await session.handleMessage(method, { name: "audit__check", arguments: { choice: null } })).toMatchObject({ error: { code: -32602 } });
        expect(received).toEqual([]);
        const response = await session.handleMessage(method, { name: "audit__check", arguments: { choice: inputDefault ?? expected } });
        expect(response).not.toHaveProperty("error");
        if (stream) {
          expect(response.result?.eventSchema).toEqual(output);
          await finished;
          expect(notifications.filter((notification) => notification.type === "error")).toEqual([]);
          expect(notifications.find((notification) => notification.type === "data")?.event).toEqual({ choice: expected });
        } else {
          expect(response.result?.structuredContent).toEqual({ choice: expected });
        }
        expect(received).toEqual([{ [canonicalKey]: "Ada", delivery_kind: "text" }]);
        expect(branch).toStrictEqual(original);
      } finally {
        session.close();
      }
    });
  });
});
