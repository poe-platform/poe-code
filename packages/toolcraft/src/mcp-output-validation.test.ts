import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, validate, type AnySchema, type JsonSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";

interface OutputCase {
  name: string;
  schema: AnySchema;
  value: unknown;
  expected?: unknown;
  invalid?: boolean;
  canonicalValid?: boolean;
}

describe.each(["snake", "camel"] as const)("MCP %s output contracts", (casing) => {
  const displayKey = casing === "camel" ? "displayName" : "display_name";
  const fileKey = casing === "camel" ? "filePath" : "file_path";
  const countKey = casing === "camel" ? "firstCount" : "first_count";
  const tagKey = casing === "camel" ? "deliveryKind" : "delivery_kind";
  const canonicalTag = casing === "camel" ? "delivery_kind" : "deliveryKind";
  const countBranch = S.Object({ first_count: S.Number({ minimum: 1, maximum: 3 }) }, { additionalProperties: true });
  const textBranch = S.Object({ display_name: S.String({ minLength: 3 }) }, { additionalProperties: true });
  const cases: OutputCase[] = [
    { name: "preserves string events", schema: S.String(), value: "ready", expected: "ready" },
    { name: "preserves numeric events", schema: S.Number(), value: 3, expected: 3 },
    { name: "preserves boolean events", schema: S.Boolean(), value: false, expected: false },
    { name: "preserves enum events", schema: S.Enum(["ready", "done"]), value: "ready", expected: "ready" },
    { name: "does not rename opaque JSON properties", schema: S.Json(), value: { untouched_key: "raw" }, expected: { untouched_key: "raw" } },
    { name: "preserves nullable containers", schema: S.Object({ display_name: S.String() }, { nullable: true }), value: null, expected: null },
    { name: "normalizes declared object keys", schema: S.Object({ displayName: S.String(), details: S.Object({ file_path: S.String() }) }), value: { displayName: "Ada", details: { file_path: "sample" } }, expected: { [displayKey]: "Ada", details: { [fileKey]: "sample" } } },
    { name: "normalizes array-item keys", schema: S.Array(S.Object({ display_name: S.String() })), value: [{ display_name: "Ada" }], expected: [{ [displayKey]: "Ada" }] },
    { name: "preserves record keys while normalizing values", schema: S.Record(S.Object({ file_path: S.String() })), value: { dynamic_key: { file_path: "sample" } }, expected: { dynamic_key: { [fileKey]: "sample" } } },
    { name: "preserves opaque additional properties", schema: S.Object({ display_name: S.String() }, { additionalProperties: true }), value: { display_name: "Ada", extra_field: { untouched_key: "raw" } }, expected: { [displayKey]: "Ada", extra_field: { untouched_key: "raw" } } },
    { name: "omits undefined optional object fields", schema: S.Object({ display_name: S.Optional(S.String()) }), value: { display_name: undefined }, expected: {} },
    { name: "applies a scalar optional default", schema: S.Object({ display_name: S.Optional(S.String({ default: "Ada" })) }), value: {}, expected: { [displayKey]: "Ada" } },
    { name: "normalizes an optional object default", schema: S.Object({ profile: S.Optional(S.Object({ display_name: S.String() }, { default: { display_name: "Ada" } })) }), value: {}, expected: { profile: { [displayKey]: "Ada" } } },
    { name: "normalizes an optional array default", schema: S.Object({ values: S.Optional(S.Array(S.Object({ file_path: S.String() }), { default: [{ file_path: "sample" }] })) }), value: {}, expected: { values: [{ [fileKey]: "sample" }] } },
    { name: "applies defaults for explicit optional undefined", schema: S.Object({ profile: S.Optional(S.Object({ display_name: S.String() }, { default: { display_name: "Ada" } })) }), value: { profile: undefined }, expected: { profile: { [displayKey]: "Ada" } } },
    { name: "normalizes optional array-item object defaults", schema: S.Array(S.Optional(S.Object({ display_name: S.String() }, { default: { display_name: "Ada" } }))), value: [undefined], expected: [{ [displayKey]: "Ada" }] },
    { name: "rejects optional array items that cannot match the wire schema", schema: S.Array(S.Optional(S.String())), value: [undefined], invalid: true, canonicalValid: true },
    { name: "normalizes discriminators and their branch fields", schema: S.OneOf({ discriminator: "delivery_kind", branches: { text: S.Object({ display_name: S.String() }) } }), value: { delivery_kind: "text", display_name: "Ada" }, expected: { [tagKey]: "text", [displayKey]: "Ada" } },
    { name: "keeps the validated discriminator authoritative over an extra wire alias", schema: S.OneOf({ discriminator: canonicalTag, branches: { text: S.Object({ display_name: S.String() }, { additionalProperties: true }) } }), value: { [canonicalTag]: "text", [tagKey]: "shadow", display_name: "Ada" }, expected: { [tagKey]: "text", [displayKey]: "Ada" } },
    { name: "accepts explicitly declared prototype-sensitive branch names", schema: S.OneOf({ discriminator: "kind", branches: { constructor: S.Object({ display_name: S.String() }) } }), value: { kind: "constructor", display_name: "Ada" }, expected: { kind: "constructor", [displayKey]: "Ada" } },
    ...[false, true].flatMap((reversed): OutputCase[] => {
      const schema = S.Union(reversed ? [textBranch, countBranch] : [countBranch, textBranch]);
      return [
        { name: `selects the valid text branch with reversed=${reversed}`, schema, value: { first_count: "bad", display_name: "valid" }, expected: { first_count: "bad", [displayKey]: "valid" } },
        { name: `selects the valid number branch with reversed=${reversed}`, schema, value: { first_count: 2, display_name: 12 }, expected: { [countKey]: 2, display_name: 12 } },
        { name: `uses branch constraints with reversed=${reversed}`, schema, value: { first_count: 9, display_name: "valid" }, expected: { first_count: 9, [displayKey]: "valid" } },
        { name: `rejects canonical ambiguity with reversed=${reversed}`, schema, value: { first_count: 2, display_name: "valid" }, invalid: true },
        { name: `rejects missing union fields with reversed=${reversed}`, schema, value: {}, invalid: true }
      ];
    }),
    { name: "ignores inherited discriminator names in a rejected union branch", schema: S.Union([S.Object({ variant: S.OneOf({ discriminator: "kind", branches: { text: S.Object({}) } }) }, { additionalProperties: true }), textBranch]), value: { variant: { kind: "toString" }, display_name: "valid" }, expected: { variant: { kind: "toString" }, [displayKey]: "valid" } },
    { name: "rejects invalid emitted scalar values", schema: S.String(), value: 12, invalid: true }
  ];

  describe.each([false, true])("stream=%s", (stream) => {
    it.each(cases)("$name", async (scenario) => {
      expect(validate(scenario.schema, scenario.value).ok).toBe(scenario.canonicalValid ?? (scenario.invalid !== true));
      const original = structuredClone(scenario.value);
      let calls = 0;
      const config = { name: "check", scope: ["mcp"] as const, params: S.Object({}) };
      const command = stream
        ? defineStreamCommand({ ...config, event: scenario.schema, async *handler() { calls += 1; yield scenario.value; } })
        : defineCommand({ ...config, result: S.Object({ payload: scenario.schema }), handler: () => { calls += 1; return { payload: scenario.value }; } });
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
        const discovered = definitions[stream ? "streams" : "tools"]?.[0];
        const schema = stream ? discovered?.eventSchema : discovered?.outputSchema;
        if (schema === undefined) throw new Error("Expected an advertised output schema");
        const response = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", { name: "audit__check", arguments: {} });
        if (stream) {
          expect(response).not.toHaveProperty("error");
          expect(response.result?.eventSchema).toEqual(schema);
          await finished;
          const data = notifications.filter((notification) => notification.type === "data");
          const errors = notifications.filter((notification) => notification.type === "error");
          if (scenario.invalid) {
            expect(data).toEqual([]);
            expect(errors).toHaveLength(1);
          } else {
            expect(errors).toEqual([]);
            expect(data).toHaveLength(1);
            expect(data[0]?.event).toStrictEqual(scenario.expected);
            expect(compileJsonSchema(schema).validate(data[0]?.event).ok).toBe(true);
          }
        } else if (scenario.invalid) {
          expect(response).toMatchObject({ error: { code: -32603 } });
        } else {
          expect(response).not.toHaveProperty("error");
          expect(response.result?.structuredContent).toStrictEqual({ payload: scenario.expected });
          expect(compileJsonSchema(schema).validate(response.result?.structuredContent).ok).toBe(true);
        }
        expect(calls).toBe(1);
        expect(scenario.value).toStrictEqual(original);
      } finally {
        session.close();
      }
    });
  });
});
