import type { AcpEvent, AcpSpawnContext } from "@poe-code/agent-spawn";
import { describe, expect, it } from "vitest";

import { acpToTrace } from "./trace.js";

describe("acpToTrace", () => {
  it("builds a root span with no children and metrics from ctx.usage for an empty event list", () => {
    const trace = acpToTrace(
      createContext({
        events: [],
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cachedTokens: 3,
          durationMs: 125
        }
      })
    );

    expect(trace.root).toMatchObject({
      name: "agent:codex:gpt-5",
      kind: "agent",
      output: "",
      metadata: {
        sessionId: "session-1",
        threadId: "thread-1"
      },
      metrics: {
        prompt_tokens: 11,
        completion_tokens: 7,
        tokens: 18,
        prompt_cached_tokens: 3,
        durationMs: 125
      },
      children: []
    });
  });

  it("builds one child span for a tool_call and merges update metadata into endTs", () => {
    const events = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        kind: "read",
        input: { path: "README.md" },
        _meta: { ts: 100, toolName: "Read" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        content: [{ type: "text", text: "contents" }],
        _meta: { ts: 250, statusText: "done" }
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(createContext({ events }));

    expect(trace.root.children).toEqual([
      {
        name: "tool_call:read",
        kind: "tool",
        input: { path: "README.md" },
        output: "contents",
        metadata: {
          toolCallId: "tc-1",
          startTs: 100,
          toolName: "Read",
          endTs: 250,
          statusText: "done"
        },
        startTs: 100,
        endTs: 250,
        children: []
      }
    ]);
  });

  it("groups multiple interleaved tool calls by toolCallId", () => {
    const events = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        kind: "read",
        rawInput: { path: "a.txt" }
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-2",
        kind: "execute",
        rawInput: { command: "pwd" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-2",
        rawOutput: { exitCode: 0 }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        content: [{ type: "text", text: "alpha" }]
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-2",
        content: [{ type: "text", text: "workspace" }]
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(createContext({ events }));

    expect(trace.root.children).toMatchObject([
      {
        name: "tool_call:read",
        input: { path: "a.txt" },
        output: "alpha"
      },
      {
        name: "tool_call:execute",
        input: { command: "pwd" },
        output: [{ exitCode: 0 }, "workspace"]
      }
    ]);
  });

  it("accumulates agent_message_chunk and agent_message events into root output", () => {
    const events = [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } },
      { event: "agent_message", text: "world" },
      { sessionUpdate: "agent_message_chunk", content: [{ type: "text", text: "!" }] }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(createContext({ events }));

    expect(trace.root.output).toBe("Hello world!");
  });

  it("normalizes usage from canonical token fields", () => {
    const trace = acpToTrace(
      createContext({
        usage: {
          prompt_tokens: 5,
          completion_tokens: 8,
          prompt_cached_tokens: 2,
          prompt_cache_creation_tokens: 3
        }
      })
    );

    expect(trace.root.metrics).toEqual({
      prompt_tokens: 5,
      completion_tokens: 8,
      tokens: 13,
      prompt_cached_tokens: 2,
      prompt_cache_creation_tokens: 3
    });
  });

  it("omits negative usage metrics and derived totals from the root span", () => {
    const trace = acpToTrace(
      createContext({
        usage: {
          inputTokens: -10,
          outputTokens: -5,
          cachedTokens: -3,
          durationMs: -100
        }
      })
    );

    expect(trace.root.metrics).toEqual({});
  });

  it("accepts contexts without optional usage metrics", () => {
    const trace = acpToTrace(createContext({ usage: undefined }));

    expect(trace.root.metrics).toEqual({});
  });

  it("converts internal tool lifecycle events into a tool span", () => {
    const events = [
      {
        event: "tool_start",
        id: "tc-1",
        kind: "exec",
        title: "pwd",
        input: { command: "pwd" }
      },
      {
        event: "tool_complete",
        id: "tc-1",
        kind: "exec",
        path: "/repo"
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(createContext({ events }));

    expect(trace.root.children).toMatchObject([
      {
        name: "tool_call:exec",
        input: { command: "pwd" },
        output: "/repo",
        metadata: { toolCallId: "tc-1" }
      }
    ]);
  });

  it("carries ctx.metadata.aborted into root metadata", () => {
    const trace = acpToTrace(
      createContext({
        metadata: {
          aborted: true
        }
      })
    );

    expect(trace.root.metadata).toMatchObject({
      sessionId: "session-1",
      aborted: true
    });
  });

  it("keeps authoritative session identifiers over supplemental metadata", () => {
    const trace = acpToTrace(
      createContext({
        metadata: {
          sessionId: "spoofed-session",
          threadId: "spoofed-thread"
        }
      })
    );

    expect(trace.root.metadata).toMatchObject({
      sessionId: "session-1",
      threadId: "thread-1"
    });
  });

  it("uses fallback names and raw tool payload fields without lifting nonnumeric timestamps", () => {
    const events = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        rawInput: { query: "status" },
        _meta: { ts: "not-a-number", phase: "start" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        rawOutput: { ok: true },
        _meta: { ts: "also-not-a-number", phase: "end" }
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(
      createContext({
        events,
        model: undefined
      })
    );

    expect(trace.root.name).toBe("agent:codex:?");
    expect(trace.root.children).toEqual([
      {
        name: "tool_call:unknown",
        kind: "tool",
        input: { query: "status" },
        output: { ok: true },
        metadata: {
          toolCallId: "tc-1",
          startTs: "not-a-number",
          phase: "end",
          endTs: "also-not-a-number"
        },
        children: []
      }
    ]);
  });

  it("redacts root and tool payloads after assembling trace values", () => {
    const longText = "a".repeat(65_537);
    const events = [
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: longText }
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        kind: "read",
        input: longText
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        rawOutput: longText
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(
      createContext({
        events,
        prompt: longText
      })
    );

    expect(trace.root.input).toMatchObject({
      prompt: "[truncated:65537]"
    });
    expect(trace.root.output).toBe("[truncated:65537]");
    expect(trace.root.children[0]?.input).toBe("[truncated:65537]");
    expect(trace.root.children[0]?.output).toBe("[truncated:65537]");
  });

  it("redacts secrets from trace payloads and metadata before emission", () => {
    const events = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        kind: "execute",
        input: {
          env: {
            PATH: "/usr/bin",
            POE_API_KEY: "sk-tool"
          },
          headers: {
            Authorization: "Bearer tool-token"
          }
        },
        _meta: { token: "meta-token" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        rawOutput: "api_key=sk-output",
        content: [{ type: "text", text: "Bearer output-token" }]
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(
      createContext({
        events,
        metadata: { apiKey: "sk-root" },
        prompt: "Use Bearer prompt-token"
      })
    );

    expect(trace.root.input).toMatchObject({
      prompt: "Use Bearer [redacted]"
    });
    expect(trace.root.metadata).toMatchObject({
      apiKey: "[redacted]",
      sessionId: "session-1",
      threadId: "thread-1"
    });
    expect(trace.root.children[0]).toMatchObject({
      input: {
        env: {
          PATH: "/usr/bin",
          POE_API_KEY: "[redacted]"
        },
        headers: {
          Authorization: "[redacted]"
        }
      },
      output: ["api_key=[redacted]", "Bearer [redacted]"],
      metadata: {
        token: "[redacted]"
      }
    });
  });

  it("redacts env-style assigned secrets from trace strings", () => {
    const events = [
      {
        event: "agent_message",
        text: 'OPENAI_API_KEY="sk-agent"'
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        kind: "execute",
        input: 'token: "tok-input"'
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        rawOutput: 'password="pw-output"'
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(
      createContext({
        events,
        prompt: "OPENAI_API_KEY=sk-prompt"
      })
    );

    expect(trace.root.input).toMatchObject({
      prompt: "OPENAI_API_KEY=[redacted]"
    });
    expect(trace.root.output).toBe('OPENAI_API_KEY="[redacted]"');
    expect(trace.root.children[0]).toMatchObject({
      input: 'token: "[redacted]"',
      output: 'password="[redacted]"'
    });
  });

  it("redacts tool metadata and preserves own __proto__ metadata entries", () => {
    const metadata: Record<string, unknown> = { raw: "a".repeat(65_537) };
    Object.defineProperty(metadata, "__proto__", {
      value: "safe-value",
      enumerable: true
    });
    const events = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        kind: "read",
        _meta: metadata
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(createContext({ events }));
    const spanMetadata = trace.root.children[0]?.metadata;

    expect(spanMetadata?.raw).toBe("[truncated:65537]");
    expect(Object.hasOwn(spanMetadata ?? {}, "__proto__")).toBe(true);
    expect(spanMetadata?.["__proto__"]).toBe("safe-value");
    expect(Object.getPrototypeOf(spanMetadata)).toBe(Object.prototype);
  });

  it("does not emit a non-finite derived total token count", () => {
    const trace = acpToTrace(
      createContext({
        usage: {
          prompt_tokens: Number.MAX_VALUE,
          completion_tokens: Number.MAX_VALUE
        }
      })
    );

    expect(trace.root.metrics).toEqual({
      prompt_tokens: Number.MAX_VALUE,
      completion_tokens: Number.MAX_VALUE
    });
  });

  it("does not correlate identified tool updates to an idless tool call", () => {
    const events = [
      {
        sessionUpdate: "tool_call",
        kind: "read"
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-2",
        kind: "execute"
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-2",
        rawOutput: "workspace",
        _meta: { ts: 25 }
      }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(createContext({ events }));

    expect(trace.root.children).toMatchObject([
      {
        name: "tool_call:read",
        output: ""
      },
      {
        name: "tool_call:execute",
        output: "workspace",
        metadata: { toolCallId: "tc-2", endTs: 25 }
      }
    ]);
  });

  it("keeps sequential idless tool outputs on their originating spans", () => {
    const events = [
      { event: "tool_start", kind: "read_file", rawInput: { path: "a.txt" } },
      { event: "tool_complete", content: [{ type: "text", text: "A output" }] },
      { event: "tool_start", kind: "read_file", rawInput: { path: "b.txt" } },
      { event: "tool_complete", content: [{ type: "text", text: "B output" }] }
    ] as unknown as AcpEvent[];

    const trace = acpToTrace(createContext({ events }));

    expect(trace.root.children).toMatchObject([
      {
        name: "tool_call:read_file",
        input: { path: "a.txt" },
        output: "A output"
      },
      {
        name: "tool_call:read_file",
        input: { path: "b.txt" },
        output: "B output"
      }
    ]);
  });
});

function createContext(
  overrides: Partial<AcpSpawnContext> & { metadata?: Record<string, unknown> } = {}
): AcpSpawnContext & { metadata?: Record<string, unknown> } {
  return {
    sessionId: "session-1",
    threadId: "thread-1",
    agent: "codex",
    model: "gpt-5",
    prompt: "Say hello",
    mode: "edit",
    cwd: "/repo",
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    ...overrides
  };
}
