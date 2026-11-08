import { describe, expect, it } from "vitest";
import { S, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

interface DefaultCase {
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
] as const)("$surface stream=$stream casing=$casing applied defaults", ({ surface, stream, casing }) => {
  const invalid: Array<{ name: string; schema: AnySchema; value: unknown }> = [
    { name: "numeric maximum", schema: S.Number({ maximum: 10 }), value: 20 },
    { name: "numeric minimum", schema: S.Number({ minimum: 1 }), value: 0 },
    { name: "integer constraint", schema: S.Number({ jsonType: "integer" }), value: 1.5 },
    { name: "number type", schema: S.Number(), value: "two" },
    { name: "Unicode minimum", schema: S.String({ minLength: 2 }), value: "😀" },
    { name: "Unicode maximum", schema: S.String({ maxLength: 1 }), value: "😀😀" },
    { name: "string pattern", schema: S.String({ pattern: "^ready$" }), value: "other" },
    { name: "string type", schema: S.String(), value: 42 },
    { name: "boolean type", schema: S.Boolean(), value: "false" },
    { name: "enum membership", schema: S.Enum(["first", "second"]), value: "third" },
    { name: "array minimum", schema: S.Array(S.String(), { minItems: 1 }), value: [] },
    { name: "array item", schema: S.Array(S.String()), value: [42] },
    { name: "object required member", schema: S.Object({ display_name: S.String() }), value: {} },
    { name: "object member constraint", schema: S.Object({ max_count: S.Number({ maximum: 10 }) }), value: { max_count: 20 } },
    { name: "object extra member", schema: S.Object({ display_name: S.String() }), value: { display_name: "ready", extra: true } },
    { name: "record value", schema: S.Record(S.Number()), value: { entry: "two" } },
    { name: "discriminator", schema: S.OneOf({ discriminator: "delivery_kind", branches: { email: S.Object({ address: S.String() }) } }), value: { delivery_kind: "other", address: "ready" } },
    { name: "no union match", schema: S.Union([S.Object({ left: S.String() }), S.Object({ right: S.String() })]), value: {} },
    { name: "multiple union matches", schema: S.Union([S.Object({ left: S.String() }, { additionalProperties: true }), S.Object({ right: S.String() }, { additionalProperties: true })]), value: { left: "one", right: "two" } },
    { name: "JSON member", schema: S.Json(), value: { child: undefined } },
    { name: "non-nullable null", schema: S.String(), value: null }
  ];
  const scenarios: DefaultCase[] = invalid.flatMap(({ name, schema, value }) => [false, true].map((optional) => {
    const field = { ...schema, default: value } as AnySchema;
    return { name: `${name}, optional=${optional}`, schema: S.Object({ value: optional ? S.Optional(field) : field }), input: {}, error: "Invalid default" };
  }));
  const bounded = S.Number({ default: 2, maximum: 10 });
  bounded.default = 20;
  const scopedDefault = { visible_name: "visible", hidden_name: "hidden" };
  const nestedDefault = S.Number({ default: 2, maximum: 10 });
  const outer = S.Object({ visible_name: S.String(), optional_count: S.Optional(nestedDefault) }, { default: { visible_name: "visible" } });
  nestedDefault.default = 20;
  const callback = () => 42;
  class Resource { read() { return 42; } }
  const resource = new Resource();
  const scopedMember = S.Object({ visible_name: S.String(), hidden_name: S.String({ scope: ["cli"] }) });
  const scopedContainers: Array<{ name: string; schema: AnySchema; value: unknown }> = [
    { name: "array", schema: S.Array(scopedMember), value: [scopedDefault] },
    { name: "record", schema: S.Record(scopedMember), value: { entry: scopedDefault } },
    { name: "oneOf", schema: S.OneOf({ discriminator: "delivery_kind", branches: { email: scopedMember } }), value: { delivery_kind: "email", ...scopedDefault } },
    { name: "union", schema: S.Union([scopedMember, S.Object({ other: S.String() })]), value: scopedDefault }
  ];
  scenarios.push(...scopedContainers.map(({ name, schema, value }) => ({
    name: `preserves scoped canonical contents inside ${name} defaults`,
    schema: S.Object({ value: { ...schema, default: value } as AnySchema }),
    input: {},
    expected: { value }
  })));

  scenarios.push(
    { name: "explicit optional undefined applies and validates default", schema: S.Object({ value: S.Optional(bounded) }), input: { value: undefined }, error: "Invalid default" },
    { name: "nested supplied object validates its applied child default", schema: S.Object({ value: S.Object({ child: S.Optional(bounded) }) }), input: { value: {} }, error: "Invalid default" },
    { name: "optional array item default is validated", schema: S.Object({ value: S.Array(S.Optional(bounded)) }), input: { value: [undefined] }, error: "Invalid default" },
    { name: "optional record value default is validated", schema: S.Object({ value: S.Record(S.Optional(bounded)) }), input: { value: { entry: undefined } }, error: "Invalid default" },
    { name: "does not validate an overridden default", schema: S.Object({ value: S.Optional(bounded) }), input: { value: 3 }, expected: { value: 3 } },
    { name: "keeps canonical and scoped default fields", schema: S.Object({ value: S.Optional(S.Object({ visible_name: S.String(), hidden_name: S.String({ scope: ["cli"] }) }, { default: scopedDefault })) }), input: {}, expected: { value: scopedDefault } },
    { name: "does not apply or validate an unused nested optional default", schema: S.Object({ value: S.Optional(outer) }), input: {}, expected: { value: { visible_name: "visible" } } },
    { name: "keeps an explicit optional undefined member in an object default", schema: S.Object({ value: S.Object({ child: S.Optional(S.String({ default: "seed" })) }, { default: { child: undefined } }) }), input: {}, expected: { value: { child: undefined } } },
    { name: "keeps canonical optional array-item object defaults", schema: S.Object({ value: S.Array(S.Optional(S.Object({ display_name: S.String() }, { default: { display_name: "seed" } }))) }), input: { value: [undefined] }, expected: { value: [{ display_name: "seed" }] } },
    { name: "keeps nullable defaults", schema: S.Object({ value: { ...S.String({ nullable: true }), default: null } }), input: {}, expected: { value: null } },
    { name: "does not inject a scoped-out field default", schema: S.Object({ value: S.String({ scope: ["cli"], default: "hidden" }) }), input: {}, expected: {} },
    { name: "preserves opaque additional-property values", schema: S.Object({ value: S.Object({ name: S.String() }, { additionalProperties: true, default: { name: "ready", callback, resource } }) }), input: {}, expected: { value: { name: "ready", callback, resource } } },
    { name: "validates canonical discriminator defaults", schema: S.Object({ value: { ...S.OneOf({ discriminator: "delivery_kind", branches: { email: S.Object({ display_name: S.String() }) } }), default: { delivery_kind: "email", display_name: "ready" } } }), input: {}, expected: { value: { delivery_kind: "email", display_name: "ready" } } }
  );

  it.each(scenarios)("$name", async (scenario) => {
    const received: unknown[] = [];
    const config = { name: "read", scope: ["sdk", "mcp"] as const, params: scenario.schema };
    const command = stream
      ? defineStreamCommand({ ...config, event: S.String(), async *handler({ params }) { received.push(params); yield "ready"; } })
      : defineCommand({ ...config, handler: ({ params }) => { received.push(params); return "ready"; } });
    const root = defineGroup({ name: "audit", children: [command] });

    if (surface === "sdk") {
      const operation = (async () => {
        const result = createSDK(root, { errorReports: false }).read(scenario.input);
        if (stream) {
          for await (const event of result as AsyncIterable<unknown>) expect(event).toBe("ready");
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
        await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        await session.handleMessage("notifications/initialized");
        const result = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", { name: "audit__read", arguments: scenario.input });
        if (scenario.error !== undefined) {
          expect(result).toMatchObject({ error: { code: -32602, message: expect.stringContaining(scenario.error) } });
        } else {
          expect(result).not.toHaveProperty("error");
          if (stream) await data;
        }
      } finally {
        await session.close();
      }
    }

    expect(received).toStrictEqual(scenario.error === undefined ? [scenario.expected] : []);
  });
});
