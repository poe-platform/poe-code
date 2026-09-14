import { describe, expect, it } from "vitest";
import { compileJsonSchema, type JsonSchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand, S } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

type Surface = "sdk" | "mcp-snake" | "mcp-camel";
type Input = Record<string, unknown>;

const scenarios = [
  "invalid alias", "valid alias", "invalid caller", "valid caller", "both names", "absent",
  "required alias", "default alias", "unrelated extra", "closed alias", "nullable caller"
] as const;

const placements: Array<{
  name: string;
  schema: (schema: ObjectSchema<any>) => ObjectSchema<any>;
  value: (value: Input) => Input;
}> = [
  { name: "root", schema: (schema) => schema, value: (value) => value },
  { name: "object", schema: (schema) => S.Object({ payload: S.Optional(schema) }), value: (value) => ({ payload: value }) },
  { name: "array", schema: (schema) => S.Object({ payload: S.Array(schema) }), value: (value) => ({ payload: [value] }) },
  { name: "record", schema: (schema) => S.Object({ payload: S.Record(schema) }), value: (value) => ({ payload: { "literal-key": value } }) },
  { name: "oneOf", schema: (schema) => S.Object({ payload: S.OneOf({ discriminator: "kind", branches: { value: schema } }) }), value: (value) => ({ payload: { ...value, kind: "value" } }) },
  { name: "union", schema: (schema) => S.Object({ payload: S.Union([schema]) }), value: (value) => ({ payload: value }) }
];

async function invoke(surface: Surface, schema: ObjectSchema<any>, input: Input, stream = false) {
  const calls: unknown[] = [];
  const config = { name: "check", scope: ["sdk", "mcp"] as const, params: schema };
  const command = stream
    ? defineStreamCommand({ ...config, event: S.String(), async *handler({ params }) { calls.push(params); yield "ready"; } })
    : defineCommand({ ...config, handler: ({ params }) => { calls.push(params); return "ready"; } });
  const root = defineGroup({ name: "fixture", children: [command] });
  let error: string | undefined;
  let inputSchema: JsonSchema | undefined;
  if (surface === "sdk") {
    const sdk = createSDK(root, { approvals: false, errorReports: false }) as {
      check(input: Input): Promise<unknown> | AsyncIterable<unknown>;
    };
    try {
      if (stream) {
        const events: unknown[] = [];
        for await (const event of sdk.check(input) as AsyncIterable<unknown>) events.push(event);
        expect(events).toEqual(["ready"]);
      } else {
        expect(await sdk.check(input)).toBe("ready");
      }
    } catch (caught) {
      error = (caught as Error).message;
    }
  } else {
    let resolveData!: (event: unknown) => void;
    const data = new Promise<unknown>((resolve) => { resolveData = resolve; });
    const session = createMCPServer(root, {
      name: "fixture", version: "1", casing: surface === "mcp-snake" ? "snake" : "camel", errorReports: false
    }).createMessageSession((notification) => {
      if (notification.params?.type === "data") resolveData(notification.params.event);
    });
    try {
      await session.handleMessage("initialize", {
        protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
      });
      await session.handleMessage("notifications/initialized");
      const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
      const definitions = listing.result as Record<string, Array<{ inputSchema: JsonSchema }>>;
      inputSchema = definitions[stream ? "streams" : "tools"]![0]!.inputSchema;
      const result = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", {
        name: "fixture__check", arguments: input
      });
      error = result.error?.message;
      if (result.error === undefined) {
        expect(result.result).not.toHaveProperty("isError", true);
        if (stream) await expect(data).resolves.toBe("ready");
      }
    } finally {
      await session.close();
    }
  }
  return { calls, error, inputSchema };
}

describe.each(["sdk", "mcp-snake", "mcp-camel"] as const)("%s additional canonical aliases", (surface) => {
  const callerKey = surface === "mcp-snake" ? "user_id" : "userId";

  describe.each([false, true])("stream=%s", (stream) => {
    describe.each(placements)("$name placement", (placement) => {
      it.each(scenarios)("handles %s without unchecked declared values", async (scenario) => {
        const field = S.String({
          ...(scenario === "default alias" ? { default: "seed" } : {}),
          ...(scenario === "nullable caller" ? { nullable: true } : {})
        });
        const schema = placement.schema(S.Object({
          "user-id": scenario === "required alias" ? field : S.Optional(field)
        }, { additionalProperties: scenario !== "closed alias" }));
        const supplied = scenario === "invalid caller" ? { [callerKey]: 42 }
          : scenario === "valid caller" ? { [callerKey]: "one" }
          : scenario === "both names" ? { "user-id": 42, [callerKey]: "one" }
          : scenario === "absent" ? {}
          : scenario === "unrelated extra" ? { extra: 42 }
          : scenario === "valid alias" ? { "user-id": "one" }
          : scenario === "nullable caller" ? { [callerKey]: null, "user-id": 42 }
          : { "user-id": 42 };
        const input = placement.value(supplied);
        const original = structuredClone(input);
        const rejected = ["invalid alias", "valid alias", "invalid caller", "required alias", "closed alias"].includes(scenario);
        const result = await invoke(surface, schema, input, stream);

        expect(result.calls).toHaveLength(rejected ? 0 : 1);
        expect(result.error !== undefined).toBe(rejected);
        if (scenario === "invalid alias" || scenario === "valid alias") {
          expect(result.error).toContain("user-id");
          expect(result.error).toContain(callerKey);
          expect(result.error).toContain("Use");
        }
        if (!rejected) {
          const expected = scenario === "default alias" ? { "user-id": "seed" }
            : scenario === "absent" ? {}
            : scenario === "unrelated extra" ? { extra: 42 }
            : scenario === "nullable caller" ? { "user-id": null }
            : { "user-id": "one" };
          expect(result.calls).toEqual([placement.value(expected)]);
        }
        if (result.inputSchema !== undefined) {
          expect(compileJsonSchema(result.inputSchema).validate(input).ok).toBe(!rejected);
        }
        expect(input).toEqual(original);
      });
    });
  });

  it("requires each conflicting alias to have its own explicit caller field", async () => {
    const secondKey = surface === "mcp-snake" ? "other_id" : "otherId";
    const schema = S.Object({ "user-id": S.Optional(S.String()), "other-id": S.Optional(S.String()) }, { additionalProperties: true });
    for (const input of [
      { "user-id": 42, "other-id": 43 },
      { "user-id": 42, "other-id": 43, [callerKey]: "one" },
      { "user-id": 42, "other-id": 43, [secondKey]: "two" }
    ]) {
      const result = await invoke(surface, schema, input);
      expect(result.calls).toEqual([]);
      expect(result.error).toBeDefined();
      if (result.inputSchema !== undefined) expect(compileJsonSchema(result.inputSchema).validate(input).ok).toBe(false);
    }
    const input = { "user-id": 42, "other-id": 43, [callerKey]: "one", [secondKey]: "two" };
    const result = await invoke(surface, schema, input);
    expect(result.error).toBeUndefined();
    expect(result.calls).toEqual([{ "user-id": "one", "other-id": "two" }]);
    if (result.inputSchema !== undefined) expect(compileJsonSchema(result.inputSchema).validate(input).ok).toBe(true);
  });

  it("allows a valid alternate union branch to own an otherwise conflicting extra", async () => {
    const schema = S.Object({ payload: S.Union([
      S.Object({ "user-id": S.Optional(S.String()) }, { additionalProperties: true }),
      S.Object({ kind: S.Enum(["other"]) }, { additionalProperties: true })
    ]) });
    const input = { payload: { kind: "other", "user-id": 42 } };
    const result = await invoke(surface, schema, input);
    expect(result.error).toBeUndefined();
    expect(result.calls).toEqual([input]);
    if (result.inputSchema !== undefined) expect(compileJsonSchema(result.inputSchema).validate(input).ok).toBe(true);
  });

  it.each(["record", "JSON", "hidden", "same name"] as const)("preserves %s fields and literal keys", async (kind) => {
    const schema = kind === "record" ? S.Object({ payload: S.Record(S.Number()) })
      : kind === "JSON" ? S.Object({ payload: S.Json() })
      : kind === "hidden" ? S.Object({ "user-id": S.Optional(S.String({ scope: ["cli"] })) }, { additionalProperties: true })
      : S.Object({ user: S.Optional(S.String()) }, { additionalProperties: true });
    const input = kind === "record" || kind === "JSON" ? { payload: { "user-id": 42 } }
      : kind === "hidden" ? { "user-id": 42 } : { user: "one", extra: 42 };
    const result = await invoke(surface, schema, input);
    expect(result.error).toBeUndefined();
    expect(result.calls).toEqual([input]);
    if (result.inputSchema !== undefined) expect(compileJsonSchema(result.inputSchema).validate(input).ok).toBe(true);
  });

  it.each([
    { canonical: "user_id", camel: "userId", snake: "user_id" },
    { canonical: "userId", camel: "userId", snake: "user_id" },
    { canonical: "UserID", camel: "userId", snake: "user_id" },
    { canonical: "user id", camel: "userId", snake: "user_id" },
    { canonical: "user.id", camel: "userId", snake: "user_id" },
    { canonical: "HTTP_URL", camel: "httpUrl", snake: "http_url" },
    { canonical: "mój-id", camel: "mójId", snake: "mój_id" },
    { canonical: "用户-id", camel: "用户Id", snake: "用户_id" },
    { canonical: "a__b", camel: "aB", snake: "a_b" }
  ])("distinguishes actual caller names from canonical $canonical aliases", async ({ canonical, camel, snake }) => {
    const caller = surface === "mcp-snake" ? snake : camel;
    const schema = S.Object({ [canonical]: S.Optional(S.String()) }, { additionalProperties: true });
    const alias = { [canonical]: "one" };
    const result = await invoke(surface, schema, alias);
    expect(result.error !== undefined).toBe(caller !== canonical);
    expect(result.calls).toEqual(caller === canonical ? [alias] : []);
    if (result.inputSchema !== undefined) expect(compileJsonSchema(result.inputSchema).validate(alias).ok).toBe(caller === canonical);
    const supplied = { [caller]: "one" };
    const control = await invoke(surface, schema, supplied);
    expect(control.error).toBeUndefined();
    expect(control.calls).toEqual([{ [canonical]: "one" }]);
    if (control.inputSchema !== undefined) expect(compileJsonSchema(control.inputSchema).validate(supplied).ok).toBe(true);
  });

  describe.each([false, true])("default controls, stream=%s", (stream) => {
    it.each([
      { name: "empty string", create: () => S.String({ default: "" }) },
      { name: "zero", create: () => S.Number({ default: 0 }) },
      { name: "false", create: () => S.Boolean({ default: false }) },
      { name: "null", create: () => S.Object({}, { nullable: true, default: null }) },
      { name: "empty array", create: () => S.Array(S.String(), { default: [] }) },
      { name: "empty record", create: () => ({ ...S.Record(S.String()), default: {} }) },
      { name: "JSON", create: () => ({ ...S.Json(), default: { nested: ["seed"] } }) }
    ])("keeps the $name default authoritative", async ({ create }) => {
      const field = create();
      const schema = S.Object({ "user-id": S.Optional(field) }, { additionalProperties: true });
      const input = { "user-id": "ignored extra" };
      const result = await invoke(surface, schema, input, stream);
      expect(result.error).toBeUndefined();
      expect(result.calls).toEqual([{ "user-id": field.default }]);
      if (result.inputSchema !== undefined) expect(compileJsonSchema(result.inputSchema).validate(input).ok).toBe(true);
    });
  });
});

describe("SDK explicit undefined and canonical extras", () => {
  it.each([false, true])("does not count an undefined caller value as supplied, default=%s", async (defaulted) => {
    const field = S.String(defaulted ? { default: "seed" } : {});
    const schema = S.Object({ "user-id": S.Optional(field) }, { additionalProperties: true });
    const result = await invoke("sdk", schema, { "user-id": 42, userId: undefined });
    expect(result.calls).toEqual(defaulted ? [{ "user-id": "seed" }] : []);
    expect(result.error !== undefined).toBe(!defaulted);
  });
});

describe.each(["snake", "camel"] as const)("MCP %s result metadata", (casing) => {
  it.each([false, true])("does not add input-only alias conditions to result/event schemas, stream=%s", async (stream) => {
    const resultSchema = S.Object({ "user-id": S.Optional(S.String()) }, { additionalProperties: true });
    const config = { name: "check", scope: ["mcp"] as const, params: S.Object({}) };
    const command = stream
      ? defineStreamCommand({ ...config, event: resultSchema, async *handler() { yield { "user-id": "one" }; } })
      : defineCommand({ ...config, result: resultSchema, handler: () => ({ "user-id": "one" }) });
    const session = createMCPServer(defineGroup({ name: "fixture", children: [command] }), {
      name: "fixture", version: "1", casing, errorReports: false
    }).createMessageSession(() => {});
    try {
      await session.handleMessage("initialize", {
        protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
      });
      await session.handleMessage("notifications/initialized");
      const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
      const definitions = listing.result as Record<string, Array<{ eventSchema?: JsonSchema; outputSchema?: JsonSchema }>>;
      const definition = definitions[stream ? "streams" : "tools"]![0]!;
      const schema = stream ? definition.eventSchema : definition.outputSchema;
      const key = casing === "snake" ? "user_id" : "userId";
      expect(schema).toEqual({ type: "object", properties: { [key]: { type: "string" } }, required: [], additionalProperties: true });
    } finally {
      await session.close();
    }
  });
});
