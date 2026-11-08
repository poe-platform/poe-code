import { describe, expect, it } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";
import { createMCPServer } from "./mcp.js";

describe.each(["sdk", "mcp"] as const)("%s default isolation", (surface) => {
  async function invokeTwice<Value>(
    schema: AnySchema,
    mutate: (value: Value) => void
  ): Promise<Value[]> {
    const received: Value[] = [];
    const root = defineGroup({
      name: "audit",
      children: [defineCommand({
        name: "check",
        scope: ["sdk", "mcp"],
        params: S.Object({ value: schema }),
        handler: ({ params }) => {
          const value = params.value as Value;
          mutate(value);
          received.push(value);
          return "ok";
        }
      })]
    });

    if (surface === "sdk") {
      const sdk = createSDK(root, { errorReports: false });
      await sdk.check({});
      await sdk.check({});
    } else {
      const server = createMCPServer(root, { name: "audit", version: "1", errorReports: false });
      const session = server.createMessageSession(() => {});
      try {
        await session.handleMessage("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" }
        });
        await session.handleMessage("notifications/initialized");
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await session.handleMessage("tools/call", {
            name: "audit__check",
            arguments: {}
          });
          expect(result).not.toHaveProperty("error");
        }
      } finally {
        session.close();
      }
    }

    return received;
  }

  it.each([false, true])("isolates array defaults with optional=%s", async (optional) => {
    const defaultValue = ["seed"];
    const schema = S.Array(S.String(), { default: defaultValue });
    const received = await invokeTwice(optional ? S.Optional(schema) : schema, (value: string[]) => {
      value.push("changed");
    });

    expect(received).toEqual([["seed", "changed"], ["seed", "changed"]]);
    expect(received[0]).not.toBe(received[1]);
    expect(defaultValue).toEqual(["seed"]);
  });

  it.each([false, true])("deeply isolates canonical object defaults with optional=%s", async (optional) => {
    const defaultValue = { display_name: "seed", nested: { tags: ["seed"] }, extra: { values: [] as string[] } };
    const schema = S.Object({
      display_name: S.String(),
      nested: S.Object({ tags: S.Array(S.String()) })
    }, { additionalProperties: true, default: defaultValue });
    const received = await invokeTwice(optional ? S.Optional(schema) : schema, (value: typeof defaultValue) => {
      value.nested.tags.push("changed");
      value.extra.values.push("extra");
    });

    expect(received).toEqual([
      { display_name: "seed", nested: { tags: ["seed", "changed"] }, extra: { values: ["extra"] } },
      { display_name: "seed", nested: { tags: ["seed", "changed"] }, extra: { values: ["extra"] } }
    ]);
    expect(received[0]?.nested).not.toBe(received[1]?.nested);
    expect(defaultValue).toEqual({ display_name: "seed", nested: { tags: ["seed"] }, extra: { values: [] } });
  });

  it("preserves callable extras while isolating their containing default data", async () => {
    const callback = () => 42;
    const defaultValue = { items: [] as string[], callback };
    const schema = S.Object({ items: S.Array(S.String()) }, {
      additionalProperties: true,
      default: defaultValue
    });
    const received = await invokeTwice(schema, (value: typeof defaultValue) => {
      expect(value.callback).toBe(callback);
      expect(value.callback()).toBe(42);
      value.items.push("changed");
    });

    expect(received.map((value) => value.items)).toEqual([["changed"], ["changed"]]);
    expect(defaultValue.items).toEqual([]);
  });

  it.each([false, 0, "", null])("preserves the falsy JSON default %s", async (defaultValue) => {
    const received = await invokeTwice({ ...S.Json(), default: defaultValue }, () => {});

    expect(received).toEqual([defaultValue, defaultValue]);
  });

  it("preserves opaque class instances without sharing their containing plain default", async () => {
    class Resource {
      read() { return 42; }
    }
    const resource = new Resource();
    const defaultValue = { resource, items: [] as string[] };
    const schema = S.Object({ items: S.Array(S.String()) }, {
      additionalProperties: true,
      default: defaultValue
    });
    const received = await invokeTwice(schema, (value: typeof defaultValue) => {
      expect(value.resource).toBe(resource);
      expect(value.resource.read()).toBe(42);
      value.items.push("changed");
    });

    expect(received.map((value) => value.items)).toEqual([["changed"], ["changed"]]);
    expect(defaultValue.items).toEqual([]);
  });
});

it("preserves canonical and scoped object-default contents in the SDK", async () => {
  const defaultValue = { visible_name: "visible", hidden_name: "hidden" };
  const root = defineGroup({
    name: "audit",
    children: [defineCommand({
      name: "check",
      params: S.Object({ value: S.Object({
        visible_name: S.String(),
        hidden_name: S.String({ scope: ["mcp"] })
      }, { default: defaultValue }) }),
      handler: ({ params }) => params.value
    })]
  });

  await expect(createSDK(root, { errorReports: false }).check({})).resolves.toEqual(defaultValue);
});
