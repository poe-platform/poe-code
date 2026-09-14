import { describe, expect, it } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

interface UnionCase {
  name: string;
  schema?: Extract<AnySchema, { kind: "union" }>;
  input: unknown;
  expected?: unknown;
  error?: string;
}

describe.each([
  { surface: "sdk", stream: false, casing: "camel" },
  { surface: "sdk", stream: true, casing: "camel" },
  { surface: "mcp", stream: false, casing: "snake" },
  { surface: "mcp", stream: true, casing: "snake" },
  { surface: "mcp", stream: false, casing: "camel" },
  { surface: "mcp", stream: true, casing: "camel" }
] as const)("$surface stream=$stream casing=$casing unions", ({ surface, stream, casing }) => {
  const baseSchema = S.Union([
    S.Object({ count: S.Number({ minimum: 1, maximum: 3 }) }, { additionalProperties: true }),
    S.Object({ text: S.String({ minLength: 3 }) }, { additionalProperties: true })
  ]);
  const fileKey = casing === "snake" ? "file_path" : "filePath";
  const cases: UnionCase[] = [
    ...[42, null, [], "bad"].map((input) => ({ name: `rejects non-object ${JSON.stringify(input)}`, input, error: "Expected an object" })),
    { name: "rejects missing branch fields", input: {}, error: "No union branch matched" },
    { name: "rejects unrelated fields", input: { other: true }, error: "No union branch matched" },
    { name: "rejects two matching branches", input: { count: 2, text: "good" }, error: "exactly one union branch" },
    { name: "reports useful invalid-branch paths", input: { count: "bad", text: 42 }, error: "payload.count" },
    { name: "accepts a valid number branch", input: { count: 2 }, expected: { count: 2 } },
    { name: "accepts a valid text branch", input: { text: "good" }, expected: { text: "good" } },
    { name: "ignores a rejected number branch", input: { count: "bad", text: "good" }, expected: { count: "bad", text: "good" } },
    { name: "ignores a rejected text branch", input: { count: 2, text: 42 }, expected: { count: 2, text: 42 } },
    { name: "uses number constraints when selecting a branch", input: { count: 9, text: "good" }, expected: { count: 9, text: "good" } },
    { name: "uses string constraints when selecting a branch", input: { count: 2, text: "x" }, expected: { count: 2, text: "x" } },
    { name: "keeps single-candidate constraint details", input: { count: 9 }, error: "payload.count" },
    {
      name: "rejects three matching branches",
      schema: S.Union([...baseSchema.branches, S.Object({ count: S.Number(), text: S.String() })]),
      input: { count: 2, text: "good" },
      error: "matched 3"
    },
    {
      name: "returns defaults from only the successful branch",
      schema: S.Union([
        S.Object({ count: S.Number(), branch_name: S.Optional(S.String({ default: "count" })), tags: S.Optional(S.Array(S.String(), { default: ["count"] })) }, { additionalProperties: true }),
        S.Object({ text: S.String(), branch_name: S.Optional(S.String({ default: "text" })), tags: S.Optional(S.Array(S.String(), { default: ["text"] })) }, { additionalProperties: true })
      ]),
      input: { count: "bad", text: "good" },
      expected: { count: "bad", text: "good", branch_name: "text", tags: ["text"] }
    },
    {
      name: "rejects ambiguity introduced by scope filtering",
      schema: S.Union([S.Object({ left: S.String({ scope: ["cli"] }) }), S.Object({ right: S.String({ scope: ["cli"] }) })]),
      input: {},
      error: "exactly one union branch"
    },
    {
      name: "normalizes caller-cased keys in the successful branch",
      schema: S.Union([S.Object({ file_path: S.String() }), S.Object({ retry_count: S.Number() })]),
      input: { [fileKey]: "sample" },
      expected: { file_path: "sample" }
    },
    {
      name: "does not leak nested discriminator errors from a rejected branch",
      schema: S.Union([
        S.Object({ count: S.Number() }, { additionalProperties: true }),
        S.Object({ variant: S.OneOf({ discriminator: "kind", branches: { good: S.Object({}) } }) }, { additionalProperties: true })
      ]),
      input: { count: 2, variant: { kind: "other" } },
      expected: { count: 2, variant: { kind: "other" } }
    },
    { name: "preserves explicit nullability", schema: { ...baseSchema, nullable: true }, input: null, expected: null }
  ];

  describe.each([false, true])("reversed=%s", (reversed) => {
    it.each(cases)("$name", async (scenario) => {
      const originalInput = structuredClone(scenario.input);
      const originalSchema = scenario.schema ?? baseSchema;
      const schema = reversed ? { ...originalSchema, branches: [...originalSchema.branches].reverse() } : originalSchema;
      const received: unknown[] = [];
      const config = { name: "check", scope: ["sdk", "mcp"] as const, params: S.Object({ payload: schema }) };
      const command = stream
        ? defineStreamCommand({ ...config, event: S.String(), async *handler({ params }) { received.push(params.payload); yield "ok"; } })
        : defineCommand({ ...config, handler: ({ params }) => { received.push(params.payload); return "ok"; } });
      const root = defineGroup({ name: "audit", children: [command] });

      if (surface === "sdk") {
        const operation = (async () => {
          const result = createSDK(root, { errorReports: false }).check({ payload: scenario.input });
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
            name: "audit__check", arguments: { payload: scenario.input }
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

      expect(received).toEqual(scenario.error === undefined ? [scenario.expected] : []);
      expect(scenario.input).toEqual(originalInput);
    });
  });
});
