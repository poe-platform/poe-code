import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { UserError, defineCommand, defineGroup } from "../index.js";
import { createCommandTestHarness } from "./harness.js";

function createParityHarness() {
  return createCommandTestHarness(
    defineGroup({
      name: "parity-fixture",
      children: [
        defineCommand({
          name: "greet-user",
          scope: ["cli", "mcp", "sdk"],
          positional: ["name"],
          params: S.Object({
            name: S.String(),
            age: S.Number(),
            excited: S.Optional(S.Boolean()),
            sdkOnly: S.Optional(S.String({ scope: ["sdk"] }))
          }),
          handler: async ({ params }) => ({
            greeting: `Hello, ${params.name}${params.excited ? "!" : "."}`,
            ...(params.sdkOnly === undefined ? {} : { sdkOnly: params.sdkOnly })
          })
        })
      ]
    })
  );
}

function createPayloadHarness() {
  return createCommandTestHarness(
    defineGroup({
      name: "payload-fixture",
      children: [
        defineCommand({
          name: "echo-payload",
          scope: ["cli", "mcp", "sdk"],
          params: S.Object({
            dryRun: S.Boolean(),
            metadata: S.Json(),
            labels: S.Record(S.String()),
            nested: S.Object({ displayName: S.String() })
          }),
          handler: async ({ params }) => params
        })
      ]
    })
  );
}

describe("CommandTestHarness parity", () => {
  it("agrees for a successful case across real adapters", async () => {
    const result = await createParityHarness().parity(["greet-user"], {
      name: "Ada",
      age: 37,
      excited: true
    });

    expect(result).toEqual({
      sdk: { ok: true, value: { greeting: "Hello, Ada!" }, error: undefined },
      mcp: { ok: true, value: { greeting: "Hello, Ada!" }, error: undefined },
      cli: { ok: true, value: { greeting: "Hello, Ada!" }, error: undefined },
      agree: true
    });
  });

  it("agrees for validation failures across real adapters", async () => {
    const result = await createParityHarness().parity(["greet-user"], { name: "Ada" });

    expect(result.agree).toBe(true);
    for (const outcome of [result.sdk, result.mcp, result.cli]) {
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toBeInstanceOf(UserError);
      expect(outcome.error).toHaveProperty("message", expect.any(String));
    }
  });

  it("explains disagreements caused by surface-scoped params", async () => {
    const result = await createParityHarness().parity(["greet-user"], {
      name: "Ada",
      age: 37,
      sdkOnly: "sdk-value"
    });

    expect(result.agree).toBe(false);
    expect(result.diff).toContain("sdk");
    expect(result.diff).toContain("mcp");
    expect(result.diff).toContain("cli");
    expect(result.diff).toContain("sdkOnly");
  });

  it("preserves false booleans and data-owned keys", async () => {
    const result = await createPayloadHarness().parity(["echo-payload"], {
      dryRun: false,
      metadata: { keepCamelCase: true },
      labels: { keepCamelCase: "yes" },
      nested: { displayName: "Ada" }
    });

    expect(result.agree, result.diff).toBe(true);
    expect(result.sdk.value).toEqual({
      dryRun: false,
      metadata: { keepCamelCase: true },
      labels: { keepCamelCase: "yes" },
      nested: { displayName: "Ada" }
    });
  });

  it("reports commands excluded from a surface", async () => {
    const harness = createCommandTestHarness(
      defineGroup({
        name: "command-scope-fixture",
        children: [
          defineCommand({
            name: "sdk-command",
            scope: ["sdk"],
            params: S.Object({}),
            handler: async () => "sdk-only"
          })
        ]
      })
    );

    const result = await harness.parity(["sdk-command"]);

    expect(result.agree).toBe(false);
    expect(result.sdk).toMatchObject({ ok: true, value: "sdk-only" });
    expect(result.mcp.error).toMatchObject({
      name: "SurfaceScopeError",
      message: expect.stringContaining("filtered out of the mcp surface")
    });
    expect(result.cli.error).toMatchObject({
      name: "SurfaceScopeError",
      message: expect.stringContaining("filtered out of the cli surface")
    });
    expect(result.diff).toContain("SurfaceScopeError");
  });

  it.each(["true", "42", "null", '{"looks":"json"}'])(
    "preserves ambiguous MCP text output %j",
    async (value) => {
      const harness = createCommandTestHarness(
        defineGroup({
          name: "text-fixture",
          children: [
            defineCommand({
              name: "echo-text",
              scope: ["cli", "mcp", "sdk"],
              params: S.Object({ value: S.String() }),
              handler: async ({ params }) => params.value
            })
          ]
        })
      );

      const result = await harness.parity(["echo-text"], { value });

      expect(result.agree, result.diff).toBe(true);
      expect(result.mcp.value).toBe(value);
    }
  );

  it("normalizes user errors across adapter transports", async () => {
    const harness = createCommandTestHarness(
      defineGroup({
        name: "error-fixture",
        children: [
          defineCommand({
            name: "fail",
            scope: ["cli", "mcp", "sdk"],
            params: S.Object({}),
            handler: async () => {
              throw new UserError("Expected failure.");
            }
          })
        ]
      })
    );

    const result = await harness.parity(["fail"]);

    expect(result.agree, result.diff).toBe(true);
    for (const outcome of [result.sdk, result.mcp, result.cli]) {
      expect(outcome.error).toEqual(expect.objectContaining({ message: "Expected failure." }));
      expect(outcome.error).toBeInstanceOf(UserError);
    }
  });
});
