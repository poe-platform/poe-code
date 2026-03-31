import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import * as designSystem from "@poe-code/design-system";

import { renderAcpEvent, renderAcpStream } from "./renderer.js";

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
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(designSystem.acp, "renderAgentMessage").mockImplementation(() => {});
    vi.spyOn(designSystem.acp, "renderToolStart").mockImplementation(() => {});
    vi.spyOn(designSystem.acp, "renderToolComplete").mockImplementation(() => {});
    vi.spyOn(designSystem.acp, "renderReasoning").mockImplementation(() => {});
    vi.spyOn(designSystem.acp, "renderUsage").mockImplementation(() => {});
    vi.spyOn(designSystem.acp, "renderError").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores session_start events (no output)", async () => {
    const output = captureStdout(() => renderAcpEvent({ event: "session_start" } as any));

    expect(output).toBe("");
    expect(designSystem.acp.renderAgentMessage).not.toHaveBeenCalled();
    expect(designSystem.acp.renderToolStart).not.toHaveBeenCalled();
    expect(designSystem.acp.renderToolComplete).not.toHaveBeenCalled();
    expect(designSystem.acp.renderReasoning).not.toHaveBeenCalled();
    expect(designSystem.acp.renderUsage).not.toHaveBeenCalled();
    expect(designSystem.acp.renderError).not.toHaveBeenCalled();
  });

  it("renders agent_message via design-system", async () => {
    renderAcpEvent({ event: "agent_message", text: "hello" } as any);

    expect(designSystem.acp.renderAgentMessage).toHaveBeenCalledWith("hello");
  });

  it("renders tool_start via design-system", async () => {
    renderAcpEvent({ event: "tool_start", kind: "read", title: "README.md" } as any);

    expect(designSystem.acp.renderToolStart).toHaveBeenCalledWith("read", "README.md");
  });

  it("renders tool_complete via design-system (kind only, no output)", async () => {
    renderAcpEvent({ event: "tool_complete", kind: "read", path: "README.md" } as any);

    expect(designSystem.acp.renderToolComplete).toHaveBeenCalledWith("read");
  });

  it("renders reasoning via design-system", async () => {
    renderAcpEvent({ event: "reasoning", text: "thinking..." } as any);

    expect(designSystem.acp.renderReasoning).toHaveBeenCalledWith("thinking...");
  });

  it("renders usage via design-system", async () => {
    renderAcpEvent({
      event: "usage",
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 3,
      costUsd: 0.04
    } as any);

    expect(designSystem.acp.renderUsage).toHaveBeenCalledWith({
      input: 1,
      output: 2,
      cached: 3,
      costUsd: 0.04
    });
  });

  it("renders error via design-system", async () => {
    renderAcpEvent({ event: "error", message: "nope" } as any);

    expect(designSystem.acp.renderError).toHaveBeenCalledWith("nope");
  });

  it("includes stack trace when present on error events", async () => {
    renderAcpEvent({ event: "error", message: "nope", stack: "stack line 1" } as any);

    expect(designSystem.acp.renderError).toHaveBeenCalledWith("nope\nstack line 1");
  });

  it("renders unknown event types as muted text showing the type", async () => {
    const output = captureStdout(() => renderAcpEvent({ event: "some_future_event" } as any));

    expect(output).toContain("some_future_event");
    expect(designSystem.acp.renderAgentMessage).not.toHaveBeenCalled();
  });

  it("renderAcpStream buffers consecutive agent_message events and flushes at end", async () => {
    const events = [
      { event: "agent_message", text: "a" },
      { event: "agent_message", text: "b" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(designSystem.acp.renderAgentMessage).toHaveBeenCalledTimes(1);
    expect(designSystem.acp.renderAgentMessage).toHaveBeenCalledWith("ab");
  });

  it("renderAcpStream flushes buffer when non-agent_message event arrives", async () => {
    const events = [
      { event: "agent_message", text: "hello " },
      { event: "agent_message", text: "world" },
      { event: "tool_start", kind: "read", title: "file.txt" },
      { event: "agent_message", text: "done" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(designSystem.acp.renderAgentMessage).toHaveBeenCalledTimes(2);
    expect(designSystem.acp.renderAgentMessage).toHaveBeenNthCalledWith(1, "hello world");
    expect(designSystem.acp.renderAgentMessage).toHaveBeenNthCalledWith(2, "done");
    expect(designSystem.acp.renderToolStart).toHaveBeenCalledWith("read", "file.txt");
  });
});
