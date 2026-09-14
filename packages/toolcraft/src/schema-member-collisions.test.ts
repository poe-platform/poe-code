import { describe, expect, it, vi } from "vitest";
import { S, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createSDK } from "./sdk.js";
import { createMCPServer } from "./mcp.js";

const containers: Array<{ name: string; wrap: (schema: ObjectSchema<any>) => AnySchema }> = [
  { name: "object", wrap: (schema) => schema },
  { name: "optional object", wrap: (schema) => S.Optional(schema) },
  { name: "array", wrap: (schema) => S.Array(schema) },
  { name: "record", wrap: (schema) => S.Record(schema) },
  { name: "union", wrap: (schema) => S.Union([schema]) },
  { name: "discriminator", wrap: (schema) => S.OneOf({ discriminator: "kind", branches: { value: schema } }) },
  { name: "optional array", wrap: (schema) => S.Optional(S.Array(schema)) },
  { name: "array of records", wrap: (schema) => S.Array(S.Record(schema)) },
  { name: "record of arrays", wrap: (schema) => S.Record(S.Array(schema)) },
  { name: "array of unions", wrap: (schema) => S.Array(S.Union([schema])) },
  { name: "record of discriminators", wrap: (schema) => S.Record(S.OneOf({ discriminator: "kind", branches: { value: schema } })) },
  { name: "nested optional array", wrap: (schema) => S.Object({ nested: S.Optional(S.Array(schema)) }) }
];

const routes = [
  { surface: "SDK", slot: "params", casing: "camel" },
  { surface: "SDK", slot: "stream params", casing: "camel" },
  { surface: "MCP", slot: "params", casing: "snake" },
  { surface: "MCP", slot: "params", casing: "camel" },
  { surface: "MCP", slot: "stream params", casing: "snake" },
  { surface: "MCP", slot: "stream params", casing: "camel" },
  { surface: "MCP", slot: "result", casing: "snake" },
  { surface: "MCP", slot: "result", casing: "camel" },
  { surface: "MCP", slot: "event", casing: "snake" },
  { surface: "MCP", slot: "event", casing: "camel" }
] as const;

describe.each(routes)("$surface $casing $slot member collisions", ({ surface, slot, casing }) => {
  it.each(containers)("rejects conflicting members inside $name", ({ wrap }) => {
    const handler = vi.fn();
    const schema = wrap(S.Object({ "foo-bar": S.String(), foo_bar: S.Optional(S.String()) }));
    const params = slot === "params" || slot === "stream params" ? S.Object({ payload: schema }) : S.Object({});
    const config = { name: "check", scope: ["sdk", "mcp"] as const, params };
    const command = slot === "event" || slot === "stream params"
      ? defineStreamCommand({ ...config, event: slot === "event" ? schema : S.Json(), async *handler() { handler(); yield {}; } })
      : defineCommand({ ...config, ...(slot === "result" ? { result: S.Object({ payload: schema }) } : {}), handler });
    const root = defineGroup({ name: "audit", children: [command] });
    const construct = () => surface === "SDK" ? createSDK(root) : createMCPServer(root, { name: "audit", version: "1", casing, errorReports: false });
    expect(construct).toThrow(`use conflicting ${surface === "SDK" ? "SDK member" : "MCP field"}`);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a branch field that collides with the injected discriminator", () => {
    const schema = S.OneOf({
      discriminator: "foo-bar",
      branches: { value: S.Object({ foo_bar: S.Optional(S.String()) }) }
    });
    const handler = vi.fn();
    const params = slot === "params" || slot === "stream params" ? S.Object({ payload: schema }) : S.Object({});
    const config = { name: "check", scope: ["sdk", "mcp"] as const, params };
    const command = slot === "event" || slot === "stream params"
      ? defineStreamCommand({ ...config, event: slot === "event" ? schema : S.Json(), async *handler() { handler(); yield {}; } })
      : defineCommand({ ...config, ...(slot === "result" ? { result: S.Object({ payload: schema }) } : {}), handler });
    const root = defineGroup({ name: "audit", children: [command] });
    const construct = () => surface === "SDK" ? createSDK(root) : createMCPServer(root, { name: "audit", version: "1", casing, errorReports: false });
    expect(construct).toThrow(`use conflicting ${surface === "SDK" ? "SDK member" : "MCP field"}`);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe.each(["SDK", "MCP snake", "MCP camel"])("%s collision compatibility", (surface) => {
  const camel = surface !== "MCP snake";
  const wire = camel ? "fooBar" : "foo_bar";
  const shared = S.Object({ foo_bar: S.String() });
  const arbitrary = { "foo-bar": "first", foo_bar: "second" };
  const cases: Array<{ name: string; schema: AnySchema; samples: Array<{ input: unknown; expected: unknown }> }> = [
    { name: "sibling objects", schema: S.Object({ left: S.Object({ "foo-bar": S.String() }), right: shared }), samples: [{ input: { left: { [wire]: "first" }, right: { [wire]: "second" } }, expected: { left: { "foo-bar": "first" }, right: { foo_bar: "second" } } }] },
    { name: "union alternatives", schema: S.Union([S.Object({ "foo-bar": S.String() }), S.Object({ foo_bar: S.Number() })]), samples: [{ input: { [wire]: "first" }, expected: { "foo-bar": "first" } }, { input: { [wire]: 2 }, expected: { foo_bar: 2 } }] },
    { name: "discriminated alternatives", schema: S.OneOf({ discriminator: "kind", branches: { text: S.Object({ "foo-bar": S.String() }), count: S.Object({ foo_bar: S.Number() }) } }), samples: [{ input: { kind: "text", [wire]: "first" }, expected: { kind: "text", "foo-bar": "first" } }, { input: { kind: "count", [wire]: 2 }, expected: { kind: "count", foo_bar: 2 } }] },
    { name: "shared branch descriptors", schema: S.Object({ left: S.OneOf({ discriminator: "left_kind", branches: { value: shared } }), right: S.OneOf({ discriminator: "right_kind", branches: { value: shared } }) }), samples: [{ input: { left: { [camel ? "leftKind" : "left_kind"]: "value", [wire]: "first" }, right: { [camel ? "rightKind" : "right_kind"]: "value", [wire]: "second" } }, expected: { left: { left_kind: "value", foo_bar: "first" }, right: { right_kind: "value", foo_bar: "second" } } }] },
    { name: "scoped array fields", schema: S.Array(S.Object({ "foo-bar": S.String(), foo_bar: S.Optional(S.String({ scope: ["cli"] })) })), samples: [{ input: [{ [wire]: "first" }], expected: [{ "foo-bar": "first" }] }] },
    { name: "scoped discriminator alias", schema: S.OneOf({ discriminator: "foo-bar", branches: { value: S.Object({ foo_bar: S.Optional(S.String({ scope: ["cli"] })) }) } }), samples: [{ input: { [wire]: "value" }, expected: { "foo-bar": "value" } }] },
    { name: "arbitrary record keys", schema: S.Record(S.String()), samples: [{ input: arbitrary, expected: arbitrary }] },
    { name: "JSON keys", schema: S.Json(), samples: [{ input: arbitrary, expected: arbitrary }] },
    { name: "additional properties", schema: S.Object({}, { additionalProperties: true }), samples: [{ input: arbitrary, expected: arbitrary }] }
  ];

  it.each(cases)("preserves $name", async ({ schema, samples }) => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", scope: ["sdk", "mcp"], params: S.Object({ payload: schema }), handler });
    const root = defineGroup({ name: "audit", children: [command] });
    if (surface === "SDK") {
      const sdk = createSDK(root, { errorReports: false });
      for (const sample of samples) {
        await expect(sdk.check({ payload: sample.input })).resolves.toEqual({ payload: sample.expected });
      }
    } else {
      const session = createMCPServer(root, { name: "audit", version: "1", casing: camel ? "camel" : "snake", errorReports: false }).createMessageSession();
      try {
        await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        await session.handleMessage("notifications/initialized");
        for (const sample of samples) {
          const response = await session.handleMessage("tools/call", { name: "audit__check", arguments: { payload: sample.input } });
          expect(response).not.toHaveProperty("error");
          expect(handler.mock.calls.at(-1)?.[0].params).toEqual({ payload: sample.expected });
        }
      } finally {
        await session.close();
      }
    }
    expect(handler).toHaveBeenCalledTimes(samples.length);
  });
});

it.each([false, true])("preserves canonical SDK output without casing (stream=%s)", async (stream) => {
  const result = { "foo-bar": "first", foo_bar: "second" };
  const schema = S.Object({ "foo-bar": S.String(), foo_bar: S.String() });
  const config = { name: "check", scope: ["sdk"] as const, params: S.Object({}) };
  if (stream) {
    const command = defineStreamCommand({ ...config, event: schema, async *handler() { yield result; } });
    const sdk = createSDK(defineGroup({ name: "audit", children: [command] }), { errorReports: false });
    const received = [];
    for await (const event of sdk.check({})) received.push(event);
    expect(received).toEqual([result]);
  } else {
    const command = defineCommand({ ...config, result: schema, handler: () => result });
    const sdk = createSDK(defineGroup({ name: "audit", children: [command] }), { errorReports: false });
    await expect(sdk.check({})).resolves.toEqual(result);
  }
});
