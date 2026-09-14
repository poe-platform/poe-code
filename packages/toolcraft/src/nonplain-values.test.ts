import { describe, expect, it, vi } from "vitest";
import { S, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

class Payload {}

const nonplainValues = [
  { name: "Date", create: () => new Date(0) },
  { name: "Map", create: () => new Map([["stored", "value"]]) },
  { name: "Set", create: () => new Set(["stored"]) },
  { name: "class instance", create: () => new Payload() },
  { name: "custom prototype", create: () => Object.create({ inherited: true }) }
];

function schemaFor(kind: "object" | "record" | "oneOf" | "union"): AnySchema {
  switch (kind) {
    case "object":
      return S.Object({ label: S.String() }, { additionalProperties: true });
    case "record":
      return S.Record(S.String());
    case "oneOf":
      return S.OneOf({ discriminator: "kind", branches: { named: S.Object({ label: S.String() }) } });
    case "union":
      return S.Union([
        S.Object({ label: S.String() }, { additionalProperties: true }),
        S.Object({ count: S.Number() })
      ]);
  }
}

function sdkCase(schema: ObjectSchema<any>, stream: boolean) {
  const handler = vi.fn((params: unknown) => params);
  const shared = { name: "check", scope: ["sdk", "mcp"] as ["sdk", "mcp"], params: schema };
  const command = stream
    ? defineStreamCommand({
        ...shared,
        event: S.Object({}, { additionalProperties: true }),
        handler: async function* ({ params }) { yield handler(params); }
      })
    : defineCommand({ ...shared, handler: ({ params }) => handler(params) });
  const sdk = createSDK(defineGroup({ name: "audit", children: [command] }), { errorReports: false });
  return {
    handler,
    async run(params: unknown) {
      const result = sdk.check(params as never);
      if (!stream) return await result;
      const events: unknown[] = [];
      for await (const event of result as AsyncIterable<unknown>) events.push(event);
      expect(events).toHaveLength(1);
      return events[0];
    }
  };
}

async function mcpResult(schema: AnySchema, value: unknown) {
  const root = defineGroup({
    name: "audit",
    children: [defineCommand({
      name: "check",
      scope: ["mcp"],
      params: S.Object({}),
      result: S.Object({ payload: schema }),
      handler: () => ({ payload: value })
    })]
  });
  const server = createMCPServer(root, { name: "audit", version: "1", errorReports: false });
  const session = server.createMessageSession(() => {});
  try {
    await session.handleMessage("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
    });
    await session.handleMessage("notifications/initialized");
    return await session.handleMessage("tools/call", { name: "audit__check", arguments: {} });
  } finally {
    session.close();
  }
}

describe.each([false, true])("SDK non-plain inputs stream=%s", (stream) => {
  describe.each(["object", "record", "oneOf", "union"] as const)("%s", (kind) => {
    it.each(nonplainValues)("rejects $name before handler execution", async ({ create }) => {
      const input = Object.assign(create(), { kind: "named", label: "ready" });
      const fixture = sdkCase(S.Object({ payload: schemaFor(kind) }), stream);
      await expect(fixture.run({ payload: input })).rejects.toThrow("non-plain object");
      expect(fixture.handler).not.toHaveBeenCalled();
      expect(input.label).toBe("ready");
    });

    it.each([false, true])("accepts plain records with null prototype=%s", async (nullPrototype) => {
      const payload = Object.assign(nullPrototype ? Object.create(null) : {}, { kind: "named", label: "ready" });
      const fixture = sdkCase(S.Object({ payload: schemaFor(kind) }), stream);
      expect(await fixture.run({ payload })).toEqual({ payload: { kind: "named", label: "ready" } });
      expect(fixture.handler).toHaveBeenCalledTimes(1);
    });
  });

  it.each(nonplainValues)("rejects a $name argument root", async ({ create }) => {
    const fixture = sdkCase(S.Object({ label: S.String() }), stream);
    await expect(fixture.run(Object.assign(create(), { label: "ready" }))).rejects.toThrow("non-plain object");
    expect(fixture.handler).not.toHaveBeenCalled();
  });

  describe.each(["optional", "array", "record"] as const)("nested %s", (wrapper) => {
    it.each(nonplainValues)("rejects nested $name values", async ({ create }) => {
      const schema = schemaFor("object");
      const wrapped = wrapper === "optional" ? S.Optional(schema) : wrapper === "array" ? S.Array(schema) : S.Record(schema);
      const payload = Object.assign(create(), { label: "ready" });
      const input = wrapper === "optional" ? payload : wrapper === "array" ? [payload] : { slot: payload };
      const fixture = sdkCase(S.Object({ payload: wrapped }), stream);
      await expect(fixture.run({ payload: input })).rejects.toThrow("non-plain object");
      expect(fixture.handler).not.toHaveBeenCalled();
    });
  });

  it("retains opaque values in explicitly unrestricted additional properties", async () => {
    const resource = new Payload();
    const fixture = sdkCase(S.Object({ payload: S.Object({}, { additionalProperties: true }) }), stream);
    const result = await fixture.run({ payload: { resource } }) as { payload: { resource: Payload } };
    expect(result.payload.resource).toBe(resource);
    expect(fixture.handler).toHaveBeenCalledTimes(1);
  });

  it.each(["object", "record", "oneOf", "union"] as const)("preserves nullable %s inputs", async (kind) => {
    const fixture = sdkCase(S.Object({ payload: { ...schemaFor(kind), nullable: true } }), stream);
    expect(await fixture.run({ payload: null })).toEqual({ payload: null });
  });

  it("preserves omitted optional object parameters", async () => {
    const fixture = sdkCase(S.Object({ payload: S.Optional(schemaFor("object")) }), stream);
    expect(await fixture.run({})).toEqual({});
    expect(await fixture.run({ payload: undefined })).toEqual({});
  });
});

describe.each(["object", "record", "oneOf", "union"] as const)("MCP %s result values", (kind) => {
  it.each(nonplainValues)("rejects $name instead of discarding its prototype", async ({ create }) => {
    const response = await mcpResult(schemaFor(kind), Object.assign(create(), { kind: "named", label: "ready" }));
    expect(response).toHaveProperty("error.code", -32603);
    expect(JSON.stringify(response)).toContain("non-plain object");
  });

  it.each([false, true])("accepts plain records with null prototype=%s", async (nullPrototype) => {
    const payload = Object.assign(nullPrototype ? Object.create(null) : {}, { kind: "named", label: "ready" });
    const response = await mcpResult(schemaFor(kind), payload);
    expect(response).not.toHaveProperty("error");
    expect(response).not.toHaveProperty("result.isError", true);
    expect(response).toHaveProperty("result.structuredContent", { payload: { kind: "named", label: "ready" } });
  });

  it("preserves nullable results", async () => {
    const response = await mcpResult({ ...schemaFor(kind), nullable: true }, null);
    expect(response).toHaveProperty("result.structuredContent", { payload: null });
  });
});

it("does not add SDK result validation to the existing canonical return contract", async () => {
  const value = new Date(0);
  const root = defineGroup({ name: "audit", children: [defineCommand({
    name: "check", params: S.Object({}), result: S.Object({}), handler: () => value
  })] });
  expect(await createSDK(root, { errorReports: false }).check({})).toBe(value);
});

it.each([false, true])("rejects non-plain in-memory MCP arguments at root=%s", async (atRoot) => {
  const handler = vi.fn(() => "ready");
  const root = defineGroup({ name: "audit", children: [defineCommand({
    name: "check", scope: ["mcp"], params: atRoot ? S.Object({}) : S.Object({ payload: S.Object({}) }), handler
  })] });
  const server = createMCPServer(root, { name: "audit", version: "1", errorReports: false });
  const session = server.createMessageSession(() => {});
  try {
    await session.handleMessage("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
    });
    await session.handleMessage("notifications/initialized");
    const response = await session.handleMessage("tools/call", {
      name: "audit__check", arguments: atRoot ? new Date(0) : { payload: new Date(0) }
    });
    expect(response).toHaveProperty("error.code", -32602);
    expect(JSON.stringify(response)).toContain("non-plain object");
    expect(handler).not.toHaveBeenCalled();
  } finally {
    session.close();
  }
});

it("preserves structurally valid raw MCP content blocks without a result schema", async () => {
  const content = Object.assign(new Payload(), { type: "text", text: "ready" });
  const root = defineGroup({ name: "audit", children: [defineCommand({
    name: "check", scope: ["mcp"], params: S.Object({}), handler: () => content
  })] });
  const server = createMCPServer(root, { name: "audit", version: "1", errorReports: false });
  const session = server.createMessageSession(() => {});
  try {
    await session.handleMessage("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
    });
    await session.handleMessage("notifications/initialized");
    const response = await session.handleMessage("tools/call", { name: "audit__check", arguments: {} });
    expect(response).toHaveProperty("result.content", [content]);
    expect(response).not.toHaveProperty("error");
  } finally {
    session.close();
  }
});
