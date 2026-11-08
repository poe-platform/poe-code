import { expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";
import { createSDK } from "./sdk.js";

it("accepts declared null enum values through CLI and SDK", async () => {
  const previousExitCode = process.exitCode;
  const handler = vi.fn(({ params }: { params: { value: null } }) => params.value);
  const root = defineGroup({ name: "audit", children: [defineCommand({
    name: "value", scope: ["cli", "sdk"], params: S.Object({ value: S.Enum([null]) }), handler
  })] });
  try {
    process.exitCode = 0;
    await runCLI(root, {
      argv: ["node", "audit", "value", "--value", "null"], errorReports: false, outputEmitter: () => {}
    });
    expect(process.exitCode).toBe(0);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ params: { value: null } });
    await expect(createSDK(root, { errorReports: false }).value({ value: null })).resolves.toBe(null);
    expect(handler).toHaveBeenCalledTimes(2);
  } finally { process.exitCode = previousExitCode; }
});
