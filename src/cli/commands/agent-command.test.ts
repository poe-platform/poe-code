import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import * as agentSpawnModule from "@poe-code/agent-spawn";

const createAgentSessionMock = vi.fn();
const sendMessageMock = vi.fn();
const disposeMock = vi.fn();
const renderAcpEventMock = vi.fn();

vi.mock("@poe-code/poe-agent", () => ({
  createAgentSession: createAgentSessionMock
}));

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("agent command", () => {
  let renderAcpEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createAgentSessionMock.mockReset();
    sendMessageMock.mockReset();
    disposeMock.mockReset();
    renderAcpEventMock.mockReset();
    renderAcpEventSpy = vi.spyOn(agentSpawnModule, "renderAcpEvent" as any).mockImplementation(renderAcpEventMock);
    createAgentSessionMock.mockResolvedValue({
      sendMessage: sendMessageMock,
      dispose: disposeMock
    });
    sendMessageMock.mockResolvedValue({
      role: "assistant",
      content: "Hello from Poe agent"
    });
    disposeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    renderAcpEventSpy?.mockRestore();
  });

  it("creates a session, sends prompt, prints response, and disposes", async () => {
    const logs: string[] = [];
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "agent",
      "Say hello",
      "--model",
      "Claude-Sonnet-4.5",
      "--api-key",
      "test-api-key"
    ]);

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-api-key",
      cwd
    });
    expect(sendMessageMock).toHaveBeenCalledWith("Say hello", expect.objectContaining({
      onSessionUpdate: expect.any(Function)
    }));
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(logs.some((line) => line.includes("Hello from Poe agent"))).toBe(true);
  });

  it("supports global dry-run mode", async () => {
    const logs: string[] = [];
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "agent",
      "Dry run prompt",
      "--model",
      "Claude-Sonnet-4.5",
      "--api-key",
      "test-api-key"
    ]);

    expect(createAgentSessionMock).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes("Dry run:"))).toBe(true);
  });

  it("renders tool events via renderAcpEvent", async () => {
    sendMessageMock.mockImplementation(
      (_prompt: string, opts?: { onSessionUpdate?: (update: unknown) => void }) => {
        opts?.onSessionUpdate?.({
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "list_files",
          kind: "execute",
          status: "pending"
        });
        opts?.onSessionUpdate?.({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          kind: "execute",
          status: "completed",
          rawOutput: "src/\npackage.json"
        });
        opts?.onSessionUpdate?.({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Here are the files." }
        });
        return Promise.resolve({ role: "assistant", content: "Here are the files." });
      }
    );

    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    await program.parseAsync([
      "node", "cli", "agent", "List files",
      "--model", "Claude-Sonnet-4.5", "--api-key", "key"
    ]);

    const events = renderAcpEventMock.mock.calls.map(
      (call: unknown[]) => (call[0] as { event: string }).event
    );
    expect(events).toEqual(["tool_start", "tool_complete"]);
  });

  it("disposes the session when message send fails", async () => {
    sendMessageMock.mockRejectedValue(new Error("message failed"));

    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "agent",
        "Trigger failure",
        "--model",
        "Claude-Sonnet-4.5"
      ])
    ).rejects.toThrow("message failed");

    expect(disposeMock).toHaveBeenCalledTimes(1);
  });
});
