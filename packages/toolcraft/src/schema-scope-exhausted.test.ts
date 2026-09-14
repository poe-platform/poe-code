import { describe, expect, it, vi } from "vitest";
import { compileJsonSchema, S, toJsonSchema, validate, type AnySchema, type JsonSchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { filterSchemaForScope } from "./schema-scope.js";
import { createSDK } from "./sdk.js";

type VariantKind = "oneOf" | "union";
type Wrapper = "direct" | "optional" | "array" | "record";

function variant(kind: VariantKind, branches: Record<string, ObjectSchema<any>>, nullable: boolean): AnySchema {
  const schema = kind === "oneOf"
    ? S.OneOf({ discriminator: "kind", branches })
    : S.Union(Object.values(branches));
  return { ...schema, nullable };
}

function wrapSchema(schema: AnySchema, wrapper: Wrapper): AnySchema {
  if (wrapper === "optional") return S.Optional(schema);
  if (wrapper === "array") return S.Array(schema);
  if (wrapper === "record") return S.Record(schema);
  return schema;
}

function wrapValue(value: unknown, wrapper: Wrapper): unknown {
  if (wrapper === "array") return [value];
  if (wrapper === "record") return { slot: value };
  return value;
}

async function collectEvents(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of source) events.push(event);
  return events;
}

const wrappers: Wrapper[] = ["direct", "optional", "array", "record"];

describe.each(["cli", "mcp", "sdk"] as const)("exhausted %s scope projection", (scope) => {
  const hiddenScope = scope === "cli" ? "mcp" : "cli";

  describe.each(["oneOf", "union"] as const)("%s", (kind) => {
    describe.each([false, true])("nullable=%s", (nullable) => {
      describe.each([false, true])("visible branch=%s", (visible) => {
        it.each(wrappers)("preserves valid %s container semantics", (wrapper) => {
          const branches: Record<string, ObjectSchema<any>> = {
            hidden: S.Object({ hidden: S.String() }, { scope: [hiddenScope] })
          };
          if (visible) branches.visible = S.Object({ visible: S.String() }, { scope: [scope] });
          const schema = S.Object({ payload: wrapSchema(variant(kind, branches, nullable), wrapper) });
          const original = structuredClone(schema);
          const projected = filterSchemaForScope(schema, scope);

          expect(projected?.kind).toBe("object");
          if (projected?.kind !== "object") throw new Error("Expected object projection");
          const excluded = !visible && !nullable;
          expect(Object.hasOwn(projected.shape, "payload")).toBe(!excluded);
          const compiled = compileJsonSchema(toJsonSchema(projected));
          const branchValue = kind === "oneOf" ? { kind: "visible", visible: "ready" } : { visible: "ready" };
          const input = excluded ? {} : { payload: wrapValue(nullable ? null : branchValue, wrapper) };

          expect(compiled.validate(input).ok).toBe(true);
          expect(validate(projected, input).ok).toBe(true);
          if (visible) {
            const visibleInput = { payload: wrapValue(branchValue, wrapper) };
            expect(compiled.validate(visibleInput).ok).toBe(true);
            expect(validate(projected, visibleInput).ok).toBe(true);
          }
          const hiddenValue = kind === "oneOf" ? { kind: "hidden", hidden: "no" } : { hidden: "no" };
          const hiddenInput = { payload: wrapValue(hiddenValue, wrapper) };
          expect(compiled.validate(hiddenInput).ok).toBe(false);
          expect(validate(projected, hiddenInput).ok).toBe(false);
          if (wrapper === "optional") expect(compiled.validate({}).ok).toBe(true);
          expect(schema).toEqual(original);
        });
      });
    });

    it("retains a visible branch whose fields all disappear", () => {
      const schema = S.Object({ payload: variant(kind, {
        visible: S.Object({ hidden: S.String({ scope: [hiddenScope] }) })
      }, false) });
      const projected = filterSchemaForScope(schema, scope);

      expect(projected?.kind).toBe("object");
      if (projected?.kind !== "object") throw new Error("Expected object projection");
      expect(Object.hasOwn(projected.shape, "payload")).toBe(true);
      const input = { payload: kind === "oneOf" ? { kind: "visible" } : {} };
      expect(compileJsonSchema(toJsonSchema(projected)).validate(input).ok).toBe(true);
      expect(validate(projected, input).ok).toBe(true);
    });
  });

  it.each(["array", "record"] as const)("matches existing exhausted %s behavior", (kind) => {
    const child = S.String({ scope: [hiddenScope] });
    const schema = S.Object({ payload: kind === "array" ? S.Array(child) : S.Record(child) });
    const projected = filterSchemaForScope(schema, scope);

    expect(projected).toEqual(S.Object({}));
    expect(compileJsonSchema(toJsonSchema(projected!)).validate({}).ok).toBe(true);
  });
});

describe.each([
  { surface: "sdk", stream: false },
  { surface: "sdk", stream: true },
  { surface: "mcp", stream: false },
  { surface: "mcp", stream: true }
] as const)("exhausted unions through $surface stream=$stream", ({ surface, stream }) => {
  describe.each(["oneOf", "union"] as const)("%s", (kind) => {
    describe.each([false, true])("nullable=%s", (nullable) => {
      it.each(wrappers)("keeps the command and healthy sibling usable with a %s parameter", async (wrapper) => {
        const field = variant(kind, {
          hidden: S.Object({ value: S.String() }, { scope: ["cli"] })
        }, nullable);
        const handler = vi.fn(({ params }: { params: unknown }) => params);
        const healthy = vi.fn(() => "ready");
        const config = {
          name: "check", scope: ["sdk", "mcp"] as const,
          params: S.Object({ payload: wrapSchema(field, wrapper) })
        };
        const root = defineGroup({ name: "audit", children: [
          stream
            ? defineStreamCommand({ ...config, event: S.String(), async *handler({ params }) { handler({ params }); yield "ready"; } })
            : defineCommand({ ...config, handler }),
          defineCommand({ name: "healthy", scope: ["sdk", "mcp"], params: S.Object({}), handler: healthy })
        ] });
        const input = nullable ? { payload: wrapValue(null, wrapper) } : {};
        const hidden = { payload: wrapValue(kind === "oneOf" ? { kind: "hidden", value: "no" } : { value: "no" }, wrapper) };

        if (surface === "sdk") {
          const sdk = createSDK(root, { approvals: false }) as {
            check(params: Record<string, unknown>): Promise<unknown> | AsyncIterable<unknown>;
            healthy(): Promise<unknown>;
          };
          await expect(sdk.healthy()).resolves.toBe("ready");
          if (stream) {
            await expect(collectEvents(sdk.check(input) as AsyncIterable<unknown>)).resolves.toEqual(["ready"]);
            await expect(collectEvents(sdk.check(hidden) as AsyncIterable<unknown>)).rejects.toThrow();
          } else {
            await expect(sdk.check(input)).resolves.toEqual(input);
            await expect(sdk.check(hidden)).rejects.toThrow();
          }
        } else {
          let resolveData!: (event: unknown) => void;
          const data = new Promise<unknown>((resolve) => { resolveData = resolve; });
          const session = createMCPServer(root, {
            name: "audit", version: "1", errorReports: false
          }).createMessageSession((notification) => {
            if (notification.params?.type === "data") resolveData(notification.params.event);
          });
          try {
            await session.handleMessage("initialize", {
              protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
            });
            await session.handleMessage("notifications/initialized");
            const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
            const tools = (listing.result as Record<string, Array<{ name: string; inputSchema: JsonSchema }>>)[stream ? "streams" : "tools"];
            expect(tools).toHaveLength(stream ? 1 : 2);
            const definition = tools.find((tool) => tool.name === "audit__check");
            expect(definition).toBeDefined();
            expect(compileJsonSchema(definition!.inputSchema).validate(input).ok).toBe(true);
            expect(compileJsonSchema(definition!.inputSchema).validate(hidden).ok).toBe(false);
            const healthyResult = await session.handleMessage("tools/call", { name: "audit__healthy", arguments: {} });
            expect(healthyResult.error).toBeUndefined();
            const method = stream ? "toolcraft/streams/subscribe" : "tools/call";
            const result = await session.handleMessage(method, { name: "audit__check", arguments: input });
            expect(result.error).toBeUndefined();
            expect(result.result).not.toHaveProperty("isError", true);
            if (stream) await expect(data).resolves.toBe("ready");
            const invalid = await session.handleMessage(method, { name: "audit__check", arguments: hidden });
            expect(invalid.error).toBeDefined();
          } finally {
            await session.close();
          }
        }

        expect(healthy).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]?.[0].params).toEqual(input);
      });
    });
  });
});
