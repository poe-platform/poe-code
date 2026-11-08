import { describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S, type AnySchema, type JsonSchema } from "toolcraft-schema";
import { codeMode, type ExecuteResult } from "./index.js";

const factories = [
  { name: "array", create: () => S.Array(S.String(), { default: ["seed"] }), path: [] },
  { name: "JSON", create: () => ({ ...S.Json(), default: { nested: { tags: ["seed"] } } }), path: ["nested", "tags"] },
  { name: "record", create: () => ({ ...S.Record(S.Array(S.String())), default: { entry: ["seed"] } }), path: ["entry"] },
  { name: "object", create: () => S.Object({ tags: S.Array(S.String()) }, { default: { tags: ["seed"] } }), path: ["tags"] },
  { name: "object array", create: () => S.Array(S.Object({ tags: S.Array(S.String()) }), { default: [{ tags: ["seed"] }] }), path: ["0", "tags"] }
];

type DiscoverySDK = {
  getSchemas(params: { names: string[] }): Promise<Record<string, { params: JsonSchema }>>;
  search(params: { query: string; detail: "detailed" | "full" }): Promise<Array<{ schema: JsonSchema }>>;
  execute(params: { source: string }): Promise<ExecuteResult>;
};

describe.each(["getSchemas", "detailed", "full"] as const)("%s default ownership", (surface) => {
  describe.each([false, true])("optional=%s", (optional) => {
    it.each(factories)("keeps $name defaults stable after a discovery consumer mutates its copy", async ({ create, path }) => {
      const field: AnySchema = create();
      const original = structuredClone(field.default);
      const handler = vi.fn(async ({ params }: { params: unknown }) => params);
      const root = defineGroup({ name: "fixture", children: [defineCommand({
        name: "echo", description: "Echo fixture", scope: ["sdk"],
        params: S.Object({ payload: optional ? S.Optional(field) : field }), handler
      })] });
      const sdk = createSDK(codeMode(root, { approvals: false, errorReports: false }), {
        approvals: false, errorReports: false
      }) as DiscoverySDK;
      const first = surface === "getSchemas"
        ? (await sdk.getSchemas({ names: ["echo"] })).echo!.params
        : (await sdk.search({ query: "echo", detail: surface }))[0]!.schema;
      const second = (await sdk.getSchemas({ names: ["echo"] })).echo!.params;
      const before = await sdk.execute({ source: 'import { echo } from "fixture"; return await echo({});' });
      expect(before).toMatchObject({ ok: true, returnValue: { payload: original } });
      expect(handler).toHaveBeenCalledOnce();

      let mutable = first.properties!.payload!.default;
      for (const segment of path) mutable = (mutable as Record<string, unknown>)[segment];
      (mutable as string[]).push("changed-by-consumer");

      expect(field.default).toEqual(original);
      expect(second.properties!.payload!.default).toEqual(original);
      const after = await sdk.execute({ source: 'import { echo } from "fixture"; return await echo({});' });
      expect(after).toMatchObject({ ok: true, returnValue: { payload: original } });
      const refreshed = (await sdk.getSchemas({ names: ["echo"] })).echo!.params;
      expect(refreshed.properties!.payload!.default).toEqual(original);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(first.properties!.payload!.default).not.toEqual(original);
    });
  });
});
