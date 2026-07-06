import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer, defineSchema } from "./index.js";
import { createHttpTestPair, type HttpTestPair } from "./testing.js";

describe("structured tool output SDK interoperability", () => {
  let pair: HttpTestPair | undefined;

  afterEach(async () => {
    await pair?.cleanup();
    pair = undefined;
  });

  it("advertises and validates union, enum, nullable, and referenced schemas", async () => {
    const outputSchema = {
      type: "object" as const,
      $defs: {
        state: { type: "string", enum: ["ready", "pending"] }
      },
      properties: {
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
        state: { $ref: "#/$defs/state" },
        note: { type: ["string", "null"] }
      },
      required: ["value", "state", "note"],
      additionalProperties: false
    };
    const server = createHttpServer({ name: "structured-interop", version: "1.0.0" }).registerTool(
      {
        name: "inspect",
        inputSchema: {
          type: "object",
          properties: {
            value: { anyOf: [{ type: "string" }, { type: "number" }] },
            state: { enum: ["ready", "pending"] },
            note: { type: ["string", "null"] }
          },
          required: ["value", "state", "note"],
          additionalProperties: false
        },
        outputSchema
      },
      ({ value, state, note }) => ({ value, state, note })
    );
    pair = await createHttpTestPair(server);

    await expect(pair.client.listTools()).resolves.toMatchObject({
      tools: [{ name: "inspect", outputSchema }]
    });
    await expect(
      pair.client.callTool({
        name: "inspect",
        arguments: { value: 7, state: "ready", note: null }
      })
    ).resolves.toMatchObject({
      structuredContent: { value: 7, state: "ready", note: null }
    });
    await expect(
      pair.client.callTool({
        name: "inspect",
        arguments: { value: false, state: "invalid", note: null }
      })
    ).rejects.toMatchObject({ code: -32602, data: expect.any(Array) });
  });

  it("round-trips explicit tool errors without protocol errors", async () => {
    const server = createHttpServer({ name: "structured-errors", version: "1.0.0" }).registerTool(
      {
        name: "failure",
        inputSchema: defineSchema({}),
        outputSchema: defineSchema({ value: { type: "string" } })
      },
      () => ({ content: [{ type: "text", text: "expected failure" }], isError: true })
    );
    pair = await createHttpTestPair(server);

    await expect(pair.client.callTool({ name: "failure", arguments: {} })).resolves.toEqual({
      content: [{ type: "text", text: "expected failure" }],
      isError: true
    });
  });

  it("preserves handler content and structured content together", async () => {
    const server = createHttpServer({ name: "structured-content", version: "1.0.0" }).registerTool(
      {
        name: "content",
        inputSchema: defineSchema({}),
        outputSchema: defineSchema({ value: { type: "string" } })
      },
      () => ({
        content: [{ type: "text", text: "human-readable" }],
        structuredContent: { value: "machine-readable" }
      })
    );
    pair = await createHttpTestPair(server);

    await expect(pair.client.callTool({ name: "content", arguments: {} })).resolves.toEqual({
      content: [{ type: "text", text: "human-readable" }],
      structuredContent: { value: "machine-readable" }
    });
  });

  it("returns formatted and raw Ajv details for invalid structured output", async () => {
    const server = createHttpServer({
      name: "structured-validation",
      version: "1.0.0"
    }).registerTool(
      {
        name: "invalid-output",
        inputSchema: defineSchema({}),
        outputSchema: defineSchema({ count: { type: "integer", minimum: 1 } }, ["count"])
      },
      () => ({ count: 0 })
    );
    pair = await createHttpTestPair(server);

    await expect(
      pair.client.callTool({ name: "invalid-output", arguments: {} })
    ).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining("must be >= 1"),
      data: [expect.objectContaining({ keyword: "minimum" })]
    });
  });
});
