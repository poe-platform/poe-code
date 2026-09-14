import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";
import { createMCPServer } from "./mcp.js";
import { createCommandTestHarness } from "./testing/harness.js";

describe.each(["sdk", "mcp", "cli"] as const)("%s Unicode string constraints", (surface) => {
  it.each([
    { value: "😀", minLength: 2, valid: false },
    { value: "😀", maxLength: 1, valid: true },
    { value: "😀a", minLength: 3, valid: false },
    { value: "😀a", maxLength: 1, valid: false },
    { value: "e\u0301", minLength: 2, maxLength: 2, valid: true },
    { value: "\ud800", minLength: 1, maxLength: 1, valid: true },
    { value: "ab", minLength: 2, maxLength: 2, valid: true },
    { value: "", maxLength: 0, valid: true }
  ])("checks code-point length for %j", async ({ value, minLength, maxLength, valid }) => {
    const handler = vi.fn(() => "ok");
    const root = defineGroup({
      name: "audit",
      children: [defineCommand({
        name: "check",
        scope: ["sdk", "mcp", "cli"],
        params: S.Object({ text: S.String({ minLength, maxLength }) }),
        handler
      })]
    });
    const receivedLength = `got string with length ${[...value].length}`;

    if (surface === "sdk") {
      const invocation = createSDK(root, { errorReports: false }).check({ text: value });
      if (valid) await expect(invocation).resolves.toBe("ok");
      else await expect(invocation).rejects.toThrow(receivedLength);
    } else if (surface === "mcp") {
      const server = createMCPServer(root, { name: "audit", version: "1", errorReports: false });
      const session = server.createMessageSession(() => {});
      try {
        await session.handleMessage("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" }
        });
        await session.handleMessage("notifications/initialized");
        const result = await session.handleMessage("tools/call", {
          name: "audit__check",
          arguments: { text: value }
        });
        if (valid) expect(result).not.toHaveProperty("error");
        else expect(result).toMatchObject({ error: { code: -32602, message: expect.stringContaining(receivedLength) } });
      } finally {
        session.close();
      }
    } else {
      const result = await createCommandTestHarness(root).cli(["check", "--text", value]);
      expect(result.exitCode).toBe(valid ? 0 : 1);
      if (!valid) expect(result.stdout).toContain(receivedLength);
    }

    expect(handler).toHaveBeenCalledTimes(valid ? 1 : 0);
  });
});
