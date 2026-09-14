import { describe, expect, it } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

interface DiscriminatorCase {
  name: string;
  schema?: AnySchema;
  input: unknown;
  expected?: unknown;
  errorPath?: string;
}

describe.each([
  { surface: "sdk", stream: false, casing: "camel" },
  { surface: "sdk", stream: true, casing: "camel" },
  { surface: "mcp", stream: false, casing: "snake" },
  { surface: "mcp", stream: true, casing: "snake" },
  { surface: "mcp", stream: false, casing: "camel" },
  { surface: "mcp", stream: true, casing: "camel" }
] as const)("$surface stream=$stream casing=$casing discriminators", ({ surface, stream, casing }) => {
  const nameKey = casing === "snake" ? "display_name" : "displayName";
  const discriminatorKey = casing === "snake" ? "delivery_kind" : "deliveryKind";
  const schema = S.OneOf({
    discriminator: "kind",
    branches: { good: S.Object({ display_name: S.String() }), empty: S.Object({}) }
  });
  const casedSchema = S.OneOf({
    discriminator: "delivery_kind",
    branches: { good: S.Object({ display_name: S.String() }) }
  });
  const prototypeBranches = S.OneOf({
    discriminator: "kind",
    branches: Object.fromEntries(["constructor", "__proto__", "toString"].map((name) => [name, S.Object({})]))
  });
  const cases: DiscriminatorCase[] = [
    ...[42, null, [], "bad"].map((input) => ({ name: `rejects non-object ${JSON.stringify(input)}`, input, errorPath: "payload" })),
    { name: "requires a discriminator", input: {}, errorPath: "payload.kind" },
    ...[42, null, false, {}, []].map((kind) => ({ name: `rejects non-string discriminator ${JSON.stringify(kind)}`, input: { kind }, errorPath: "payload.kind" })),
    { name: "rejects an unknown discriminator", input: { kind: "other" }, errorPath: "payload.kind" },
    ...["toString", "constructor", "__proto__"].map((kind) => ({ name: `rejects inherited branch ${kind}`, input: { kind }, errorPath: "payload.kind" })),
    { name: "requires an own discriminator property", input: Object.assign(Object.create({ kind: "good" }), { [nameKey]: "sample" }), errorPath: "payload.kind" },
    { name: "normalizes a valid branch", input: { kind: "good", [nameKey]: "sample" }, expected: { kind: "good", display_name: "sample" } },
    { name: "accepts an empty branch", input: { kind: "empty" }, expected: { kind: "empty" } },
    { name: "normalizes a cased discriminator", schema: casedSchema, input: { [discriminatorKey]: "good", [nameKey]: "sample" }, expected: { delivery_kind: "good", display_name: "sample" } },
    {
      name: "prevents additional properties from replacing the canonical discriminator",
      schema: S.OneOf({ discriminator: "delivery-kind", branches: { good: S.Object({ display_name: S.String() }, { additionalProperties: true }) } }),
      input: { [discriminatorKey]: "good", "delivery-kind": "other", [nameKey]: "sample", note: "visible" },
      expected: { "delivery-kind": "good", display_name: "sample", note: "visible" }
    },
    { name: "reports the caller-cased discriminator path", schema: casedSchema, input: { [nameKey]: "sample" }, errorPath: `payload.${discriminatorKey}` },
    { name: "still validates branch value types", input: { kind: "good", [nameKey]: 42 }, errorPath: `payload.${nameKey}` },
    { name: "still requires branch fields", input: { kind: "good" }, errorPath: `payload.${nameKey}` },
    ...["constructor", "__proto__", "toString"].map((kind) => ({ name: `accepts an explicitly declared ${kind} branch`, schema: prototypeBranches, input: { kind }, expected: { kind } })),
    { name: "preserves explicit nullability", schema: { ...schema, nullable: true }, input: null, expected: null }
  ];

  it.each(cases)("$name", async (scenario) => {
    const expectedChoices = scenario.errorPath === "payload.kind"
      ? "Expected one of: good, empty."
      : scenario.errorPath === `payload.${discriminatorKey}` ? "Expected one of: good." : undefined;
    const received: unknown[] = [];
    const config = { name: "check", scope: ["sdk", "mcp"] as const, params: S.Object({ payload: scenario.schema ?? schema }) };
    const command = stream
      ? defineStreamCommand({
          ...config,
          event: S.String(),
          async *handler({ params }) { received.push(params.payload); yield "ok"; }
        })
      : defineCommand({ ...config, handler: ({ params }) => { received.push(params.payload); return "ok"; } });
    const root = defineGroup({ name: "audit", children: [command] });

    if (surface === "sdk") {
      const sdk = createSDK(root, { errorReports: false });
      const operation = (async () => {
        const result = sdk.check({ payload: scenario.input });
        if (stream) {
          for await (const event of result as AsyncIterable<unknown>) expect(event).toBe("ok");
        } else {
          await result;
        }
      })();
      if (scenario.errorPath !== undefined) {
        await expect(operation).rejects.toMatchObject({ name: "UserError", message: expect.stringContaining(scenario.errorPath) });
        if (expectedChoices !== undefined) await expect(operation).rejects.toThrow(expectedChoices);
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
          name: "audit__check", arguments: { payload: scenario.input }
        });
        if (scenario.errorPath !== undefined) {
          expect(result).toMatchObject({ error: { code: -32602, message: expect.stringContaining(scenario.errorPath) } });
          if (expectedChoices !== undefined) expect(result.error?.message).toContain(expectedChoices);
        } else {
          expect(result).not.toHaveProperty("error");
          if (stream) await data;
        }
      } finally {
        session.close();
      }
    }

    expect(received).toEqual(scenario.errorPath === undefined ? [scenario.expected] : []);
  });
});
