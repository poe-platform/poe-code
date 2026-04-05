import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@poe-code/design-system", () => {
  return {
    acp: {
      renderAgentMessage: vi.fn(),
      renderToolStart: vi.fn(),
      renderToolComplete: vi.fn(),
      renderReasoning: vi.fn(),
      renderUsage: vi.fn(),
      renderError: vi.fn()
    },
    text: {
      muted: (content: string) => `<muted>${content}</muted>`
    },
    resolveOutputFormat: () => (process.env.OUTPUT_FORMAT === "json" ? "json" : "terminal")
  };
});

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

function captureStdout(run: () => void): string {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

  try {
    run();
  } finally {
    spy.mockRestore();
  }

  return chunks.join("");
}

describe("acp/renderer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it("ignores session_start events (no output)", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    const output = captureStdout(() => renderAcpEvent({ event: "session_start" } as any));

    expect(output).toBe("");
    expect(acp.renderAgentMessage).not.toHaveBeenCalled();
    expect(acp.renderToolStart).not.toHaveBeenCalled();
    expect(acp.renderToolComplete).not.toHaveBeenCalled();
    expect(acp.renderReasoning).not.toHaveBeenCalled();
    expect(acp.renderUsage).not.toHaveBeenCalled();
    expect(acp.renderError).not.toHaveBeenCalled();
  });

  it("renders agent_message via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    renderAcpEvent({ event: "agent_message", text: "hello" } as any);

    expect(acp.renderAgentMessage).toHaveBeenCalledWith("hello");
  });

  it("renders tool_start via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    renderAcpEvent({ event: "tool_start", kind: "read", title: "README.md" } as any);

    expect(acp.renderToolStart).toHaveBeenCalledWith("read", "README.md");
  });

  it("renders tool_complete via design-system (kind only, no output)", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    renderAcpEvent({ event: "tool_complete", kind: "read", path: "README.md" } as any);

    expect(acp.renderToolComplete).toHaveBeenCalledWith("read");
  });

  it("renders reasoning via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    renderAcpEvent({ event: "reasoning", text: "thinking..." } as any);

    expect(acp.renderReasoning).toHaveBeenCalledWith("thinking...");
  });

  it("renders usage via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    renderAcpEvent({
      event: "usage",
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 3,
      costUsd: 0.04
    } as any);

    expect(acp.renderUsage).toHaveBeenCalledWith({
      input: 1,
      output: 2,
      cached: 3,
      costUsd: 0.04
    });
  });

  it("renders error via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    renderAcpEvent({ event: "error", message: "nope" } as any);

    expect(acp.renderError).toHaveBeenCalledWith("nope");
  });

  it("includes stack trace when present on error events", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    renderAcpEvent({ event: "error", message: "nope", stack: "stack line 1" } as any);

    expect(acp.renderError).toHaveBeenCalledWith("nope\nstack line 1");
  });

  it("renders unknown event types as muted text showing the type", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    const output = captureStdout(() => renderAcpEvent({ event: "some_future_event" } as any));

    expect(output).toBe("<muted>some_future_event</muted>\n");
    expect(acp.renderAgentMessage).not.toHaveBeenCalled();
  });

  it("renders spawn_result as raw NDJSON in json mode", async () => {
    process.env.OUTPUT_FORMAT = "json";

    const { renderAcpEvent } = await import("./renderer.js");

    const output = captureStdout(() =>
      renderAcpEvent({
        event: "spawn_result",
        exitCode: 0,
        threadId: "thread_123",
        usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, costUsd: 0.03 },
        protocolVersion: 1
      } as any)
    );

    expect(output).toBe(
      `${JSON.stringify({
        event: "spawn_result",
        exitCode: 0,
        threadId: "thread_123",
        usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, costUsd: 0.03 },
        protocolVersion: 1
      })}\n`
    );
  });

  it("renderAcpStream buffers consecutive agent_message events and flushes at end", async () => {
    const { renderAcpStream } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    const events = [
      { event: "agent_message", text: "a" },
      { event: "agent_message", text: "b" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(acp.renderAgentMessage).toHaveBeenCalledTimes(1);
    expect(acp.renderAgentMessage).toHaveBeenCalledWith("ab");
  });

  it("renderAcpStream flushes buffer when non-agent_message event arrives", async () => {
    const { renderAcpStream } = await import("./renderer.js");
    const { acp } = await import("@poe-code/design-system");

    const events = [
      { event: "agent_message", text: "hello " },
      { event: "agent_message", text: "world" },
      { event: "tool_start", kind: "read", title: "file.txt" },
      { event: "agent_message", text: "done" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(acp.renderAgentMessage).toHaveBeenCalledTimes(2);
    expect(acp.renderAgentMessage).toHaveBeenNthCalledWith(1, "hello world");
    expect(acp.renderAgentMessage).toHaveBeenNthCalledWith(2, "done");
    expect(acp.renderToolStart).toHaveBeenCalledWith("read", "file.txt");
  });
});
