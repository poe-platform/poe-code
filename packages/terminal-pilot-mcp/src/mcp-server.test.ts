import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestPair, type TestPair } from "tiny-stdio-mcp-server/testing";
import packageJson from "../package.json" with { type: "json" };
import { createTerminalPilotMcpServer, main } from "./mcp-server.js";
import type { TerminalPilot } from "terminal-pilot";

const EXPECTED_TOOL_NAMES = [
  "terminal_create_session",
  "terminal_fill",
  "terminal_type",
  "terminal_press_key",
  "terminal_send_signal",
  "terminal_wait_for",
  "terminal_wait_for_exit",
  "terminal_read_screen",
  "terminal_read_history",
  "terminal_resize",
  "terminal_close_session",
  "terminal_get_session",
  "terminal_list_sessions"
];

describe("terminal-pilot MCP server", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair !== null) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("creates the server successfully", async () => {
    const server = createTerminalPilotMcpServer({} as TerminalPilot);
    testPair = await createTestPair(server);

    const serverInfo = testPair.client.getServerVersion();
    expect(serverInfo).toEqual({
      name: "terminal-pilot",
      version: packageJson.version
    });
  });

  it("registers all 13 terminal tools", async () => {
    const server = createTerminalPilotMcpServer({} as TerminalPilot);
    testPair = await createTestPair(server);

    const result = await testPair.client.listTools();
    expect(result.tools).toHaveLength(13);
    expect(result.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("closes the agent when server.listen fails", async () => {
    const agent = {
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as TerminalPilot;

    const listenError = new Error("listen failed");
    const listen = vi.fn().mockRejectedValue(listenError);
    const runtimeProcess = new EventEmitter() as EventEmitter & Pick<typeof process, "on" | "off">;
    const launchAgent = vi.fn().mockResolvedValue(agent);
    const createMcpServer = vi.fn(() => ({ listen }));

    await expect(
      main({
        launchAgent,
        createMcpServer: createMcpServer as never,
        runtimeProcess
      })
    ).rejects.toThrow(listenError);

    expect(agent.close).toHaveBeenCalledTimes(1);

    runtimeProcess.emit("exit", 0);
    expect(agent.close).toHaveBeenCalledTimes(1);
  });

  it("starts listening and closes the agent on stop", async () => {
    const agent = {
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as TerminalPilot;

    let resolveListen: (() => void) | undefined;
    const listen = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveListen = resolve;
        })
    );

    const runtimeProcess = new EventEmitter() as EventEmitter & Pick<typeof process, "on" | "off">;
    const launchAgent = vi.fn().mockResolvedValue(agent);
    const createMcpServer = vi.fn(() => ({ listen }));

    const mainPromise = main({
      launchAgent,
      createMcpServer: createMcpServer as never,
      runtimeProcess
    });

    await vi.waitFor(() => {
      expect(launchAgent).toHaveBeenCalledTimes(1);
      expect(createMcpServer).toHaveBeenCalledWith(agent);
      expect(listen).toHaveBeenCalledTimes(1);
    });

    runtimeProcess.emit("exit", 0);

    await vi.waitFor(() => {
      expect(agent.close).toHaveBeenCalledTimes(1);
    });

    resolveListen?.();
    await mainPromise;

    runtimeProcess.emit("exit", 0);
    expect(agent.close).toHaveBeenCalledTimes(1);
  });
});
