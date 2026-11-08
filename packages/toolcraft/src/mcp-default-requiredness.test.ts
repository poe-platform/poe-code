import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, toJsonSchema, type AnySchema, type JsonSchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";

type Value = Record<string, unknown>;
type Casing = "snake" | "camel";

const placements: Array<{
  name: string;
  schema: (schema: ObjectSchema<any>) => ObjectSchema<any>;
  value: (value: Value) => Value;
}> = [
  { name: "root", schema: (schema) => schema, value: (value) => value },
  { name: "object", schema: (schema) => S.Object({ payload: schema }), value: (value) => ({ payload: value }) },
  { name: "array", schema: (schema) => S.Object({ payload: S.Array(schema) }), value: (value) => ({ payload: [value] }) },
  { name: "record", schema: (schema) => S.Object({ payload: S.Record(schema) }), value: (value) => ({ payload: { "literal-key": value } }) },
  { name: "oneOf", schema: (schema) => S.Object({ payload: S.OneOf({ discriminator: "kind", branches: { text: schema } }) }), value: (value) => ({ payload: { ...value, kind: "text" } }) },
  { name: "union", schema: (schema) => S.Object({ payload: S.Union([schema, S.Object({ other: S.Boolean() })]) }), value: (value) => ({ payload: value }) }
];

async function invoke(casing: Casing, stream: boolean, params: ObjectSchema<any>, args: Value) {
  const received: unknown[] = [];
  const notifications: Array<Record<string, unknown>> = [];
  const config = { name: "check", scope: ["mcp"] as const, params };
  const command = stream
    ? defineStreamCommand({ ...config, event: params, async *handler({ params: input }) { received.push(input); yield input; } })
    : defineCommand({ ...config, result: params, handler: ({ params: input }) => { received.push(input); return input; } });
  let finish: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
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
    const definitions = listing.result as Record<string, Array<{ inputSchema: JsonSchema; outputSchema?: JsonSchema; eventSchema?: JsonSchema; description: string }>>;
    const definition = definitions[stream ? "streams" : "tools"]![0]!;
    const response = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", { name: "audit__check", arguments: args });
    if (stream && response.error === undefined) await finished;
    return { definition, response, received, notifications };
  } finally {
    session.close();
  }
}

describe.each(["snake", "camel"] as const)("MCP %s default requiredness", (casing) => {
  const wireKey = casing === "snake" ? "display_name" : "displayName";
  const fileKey = casing === "snake" ? "file_path" : "filePath";
  const cases: Array<{ name: string; child: AnySchema; expected: Value; provided?: unknown; invalid?: boolean }> = [
    { name: "required string default", child: S.String({ default: "known" }), expected: { "display-name": "known" } },
    { name: "required zero default", child: S.Number({ default: 0 }), expected: { "display-name": 0 } },
    { name: "required false default", child: S.Boolean({ default: false }), expected: { "display-name": false } },
    { name: "required empty default", child: S.String({ default: "" }), expected: { "display-name": "" } },
    { name: "required null default", child: S.String({ nullable: true, default: null }), expected: { "display-name": null } },
    { name: "required object default", child: S.Object({ "file-path": S.String() }, { default: { "file-path": "known" } }), expected: { "display-name": { "file-path": "known" } } },
    { name: "required array default", child: S.Array(S.String(), { default: ["known"] }), expected: { "display-name": ["known"] } },
    { name: "required record default", child: { ...S.Record(S.String()), default: { "literal-key": "known" } }, expected: { "display-name": { "literal-key": "known" } } },
    { name: "required JSON default", child: { ...S.Json(), default: { "literal-key": "known" } }, expected: { "display-name": { "literal-key": "known" } } },
    { name: "required enum default", child: S.Enum(["known", "other"], { default: "known" }), expected: { "display-name": "known" } },
    { name: "optional default control", child: S.Optional(S.String({ default: "known" })), expected: { "display-name": "known" } },
    { name: "requiredScopes default", child: S.Optional(S.String({ requiredScopes: ["mcp"], default: "known" })), expected: { "display-name": "known" } },
    { name: "required without default", child: S.String(), expected: {}, invalid: true },
    { name: "requiredScopes without default", child: S.Optional(S.String({ requiredScopes: ["mcp"] })), expected: {}, invalid: true },
    { name: "other requiredScopes control", child: S.Optional(S.String({ requiredScopes: ["sdk"] })), expected: {} },
    { name: "provided value overrides default", child: S.String({ default: "known" }), provided: "provided", expected: { "display-name": "provided" } },
    { name: "provided invalid value does not use default", child: S.String({ default: "known" }), provided: 42, expected: {}, invalid: true },
    { name: "partial supplied object does not deep merge default", child: S.Object({ "file-path": S.String() }, { default: { "file-path": "known" } }), provided: {}, expected: {}, invalid: true },
    { name: "complete supplied object overrides default", child: S.Object({ "file-path": S.String() }, { default: { "file-path": "known" } }), provided: { [fileKey]: "provided" }, expected: { "display-name": { "file-path": "provided" } } }
  ];

  describe.each([false, true])("stream=%s", (stream) => {
    describe.each(placements)("$name", (placement) => {
      it.each(cases)("$name", async (scenario) => {
        const params = placement.schema(S.Object({ "display-name": scenario.child }));
        const args = placement.value("provided" in scenario ? { [wireKey]: scenario.provided } : {});
        const original = structuredClone(args);
        const result = await invoke(casing, stream, params, args);
        expect(result.response.error === undefined).toBe(!scenario.invalid);
        expect(result.received).toStrictEqual(scenario.invalid ? [] : [placement.value(scenario.expected)]);
        expect(args).toStrictEqual(original);
        expect(compileJsonSchema(result.definition.inputSchema).validate(args).ok).toBe(!scenario.invalid);
        if (!scenario.invalid && stream) {
          expect(result.notifications.filter((notification) => notification.type === "error")).toEqual([]);
          expect(result.notifications.filter((notification) => notification.type === "data")).toHaveLength(1);
        }
      });
    });

    it("does not advertise defaulted parameters as required in descriptions", async () => {
      const params = S.Object({ "display-name": S.String({ default: "known" }), "actual-required": S.String() });
      const requiredKey = casing === "snake" ? "actual_required" : "actualRequired";
      const result = await invoke(casing, stream, params, { [requiredKey]: "supplied" });
      expect(result.definition.description).toContain(`${requiredKey} (required)`);
      expect(result.definition.description).toContain(wireKey);
      expect(result.definition.description).not.toContain(`${wireKey} (required)`);
    });

    it("does not advertise defaulted parent children as unconditionally required", async () => {
      const params = S.Object({ profile: S.Object({ "display-name": S.String() }, { default: { "display-name": "known" } }) });
      const result = await invoke(casing, stream, params, {});
      expect(result.received).toStrictEqual([{ profile: { "display-name": "known" } }]);
      expect(result.definition.description).toContain(`profile.${wireKey}`);
      expect(result.definition.description).not.toContain("(required)");
      expect(compileJsonSchema(result.definition.inputSchema).validate({ profile: {} }).ok).toBe(false);
    });

    it("keeps result and shared-schema requiredness unchanged", async () => {
      const params = S.Object({ "display-name": S.String({ default: "known" }) });
      const result = await invoke(casing, stream, params, {});
      const output = stream ? result.definition.eventSchema : result.definition.outputSchema;
      expect(output?.required).toEqual([wireKey]);
      expect(toJsonSchema(params).required).toEqual(["display-name"]);
      expect(compileJsonSchema(output!).validate({}).ok).toBe(false);
      expect(result.definition.inputSchema.required).toEqual([]);
    });

    it("preserves required injected discriminators", async () => {
      const params = S.Object({ payload: S.OneOf({ discriminator: "delivery-kind", branches: { text: S.Object({ "display-name": S.String({ default: "known" }) }) } }) });
      const result = await invoke(casing, stream, params, { payload: {} });
      const discriminator = casing === "snake" ? "delivery_kind" : "deliveryKind";
      expect(result.response).toHaveProperty("error");
      expect(result.received).toEqual([]);
      expect(result.definition.inputSchema.properties?.payload?.oneOf?.[0]?.required).toEqual([discriminator]);
      expect(compileJsonSchema(result.definition.inputSchema).validate({ payload: {} }).ok).toBe(false);
    });

    it("rejects default-induced union ambiguity", async () => {
      const params = S.Object({ payload: S.Union([S.Object({ text: S.String({ default: "known" }) }), S.Object({ count: S.Number({ default: 0 }) })]) });
      const result = await invoke(casing, stream, params, { payload: {} });
      expect(result.response).toHaveProperty("error");
      expect(result.received).toEqual([]);
      expect(result.definition.inputSchema.properties?.payload?.oneOf?.map((branch) => branch.required)).toEqual([[], []]);
      expect(compileJsonSchema(result.definition.inputSchema).validate({ payload: {} }).ok).toBe(false);
    });
  });
});
