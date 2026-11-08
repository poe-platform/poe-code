import { expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "./index.js";
import { S } from "toolcraft-schema";
import { convertJsonSchema } from "./json-schema-converter.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";
import { runCLI } from "./cli.js";

it("rejects undeclared JSON literals before CLI, SDK and MCP handlers", async () => {
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({
    name: "value", scope: ["cli", "sdk", "mcp"],
    params: S.Object({ value: convertJsonSchema({ enum: [{ status: "ready" }, [1, 2]] }) }), handler
  })] });
  const session = createMCPServer(root, { name: "audit", version: "1", errorReports: false })
    .createMessageSession(() => undefined);
  const previousExitCode = process.exitCode;
  try {
    const rejected = { status: "wrong" };
    await expect(createSDK(root, { errorReports: false }).value({ value: rejected })).rejects.toThrow();
    process.exitCode = 0;
    await runCLI(root, { argv: ["node", "audit", "value", "--value", JSON.stringify(rejected)],
      errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(1);
    await session.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    expect(await session.handleMessage("tools/call", { name: "audit__value", arguments: { value: rejected } }))
      .toMatchObject({ error: { code: -32602 } });
    expect(handler).not.toHaveBeenCalled();
    await expect(createSDK(root, { errorReports: false }).value({ value: [1, 2] })).resolves.toBe("accepted");
    expect(await session.handleMessage("tools/call", { name: "audit__value", arguments: { value: { status: "ready" } } }))
      .toHaveProperty("result");
    expect(handler).toHaveBeenCalledTimes(2);
  } finally { process.exitCode = previousExitCode; session.close(); }
});

it("rejects undeclared literals in dynamic CLI entries", async () => {
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value",
    params: S.Object({ entries: S.Record(S.Object({ value: S.Json({ const: { ready: true } }) })) }), handler
  })] });
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = 0;
    await runCLI(root, { argv: ["node", "audit", "value", "--entries.alpha.value", '{"ready":false}'],
      errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  } finally { process.exitCode = previousExitCode; }
});
