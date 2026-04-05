import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnAcp } from "./spawn-acp.js";
import type { AcpEvent } from "./types.js";

vi.mock("@poe-code/poe-acp-client", () => {
  const initResponse = { protocolVersion: 1 };
  const newSessionResponse = { sessionId: "ses_test_123" };

  class MockAcpClient {
    initialize = vi.fn().mockResolvedValue(initResponse);
    newSession = vi.fn().mockResolvedValue(newSessionResponse);
    prompt = vi.fn().mockImplementation(() => {
      const notifications = [
        {
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Hello " },
            },
          },
        },
        {
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "world!" },
            },
          },
        },
      ];

      return {
        response: Promise.resolve({ stopReason: "completed" }),
        [Symbol.asyncIterator]: async function* () {
          for (const n of notifications) yield n;
        },
      };
    });
    dispose = vi.fn().mockResolvedValue(undefined);
  }

  return { AcpClient: MockAcpClient };
});

async function collect(iterable: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const items: AcpEvent[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("spawnAcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams agent message events and resolves with exit code 0", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "Say hello",
      cwd: "/tmp/test",
    });

    const collected = await collect(events);
    const result = await done;

    expect(collected[0]).toEqual({ event: "session_start", threadId: "ses_test_123" });
    expect(collected[1]).toEqual({ event: "agent_message", text: "Hello " });
    expect(collected[2]).toEqual({ event: "agent_message", text: "world!" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello world!\n");
    expect(result.sessionId).toBe("ses_test_123");
    expect(result.threadId).toBe("ses_test_123");
  });

  it("throws for agents without ACP spawn config", () => {
    expect(() =>
      spawnAcp({
        agentId: "claude-code",
        prompt: "test",
      })
    ).toThrow('does not support ACP spawn');
  });

  it("throws when signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() =>
      spawnAcp({
        agentId: "opencode",
        prompt: "test",
        signal: controller.signal,
      })
    ).toThrow("Agent spawn aborted");
  });
});
