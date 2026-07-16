import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const createAgentSessionMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const getHistoryMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

vi.mock("@poe-code/poe-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/poe-agent")>();
  return {
    ...actual,
    createAgentSession: createAgentSessionMock,
    parseNullablePluginConfigEntries: (value: unknown) => value,
    parsePluginConfigEntries: (value: unknown) => value
  };
});

const { spawnPoeAgentWithAcp } = await import("./poe-agent.js");

const homeDir = "/home/test";

describe("poe-agent default config filesystem", () => {
  beforeEach(() => {
    vol.reset();
    createAgentSessionMock.mockReset();
    sendMessageMock.mockReset();
    getHistoryMock.mockReset();
    disposeMock.mockReset();

    sendMessageMock.mockImplementation(
      async (_prompt: string, options?: { onSessionUpdate?: (update: unknown) => void }) => {
        options?.onSessionUpdate?.({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" }
        });
        return { role: "assistant", content: "hi" };
      }
    );
    getHistoryMock.mockReturnValue([
      { role: "user", content: "say hi" },
      { role: "assistant", content: "hi" }
    ]);
    disposeMock.mockResolvedValue(undefined);
    createAgentSessionMock.mockResolvedValue({
      sendMessage: sendMessageMock,
      getHistory: getHistoryMock,
      dispose: disposeMock
    });
  });

  it("reads plugin config through the default filesystem without crashing", async () => {
    vol.fromJSON(
      {
        ".poe-code/config.json": `${JSON.stringify({
          agent: { plugins: [{ id: "memory" }] }
        })}\n`
      },
      homeDir
    );

    const { done } = spawnPoeAgentWithAcp({
      prompt: "say hi",
      cwd: "/workspace/project",
      homeDir
    });

    await expect(done).resolves.toMatchObject({ exitCode: 0, stdout: "hi\n" });
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ pluginsConfig: [{ id: "memory" }] })
    );
  });
});
