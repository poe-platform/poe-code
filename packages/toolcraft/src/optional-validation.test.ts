import { describe, expect, it } from "vitest";
import { S, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

interface OptionalCase {
  name: string;
  schema: ObjectSchema<any>;
  input: Record<string, unknown>;
  expected?: Record<string, unknown>;
  error?: string;
}

describe.each([
  { surface: "sdk", stream: false, casing: "camel" },
  { surface: "sdk", stream: true, casing: "camel" },
  { surface: "mcp", stream: false, casing: "snake" },
  { surface: "mcp", stream: true, casing: "snake" },
  { surface: "mcp", stream: false, casing: "camel" },
  { surface: "mcp", stream: true, casing: "camel" }
] as const)("$surface stream=$stream casing=$casing optional arguments", ({ surface, stream, casing }) => {
  const displayKey = casing === "camel" ? "displayName" : "display_name";
  const optional = (schema: AnySchema) => S.Object({ value: S.Optional(schema) });
  const scenarios: OptionalCase[] = [
    { name: "omits an absent optional field", schema: optional(S.String()), input: {}, expected: {} },
    { name: "omits an explicitly undefined optional field", schema: optional(S.String()), input: { value: undefined }, expected: {} },
    { name: "omits an explicitly undefined optional JSON field", schema: optional(S.Json()), input: { value: undefined }, expected: {} },
    { name: "preserves nullable null", schema: optional(S.String({ nullable: true })), input: { value: null }, expected: { value: null } },
    { name: "rejects non-nullable null", schema: optional(S.String()), input: { value: null }, error: "Expected a string" },
    { name: "rejects an invalid defined optional value", schema: optional(S.String()), input: { value: 12 }, error: "Expected a string" },
    { name: "applies an omitted default", schema: optional(S.String({ default: "seed" })), input: {}, expected: { value: "seed" } },
    { name: "applies an explicitly undefined default", schema: optional(S.String({ default: "seed" })), input: { value: undefined }, expected: { value: "seed" } },
    { name: "preserves an empty string default", schema: optional(S.String({ default: "" })), input: { value: undefined }, expected: { value: "" } },
    { name: "preserves a zero default", schema: optional(S.Number({ default: 0 })), input: { value: undefined }, expected: { value: 0 } },
    { name: "preserves a false default", schema: optional(S.Boolean({ default: false })), input: { value: undefined }, expected: { value: false } },
    { name: "preserves a null default", schema: optional({ ...S.Json(), default: null }), input: { value: undefined }, expected: { value: null } },
    { name: "applies an array default", schema: optional(S.Array(S.String(), { default: ["seed"] })), input: { value: undefined }, expected: { value: ["seed"] } },
    { name: "omits nested caller-cased optional fields", schema: S.Object({ payload: S.Object({ display_name: S.Optional(S.String()) }) }), input: { payload: { [displayKey]: undefined } }, expected: { payload: {} } },
    { name: "preserves explicitly undefined optional array items", schema: S.Object({ values: S.Array(S.Optional(S.String())) }), input: { values: [undefined, "valid"] }, expected: { values: [undefined, "valid"] } },
    { name: "applies optional array-item defaults", schema: S.Object({ values: S.Array(S.Optional(S.String({ default: "seed" }))) }), input: { values: [undefined] }, expected: { values: ["seed"] } },
    { name: "preserves canonical object defaults in optional array items", schema: S.Object({ values: S.Array(S.Optional(S.Object({ display_name: S.String() }, { default: { display_name: "seed" } }))) }), input: { values: [undefined] }, expected: { values: [{ display_name: "seed" }] } },
    { name: "rejects explicitly undefined required fields", schema: S.Object({ value: S.String() }), input: { value: undefined }, error: "Expected a string" },
    { name: "does not apply required defaults to explicitly undefined values", schema: S.Object({ value: S.String({ default: "seed" }) }), input: { value: undefined }, error: "Expected a string" },
    { name: "supports nested optional wrappers", schema: S.Object({ value: S.Optional(S.Optional(S.String({ default: "seed" }))) }), input: { value: undefined }, expected: { value: "seed" } },
    { name: "omits optional values inside discriminated branches", schema: S.Object({ payload: S.OneOf({ discriminator: "kind", branches: { text: S.Object({ value: S.Optional(S.String()) }) } }) }), input: { payload: { kind: "text", value: undefined } }, expected: { payload: { kind: "text" } } }
  ];

  it.each(scenarios)("$name", async (scenario) => {
    const originalInput = structuredClone(scenario.input);
    const received: unknown[] = [];
    const config = { name: "check", scope: ["sdk", "mcp"] as const, params: scenario.schema };
    const command = stream
      ? defineStreamCommand({ ...config, event: S.String(), async *handler({ params }) { received.push(params); yield "ok"; } })
      : defineCommand({ ...config, handler: ({ params }) => { received.push(params); return "ok"; } });
    const root = defineGroup({ name: "audit", children: [command] });

    if (surface === "sdk") {
      const operation = (async () => {
        const result = createSDK(root, { errorReports: false }).check(scenario.input);
        if (stream) {
          for await (const event of result as AsyncIterable<unknown>) expect(event).toBe("ok");
        } else {
          await result;
        }
      })();
      if (scenario.error !== undefined) {
        await expect(operation).rejects.toMatchObject({ name: "UserError", message: expect.stringContaining(scenario.error) });
      } else {
        await operation;
      }
    } else {
      let resolveData: () => void;
      const data = new Promise<void>((resolve) => { resolveData = resolve; });
      const session = createMCPServer(root, { name: "audit", version: "1", casing, errorReports: false })
        .createMessageSession((notification) => { if (notification.params?.type === "data") resolveData(); });
      try {
        await session.handleMessage("initialize", {
          protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
        });
        await session.handleMessage("notifications/initialized");
        const result = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", {
          name: "audit__check", arguments: scenario.input
        });
        if (scenario.error !== undefined) {
          expect(result).toMatchObject({ error: { code: -32602, message: expect.stringContaining(scenario.error) } });
        } else {
          expect(result).not.toHaveProperty("error");
          if (stream) await data;
        }
      } finally {
        session.close();
      }
    }

    expect(received).toStrictEqual(scenario.error === undefined ? [scenario.expected] : []);
    expect(scenario.input).toStrictEqual(originalInput);
  });
});
