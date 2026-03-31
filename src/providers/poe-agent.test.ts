import { describe, it, expect, vi, beforeEach } from "bun:test";
import { provider as poeAgentProvider, spawnPoeAgentWithAcp } from "./poe-agent.js";
import { DEFAULT_FRONTIER_MODEL } from "../cli/constants.js";
import { AcpClient } from "@poe-code/poe-acp-client";

const createAgentSessionMock = vi.fn();
const sendMessageMock = vi.fn();
const disposeMock = vi.fn();

vi.mock("@poe-code/poe-agent", () => ({
  createAgentSession: createAgentSessionMock
}));

describe("poe-agent provider", () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset();
    sendMessageMock.mockReset();
    disposeMock.mockReset();

    sendMessageMock.mockImplementation(
      async (
        _prompt: string,
        options?: { onSessionUpdate?: (update: unknown) => void }
      ) => {
        options?.onSessionUpdate?.({
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "run command",
          kind: "execute",
          status: "pending"
        });
        options?.onSessionUpdate?.({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          kind: "execute",
          status: "in_progress"
        });
        options?.onSessionUpdate?.({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          kind: "execute",
          status: "completed",
          rawOutput: "ok"
        });
        options?.onSessionUpdate?.({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Poe agent output" }
        });

        return {
          role: "assistant",
          content: "Poe agent output"
        };
      }
    );
    disposeMock.mockResolvedValue(undefined);
    createAgentSessionMock.mockResolvedValue({
      sendMessage: sendMessageMock,
      dispose: disposeMock
    });
  });

  it("declares provider metadata", () => {
    expect(poeAgentProvider.id).toBe("poe-agent");
    expect(poeAgentProvider.name).toBe("poe-agent");
    expect(poeAgentProvider.label).toBe("Poe Agent");
    expect(poeAgentProvider.summary).toBe(
      "Run one-shot prompts with the built-in Poe agent runtime."
    );
    expect(poeAgentProvider.spawn).toBeUndefined();
    expect(poeAgentProvider.supportsMcpSpawn).toBeUndefined();
  });

  it("runs poe-agent via ACP host lifecycle", async () => {
    const initializeSpy = vi.spyOn(AcpClient.prototype, "initialize");
    const newSessionSpy = vi.spyOn(AcpClient.prototype, "newSession");
    const promptSpy = vi.spyOn(AcpClient.prototype, "prompt");

    const { events, done } = spawnPoeAgentWithAcp({
      prompt: "Summarize this diff",
      model: "anthropic/claude-opus-4.6",
      cwd: "/workspace/project",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
    const received: unknown[] = [];
    const collectPromise = (async () => {
      for await (const event of events) {
        received.push(event);
      }
    })();
    const result = await done;
    await collectPromise;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: "anthropic/claude-opus-4.6",
      cwd: "/workspace/project",
      mcpServers: {
        test: {
          transport: "stdio",
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
    expect(initializeSpy).toHaveBeenCalledTimes(1);
    expect(newSessionSpy).toHaveBeenCalledTimes(1);
    expect(newSessionSpy).toHaveBeenCalledWith("/workspace/project", []);
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledWith(
      expect.any(String),
      [{ type: "text", text: "Summarize this diff" }]
    );
    expect(
      initializeSpy.mock.invocationCallOrder[0]
    ).toBeLessThan(newSessionSpy.mock.invocationCallOrder[0]);
    expect(
      newSessionSpy.mock.invocationCallOrder[0]
    ).toBeLessThan(promptSpy.mock.invocationCallOrder[0]);
    expect(sendMessageMock).toHaveBeenCalledWith(
      "Summarize this diff",
      expect.objectContaining({
        onSessionUpdate: expect.any(Function)
      })
    );
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      { event: "session_start", threadId: "poe-agent-session-1" },
      {
        event: "tool_start",
        kind: "exec",
        title: "run command",
        id: "tool-1"
      },
      {
        event: "tool_complete",
        kind: "exec",
        path: "ok",
        id: "tool-1"
      },
      { event: "agent_message", text: "Poe agent output" }
    ]);
    expect(result).toEqual({
      stdout: "Poe agent output\n",
      stderr: "",
      exitCode: 0,
      threadId: "poe-agent-session-1",
      sessionId: "poe-agent-session-1"
    });

    initializeSpy.mockRestore();
    newSessionSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("uses default model when none is provided", async () => {
    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function"
    });
    await done;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: process.cwd(),
    });
  });

  it("forwards baseUrl override to createAgentSession", async () => {
    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function",
      baseUrl: "http://proxy.example.com/v1",
    });
    await done;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: process.cwd(),
      baseUrl: "http://proxy.example.com/v1",
    });
  });

});
