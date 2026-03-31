import { describe, expect, it } from "bun:test";
import { McpClient, createMockProgressServer, createSdkTestPair } from "./internal.js";

describe("McpClient SDK integration progress", () => {
  it("calls tool with progressToken, receives progress updates, then receives result", async () => {
    const progressToken = "sdk-progress-1";
    const progressUpdates: Array<{ progressToken: string | number; progress: number }> = [];
    const eventOrder: string[] = [];
    const server = await createMockProgressServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onProgress: async (params) => {
          progressUpdates.push({
            progressToken: params.progressToken,
            progress: params.progress,
          });
          eventOrder.push(`progress:${params.progress}`);
        },
      })
    );

    try {
      const result = await client.callTool(
        {
          name: "slow_task",
        },
        { progressToken }
      );
      eventOrder.push("result");

      expect(result).toEqual({
        content: [{ type: "text", text: "slow_task complete" }],
      });
      expect(progressUpdates).toHaveLength(4);
      expect(progressUpdates.map((update) => update.progressToken)).toEqual([
        progressToken,
        progressToken,
        progressToken,
        progressToken,
      ]);
      expect(eventOrder).toEqual([
        "progress:1",
        "progress:2",
        "progress:3",
        "progress:4",
        "result",
      ]);
    } finally {
      await cleanup();
    }
  });

  it("reports increasing progress values", async () => {
    const progressToken = "sdk-progress-2";
    const observedProgressValues: number[] = [];
    const server = await createMockProgressServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onProgress: async (params) => {
          observedProgressValues.push(params.progress);
        },
      })
    );

    try {
      const result = await client.callTool(
        {
          name: "slow_task",
        },
        { progressToken }
      );

      expect(result).toEqual({
        content: [{ type: "text", text: "slow_task complete" }],
      });
      expect(observedProgressValues).toHaveLength(4);

      for (let index = 1; index < observedProgressValues.length; index += 1) {
        expect(observedProgressValues[index]).toBeGreaterThan(observedProgressValues[index - 1]);
      }
    } finally {
      await cleanup();
    }
  });
});
