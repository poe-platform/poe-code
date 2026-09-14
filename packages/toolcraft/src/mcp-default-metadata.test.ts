import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, validate, type AnySchema, type JsonSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";

describe.each(["snake", "camel"] as const)("MCP %s default metadata", (casing) => {
  const canonicalKey = casing === "camel" ? "display_name" : "displayName";
  const wireKey = casing === "camel" ? "displayName" : "display_name";
  const object = S.Object({ [canonicalKey]: S.String() });
  const cases: Array<{ name: string; schema: AnySchema; expected: unknown }> = [
    { name: "object", schema: S.Object(object.shape, { default: { [canonicalKey]: "Ada" } }), expected: { [wireKey]: "Ada" } },
    { name: "array", schema: S.Array(object, { default: [{ [canonicalKey]: "Ada" }] }), expected: [{ [wireKey]: "Ada" }] },
    { name: "record", schema: { ...S.Record(object), default: { untouched_key: { [canonicalKey]: "Ada" } } }, expected: { untouched_key: { [wireKey]: "Ada" } } },
    { name: "nested", schema: S.Object({ entries: S.Array(S.Record(object)) }, { default: { entries: [{ untouched_key: { [canonicalKey]: "Ada" } }] } }), expected: { entries: [{ untouched_key: { [wireKey]: "Ada" } }] } },
    { name: "additional properties", schema: S.Object(object.shape, { additionalProperties: true, default: { [canonicalKey]: "Ada", untouched_key: { nested_key: "raw" } } }), expected: { [wireKey]: "Ada", untouched_key: { nested_key: "raw" } } },
    { name: "JSON", schema: { ...S.Json(), default: { untouched_key: { nested_key: "raw" } } }, expected: { untouched_key: { nested_key: "raw" } } },
    { name: "union", schema: { ...S.Union([S.Object({ count: S.Number() }), object]), default: { [canonicalKey]: "Ada" } }, expected: { [wireKey]: "Ada" } },
    { name: "discriminated union", schema: { ...S.OneOf({ discriminator: "delivery_kind", branches: { text: object } }), default: { delivery_kind: "text", [canonicalKey]: "Ada" } }, expected: { [casing === "camel" ? "deliveryKind" : "delivery_kind"]: "text", [wireKey]: "Ada" } },
    { name: "false", schema: S.Boolean({ default: false }), expected: false },
    { name: "zero", schema: S.Number({ default: 0 }), expected: 0 },
    { name: "empty string", schema: S.String({ default: "" }), expected: "" },
    { name: "null", schema: S.Object(object.shape, { nullable: true, default: null }), expected: null }
  ];

  describe.each([false, true])("stream=%s", (stream) => {
    it.each(cases)("advertises a usable $name default", async ({ schema, expected }) => {
      const original = structuredClone(schema.default);
      expect(validate(schema, original).ok).toBe(true);
      const received: unknown[] = [];
      const params = S.Object({ profile: S.Optional(schema) });
      const config = { name: "check", scope: ["mcp"] as const, params };
      const command = stream
        ? defineStreamCommand({ ...config, event: params, async *handler({ params: input }) { received.push(input.profile); yield input; } })
        : defineCommand({ ...config, result: params, handler: ({ params: input }) => { received.push(input.profile); return input; } });
      const notifications: Array<Record<string, unknown>> = [];
      let finish: () => void;
      let finished = new Promise<void>((resolve) => { finish = resolve; });
      const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", casing, errorReports: false })
        .createMessageSession((notification) => {
          if (notification.params === undefined) return;
          notifications.push(notification.params);
          if (notification.params.type === "end" || notification.params.type === "error") finish();
        });
      try {
        await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        await session.handleMessage("notifications/initialized");
        const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
        const definitions = listing.result as Record<string, Array<{ inputSchema: JsonSchema; outputSchema?: JsonSchema; eventSchema?: JsonSchema }>>;
        const definition = definitions[stream ? "streams" : "tools"]?.[0];
        if (definition === undefined) throw new Error("Expected command discovery");
        const output = stream ? definition.eventSchema : definition.outputSchema;
        for (const advertised of [definition.inputSchema, output]) {
          const profile = advertised?.properties?.profile;
          if (profile === undefined) throw new Error("Expected profile schema");
          expect(profile.default).toStrictEqual(expected);
          expect(compileJsonSchema(profile).validate(profile.default).ok).toBe(true);
        }
        for (const args of [{}, { profile: definition.inputSchema.properties?.profile?.default }]) {
          const response = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", { name: "audit__check", arguments: args });
          expect(response).not.toHaveProperty("error");
          if (stream) {
            expect(response.result?.eventSchema).toEqual(output);
            await finished;
            expect(notifications.filter((notification) => notification.type === "error")).toEqual([]);
            finished = new Promise<void>((resolve) => { finish = resolve; });
          } else {
            expect(response.result?.structuredContent).toStrictEqual({ profile: expected });
          }
        }
        expect(received).toStrictEqual([original, original]);
        expect(schema.default).toStrictEqual(original);
      } finally {
        session.close();
      }
    });
  });

  it.each(["object", "array", "record", "union", "oneOf", "optional"])("converts defaults nested beneath %s schemas", async (container) => {
    const profile = S.Object(object.shape, { default: { [canonicalKey]: "Ada" } });
    const nested = S.Object({ profile: S.Optional(profile) });
    const schemas: Record<string, AnySchema> = {
      object: nested,
      array: S.Array(nested),
      record: S.Record(nested),
      union: S.Union([S.Object({ text: nested }), S.Object({ count: S.Number() })]),
      oneOf: S.OneOf({ discriminator: "delivery_kind", branches: { text: nested } }),
      optional: S.Optional(nested)
    };
    const params = S.Object({ payload: schemas[container]! });
    const command = defineCommand({ name: "check", scope: ["mcp"], params, result: params, handler: ({ params: input }) => input });
    const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", casing, errorReports: false }).createMessageSession(() => {});
    try {
      await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      await session.handleMessage("notifications/initialized");
      const listing = await session.handleMessage("tools/list");
      const definition = (listing.result?.tools as Array<{ inputSchema: JsonSchema; outputSchema: JsonSchema }>)[0]!;
      const defaults: unknown[] = [];
      const inspect = (schema: JsonSchema): void => {
        if (schema.default !== undefined) {
          defaults.push(schema.default);
          expect(compileJsonSchema(schema).validate(schema.default).ok).toBe(true);
        }
        for (const child of Object.values(schema.properties ?? {})) inspect(child);
        for (const child of schema.oneOf ?? []) inspect(child);
        if (schema.items !== undefined) inspect(schema.items);
        if (typeof schema.additionalProperties === "object") inspect(schema.additionalProperties);
      };
      inspect(definition.inputSchema);
      inspect(definition.outputSchema);
      expect(defaults).toStrictEqual([{ [wireKey]: "Ada" }, { [wireKey]: "Ada" }]);
      expect(profile.default).toStrictEqual({ [canonicalKey]: "Ada" });
    } finally {
      session.close();
    }
  });

  it("does not turn metadata conversion into a scoped-default startup failure", async () => {
    const defaultValue = { [canonicalKey]: "Ada", hidden: "cli-only" };
    const profile = S.Object({ [canonicalKey]: S.String(), hidden: S.String({ scope: ["cli"] }) }, { default: defaultValue });
    const received: unknown[] = [];
    const command = defineCommand({ name: "check", scope: ["mcp"], params: S.Object({ profile: S.Optional(profile) }), handler: ({ params }) => { received.push(params.profile); return "ok"; } });
    const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", casing, errorReports: false }).createMessageSession(() => {});
    try {
      await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      await session.handleMessage("notifications/initialized");
      const listing = await session.handleMessage("tools/list");
      const definition = (listing.result?.tools as Array<{ inputSchema: JsonSchema }>)[0]!;
      const advertised = definition.inputSchema.properties?.profile;
      expect(advertised?.default).toEqual({ [wireKey]: "Ada" });
      for (const args of [{}, { profile: advertised?.default }]) {
        expect(await session.handleMessage("tools/call", { name: "audit__check", arguments: args })).not.toHaveProperty("error");
      }
      expect(received).toEqual([defaultValue, { [canonicalKey]: "Ada" }]);
      expect(profile.default).toBe(defaultValue);
      expect(defaultValue).toEqual({ [canonicalKey]: "Ada", hidden: "cli-only" });
    } finally {
      session.close();
    }
  });
});
