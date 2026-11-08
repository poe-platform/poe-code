import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, validate, type AnySchema, type JsonSchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

type Value = Record<string, unknown>;
type Casing = "snake" | "camel";
type Scenario = { name: string; schema: ObjectSchema<any>; value: Value; expected?: Value; invalid?: boolean };

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

async function observe(casing: Casing, stream: boolean, schema: ObjectSchema<any>, value: Value) {
  let calls = 0;
  const config = { name: "check", scope: ["mcp"] as const, params: S.Object({}) };
  const command = stream
    ? defineStreamCommand({ ...config, event: schema, async *handler() { calls += 1; yield value; } })
    : defineCommand({ ...config, result: schema, handler: () => { calls += 1; return value; } });
  const notifications: Array<Record<string, unknown>> = [];
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
    const definitions = listing.result as Record<string, Array<{ eventSchema?: JsonSchema; outputSchema?: JsonSchema }>>;
    const definition = definitions[stream ? "streams" : "tools"]?.[0];
    const wireSchema = stream ? definition?.eventSchema : definition?.outputSchema;
    if (wireSchema === undefined) throw new Error("Expected an advertised output schema");
    const response = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", { name: "audit__check", arguments: {} });
    if (stream) {
      expect(response).not.toHaveProperty("error");
      await finished;
    }
    return {
      calls,
      wireSchema,
      values: stream ? notifications.filter((notification) => notification.type === "data").map((notification) => notification.event) : response.error === undefined ? [response.result?.structuredContent] : [],
      errors: stream ? notifications.filter((notification) => notification.type === "error") : response.error === undefined ? [] : [response.error]
    };
  } finally {
    session.close();
  }
}

describe.each(["snake", "camel"] as const)("MCP %s additional result ownership", (casing) => {
  const wireKey = casing === "snake" ? "display_name" : "displayName";
  const object = (child: AnySchema) => S.Object({ "display-name": child }, { additionalProperties: true });
  const scenarios: Scenario[] = [
    { name: "declared value wins over same-type extra", schema: object(S.String()), value: { "display-name": "known", [wireKey]: "extra" }, expected: { [wireKey]: "known" } },
    { name: "declared value wins over differently typed extra", schema: object(S.String()), value: { "display-name": "known", [wireKey]: 42 }, expected: { [wireKey]: "known" } },
    { name: "optional value wins", schema: object(S.Optional(S.String())), value: { "display-name": "known", [wireKey]: "extra" }, expected: { [wireKey]: "known" } },
    { name: "optional absence reserves its wire name", schema: object(S.Optional(S.String())), value: { [wireKey]: "extra" }, expected: {} },
    { name: "optional absence ignores differently typed alias", schema: object(S.Optional(S.String())), value: { [wireKey]: 42 }, expected: {} },
    { name: "optional undefined reserves its wire name", schema: object(S.Optional(S.String())), value: { "display-name": undefined, [wireKey]: "extra" }, expected: {} },
    { name: "default wins", schema: object(S.Optional(S.String({ default: "known" }))), value: { [wireKey]: "extra" }, expected: { [wireKey]: "known" } },
    { name: "explicit undefined uses default", schema: object(S.Optional(S.String({ default: "known" }))), value: { "display-name": undefined, [wireKey]: 42 }, expected: { [wireKey]: "known" } },
    { name: "nullable value wins", schema: object(S.Optional(S.String({ nullable: true }))), value: { "display-name": null, [wireKey]: "extra" }, expected: { [wireKey]: null } },
    { name: "unrelated extra is opaque", schema: object(S.String()), value: { "display-name": "known", untouched_key: { "display-name": "literal", [wireKey]: "extra" } }, expected: { [wireKey]: "known", untouched_key: { "display-name": "literal", [wireKey]: "extra" } } },
    { name: "ordinary value is unchanged", schema: object(S.String()), value: { "display-name": "known" }, expected: { [wireKey]: "known" } },
    { name: "absent optional remains absent", schema: object(S.Optional(S.String())), value: {}, expected: {} },
    { name: "alias cannot repair invalid canonical value", schema: object(S.String()), value: { "display-name": 42, [wireKey]: "extra" }, invalid: true },
    { name: "alias cannot supply required canonical value", schema: object(S.String()), value: { [wireKey]: "extra" }, invalid: true },
    { name: "closed objects still reject extras", schema: S.Object({ "display-name": S.String() }), value: { "display-name": "known", [wireKey]: "extra" }, invalid: true }
  ];

  describe.each([false, true])("stream=%s", (stream) => {
    describe.each(placements)("$name", (placement) => {
      it.each(scenarios)("$name", async (scenario) => {
        const schema = placement.schema(scenario.schema);
        const value = placement.value(scenario.value);
        const original = structuredClone(value);
        expect(validate(schema, value).ok).toBe(scenario.invalid !== true);
        const result = await observe(casing, stream, schema, value);
        expect(result.calls).toBe(1);
        expect(value).toStrictEqual(original);
        if (scenario.invalid) {
          expect(result.values).toEqual([]);
          expect(result.errors).toHaveLength(1);
        } else {
          expect(result.errors).toEqual([]);
          expect(result.values).toStrictEqual([placement.value(scenario.expected!)]);
          expect(compileJsonSchema(result.wireSchema).validate(result.values[0]).ok).toBe(true);
        }
      });
    });

    it.each(["record", "JSON"])("preserves literal names in %s", async (kind) => {
      const value = { "display-name": "known", [wireKey]: "extra" };
      const schema = S.Object({ payload: kind === "record" ? S.Record(S.String()) : S.Json() });
      const result = await observe(casing, stream, schema, { payload: value });
      expect(result.errors).toEqual([]);
      expect(result.values).toStrictEqual([{ payload: value }]);
    });

    it("does not reserve keys from an unselected union branch", async () => {
      const schema = S.Object({ payload: S.Union([object(S.String()), S.Object({ count: S.Number() }, { additionalProperties: true })]) });
      const value = { payload: { count: 2, [wireKey]: 42 } };
      const result = await observe(casing, stream, schema, value);
      expect(result.errors).toEqual([]);
      expect(result.values).toStrictEqual([value]);
    });

    it.each([
      { name: "false", child: S.Boolean({ default: false }), expected: false },
      { name: "zero", child: S.Number({ default: 0 }), expected: 0 },
      { name: "empty string", child: S.String({ default: "" }), expected: "" },
      { name: "null", child: S.String({ nullable: true, default: null }), expected: null },
      { name: "object", child: S.Object({ "file-path": S.String() }, { default: { "file-path": "known" } }), expected: { [casing === "snake" ? "file_path" : "filePath"]: "known" } },
      { name: "array", child: S.Array(S.String(), { default: ["known"] }), expected: ["known"] },
      { name: "record", child: { ...S.Record(S.String()), default: { "literal-key": "known" } }, expected: { "literal-key": "known" } }
    ])("keeps the $name default authoritative", async ({ child, expected }) => {
      const result = await observe(casing, stream, object(S.Optional(child)), { [wireKey]: "extra" });
      expect(result.errors).toEqual([]);
      expect(result.values).toStrictEqual([{ [wireKey]: expected }]);
      expect(compileJsonSchema(result.wireSchema).validate(result.values[0]).ok).toBe(true);
    });

    it.each(["known", "optional", "default"])("keeps %s ownership in default metadata", async (kind) => {
      const child = kind === "known" ? S.String() : kind === "optional" ? S.Optional(S.String()) : S.Optional(S.String({ default: "known" }));
      const value = kind === "known" ? { "display-name": "known", [wireKey]: "extra" } : { [wireKey]: "extra" };
      const expected = kind === "optional" ? {} : { [wireKey]: "known" };
      const profile = { ...object(child), default: value };
      const params = S.Object({ profile: S.Optional(profile) });
      const config = { name: "check", scope: ["mcp"] as const, params };
      const command = stream
        ? defineStreamCommand({ ...config, event: params, async *handler({ params: input }) { yield input; } })
        : defineCommand({ ...config, result: params, handler: ({ params: input }) => input });
      const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", casing, errorReports: false }).createMessageSession(() => {});
      try {
        await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        await session.handleMessage("notifications/initialized");
        const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
        const definitions = listing.result as Record<string, Array<{ inputSchema: JsonSchema; outputSchema?: JsonSchema; eventSchema?: JsonSchema }>>;
        const definition = definitions[stream ? "streams" : "tools"]![0]!;
        for (const schema of [definition.inputSchema, stream ? definition.eventSchema : definition.outputSchema]) {
          const advertised = schema?.properties?.profile;
          expect(advertised?.default).toStrictEqual(expected);
          expect(compileJsonSchema(advertised!).validate(advertised?.default).ok).toBe(true);
        }
        expect(profile.default).toStrictEqual(value);
      } finally {
        session.close();
      }
    });
  });

  it.each([false, true])("does not project SDK results, stream=%s", async (stream) => {
    const value = { "display-name": "known", [wireKey]: 42 };
    const schema = object(S.String());
    const config = { name: "check", scope: ["sdk"] as const, params: S.Object({}) };
    const command = stream
      ? defineStreamCommand({ ...config, event: schema, async *handler() { yield value; } })
      : defineCommand({ ...config, result: schema, handler: () => value });
    const sdk = createSDK(defineGroup({ name: "audit", children: [command] }), { approvals: false, errorReports: false }) as { check(): Promise<unknown> | AsyncIterable<unknown> };
    if (stream) {
      const values: unknown[] = [];
      for await (const event of sdk.check() as AsyncIterable<unknown>) values.push(event);
      expect(values).toStrictEqual([value]);
    } else {
      expect(await sdk.check()).toStrictEqual(value);
    }
  });
});
