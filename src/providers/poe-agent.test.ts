import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCliEnvironment } from "../cli/environment.js";
import type { ProviderContext } from "../cli/service-registry.js";
import { provider as poeAgentProvider } from "./poe-agent.js";
import { getDefaultProviders } from "./index.js";
import { DEFAULT_FRONTIER_MODEL } from "../cli/constants.js";
import { AcpClient } from "@poe-code/poe-acp-client";

const createAgentSessionMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/poe-agent", () => ({
  createAgentSession: createAgentSessionMock
}));

function createProviderContext(
  variables?: Record<string, string | undefined>,
): ProviderContext {
  return {
    env: createCliEnvironment({
      cwd: "/repo",
      homeDir: "/home/test",
      variables: variables ?? {},
    }),
    command: {} as ProviderContext["command"],
    logger: {} as ProviderContext["logger"],
    runCheck: vi.fn()
  };
}

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
    expect(poeAgentProvider.supportsMcpSpawn).toBe(true);
  });

  it("delegates spawn to createAgentSession", async () => {
    const context = createProviderContext();
    const initializeSpy = vi.spyOn(AcpClient.prototype, "initialize");
    const newSessionSpy = vi.spyOn(AcpClient.prototype, "newSession");
    const promptSpy = vi.spyOn(AcpClient.prototype, "prompt");

    const result = await poeAgentProvider.spawn?.(context, {
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

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: "anthropic/claude-opus-4.6",
      cwd: "/workspace/project",
      baseUrl: "https://api.poe.com/v1",
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
    expect(result).toEqual({
      stdout: "Poe agent output\n",
      stderr: "",
      exitCode: 0
    });

    initializeSpy.mockRestore();
    newSessionSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("uses default model when none is provided", async () => {
    const context = createProviderContext();

    await poeAgentProvider.spawn?.(context, {
      prompt: "Explain this function"
    });

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: "/repo",
      baseUrl: "https://api.poe.com/v1",
    });
  });

  it("forwards POE_BASE_URL override to createAgentSession", async () => {
    const context = createProviderContext({
      POE_BASE_URL: "http://proxy.example.com",
    });

    await poeAgentProvider.spawn?.(context, {
      prompt: "Explain this function",
    });

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: "/repo",
      baseUrl: "http://proxy.example.com/v1",
    });
  });

  it("is auto-discovered by the provider loader", () => {
    const names = getDefaultProviders().map((entry) => entry.name);
    expect(names).toContain("poe-agent");
  });
});
