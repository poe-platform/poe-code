import { describe, expect, it } from "vitest";

import { emitToOtel, type OtelSpanLike, type OtelTracerLike } from "./emit-otel.js";
import type { AcpTrace } from "./trace.js";

describe("emitToOtel", () => {
  it("emits one OTEL span per ACP span with semantic attributes", () => {
    const trace = createTrace();
    const tracer = new FakeOtelTracer();

    emitToOtel(trace, tracer);

    expect(tracer.calls).toEqual([
      {
        span: "tracer",
        method: "startSpan",
        name: "agent:codex:gpt-5",
        options: { startTime: 50 },
      },
      {
        span: "agent:codex:gpt-5",
        method: "setAttributes",
        attrs: {
          "gen_ai.system": "poe-code",
          "gen_ai.request.model": "gpt-5",
          "gen_ai.agent.name": "codex",
          "gen_ai.usage.input_tokens": 10,
          "gen_ai.usage.output_tokens": 2,
          "gen_ai.usage.cached_tokens": 4,
          "poe_code.session_id": "session-1",
          "poe_code.thread_id": "thread-1",
          "poe_code.input": JSON.stringify({ prompt: "Say hello", mode: "edit" }),
          "poe_code.output": "Done",
        },
      },
      {
        span: "tracer",
        method: "startSpan",
        name: "tool_call:read",
        options: { startTime: 100 },
      },
      {
        span: "tool_call:read",
        method: "setAttributes",
        attrs: {
          "gen_ai.tool.name": "read",
          "poe_code.tool_call_id": "call-1",
          "poe_code.input": JSON.stringify({ path: "README.md" }),
          "poe_code.output": "contents",
        },
      },
      {
        span: "tool_call:read",
        method: "end",
        endTime: 250,
      },
      {
        span: "tracer",
        method: "startSpan",
        name: "tool_call:execute",
      },
      {
        span: "tool_call:execute",
        method: "setAttributes",
        attrs: {
          "gen_ai.tool.name": "execute",
          "poe_code.input": JSON.stringify({ command: "pwd" }),
          "poe_code.output": JSON.stringify({ exitCode: 0 }),
        },
      },
      {
        span: "tool_call:execute",
        method: "end",
      },
      {
        span: "agent:codex:gpt-5",
        method: "end",
        endTime: 300,
      },
    ]);
  });

  it("skips undefined input and output fields", () => {
    const trace: AcpTrace = {
      root: {
        name: "agent:codex",
        kind: "agent",
        metadata: { sessionId: "session-1" },
        children: [],
      },
    };
    const tracer = new FakeOtelTracer();

    emitToOtel(trace, tracer);

    expect(tracer.calls).toContainEqual({
      span: "agent:codex",
      method: "setAttributes",
      attrs: {
        "gen_ai.system": "poe-code",
        "gen_ai.agent.name": "codex",
        "poe_code.session_id": "session-1",
      },
    });
  });

  it("handles zero timestamps, absent suffixes, and JSON input edge cases", () => {
    const trace: AcpTrace = {
      root: {
        name: "agent:",
        kind: "agent",
        input: null,
        output: ["a", 1, true],
        metadata: {
          sessionId: "session-1",
          threadId: 123,
        },
        metrics: {
          prompt_tokens: 0,
          completion_tokens: 0,
          prompt_cached_tokens: 0,
        },
        startTs: 0,
        endTs: 0,
        children: [
          {
            name: "tool_call:",
            kind: "tool",
            input: false,
            output: 0,
            metadata: {
              toolCallId: "call-1",
            },
            startTs: 0,
            endTs: 0,
            children: [
              {
                name: "tool_call:child",
                kind: "tool",
                input: "nested",
                children: [],
              },
            ],
          },
        ],
      },
    };
    const tracer = new FakeOtelTracer();

    emitToOtel(trace, tracer);

    expect(tracer.calls).toEqual([
      {
        span: "tracer",
        method: "startSpan",
        name: "agent:",
        options: { startTime: 0 },
      },
      {
        span: "agent:",
        method: "setAttributes",
        attrs: {
          "gen_ai.system": "poe-code",
          "gen_ai.usage.input_tokens": 0,
          "gen_ai.usage.output_tokens": 0,
          "gen_ai.usage.cached_tokens": 0,
          "poe_code.session_id": "session-1",
          "poe_code.thread_id": 123,
          "poe_code.input": "null",
          "poe_code.output": JSON.stringify(["a", 1, true]),
        },
      },
      {
        span: "tracer",
        method: "startSpan",
        name: "tool_call:",
        options: { startTime: 0 },
      },
      {
        span: "tool_call:",
        method: "setAttributes",
        attrs: {
          "poe_code.tool_call_id": "call-1",
          "poe_code.input": false,
          "poe_code.output": 0,
        },
      },
      {
        span: "tracer",
        method: "startSpan",
        name: "tool_call:child",
      },
      {
        span: "tool_call:child",
        method: "setAttributes",
        attrs: {
          "gen_ai.tool.name": "child",
          "poe_code.input": "nested",
        },
      },
      {
        span: "tool_call:child",
        method: "end",
      },
      {
        span: "tool_call:",
        method: "end",
        endTime: 0,
      },
      {
        span: "agent:",
        method: "end",
        endTime: 0,
      },
    ]);
  });

  it("ends the current span when setting attributes throws", () => {
    const trace = createTrace();
    const tracer = new FakeOtelTracer({ throwOnSetAttributesSpan: "tool_call:read" });

    expect(() => emitToOtel(trace, tracer)).toThrow(
      "setAttributes failed for tool_call:read",
    );

    expect(tracer.calls.filter((call) => call.method === "end")).toEqual([
      {
        span: "tool_call:read",
        method: "end",
        endTime: 250,
      },
      {
        span: "agent:codex:gpt-5",
        method: "end",
        endTime: 300,
      },
    ]);
  });
});

type FakeCall =
  | {
      span: "tracer";
      method: "startSpan";
      name: string;
      options?: { startTime?: number };
    }
  | {
      span: string;
      method: "setAttribute";
      key: string;
      value: string | number | boolean;
    }
  | {
      span: string;
      method: "setAttributes";
      attrs: Record<string, string | number | boolean>;
    }
  | {
      span: string;
      method: "end";
      endTime?: number;
    };

interface FakeOptions {
  throwOnSetAttributesSpan?: string;
}

class FakeOtelTracer implements OtelTracerLike {
  readonly calls: FakeCall[] = [];

  constructor(private readonly options: FakeOptions = {}) {}

  startSpan(name: string, options?: { startTime?: number }): OtelSpanLike {
    this.calls.push({
      span: "tracer",
      method: "startSpan",
      name,
      ...(options ? { options } : {}),
    });
    return new FakeOtelSpan(name, this.calls, this.options);
  }
}

class FakeOtelSpan implements OtelSpanLike {
  constructor(
    private readonly name: string,
    private readonly calls: FakeCall[],
    private readonly options: FakeOptions,
  ) {}

  setAttribute(key: string, value: string | number | boolean): void {
    this.calls.push({ span: this.name, method: "setAttribute", key, value });
  }

  setAttributes(attrs: Record<string, string | number | boolean>): void {
    this.calls.push({ span: this.name, method: "setAttributes", attrs });
    if (this.options.throwOnSetAttributesSpan === this.name) {
      throw new Error(`setAttributes failed for ${this.name}`);
    }
  }

  end(endTime?: number): void {
    this.calls.push({
      span: this.name,
      method: "end",
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }
}

function createTrace(): AcpTrace {
  return {
    root: {
      name: "agent:codex:gpt-5",
      kind: "agent",
      input: { prompt: "Say hello", mode: "edit" },
      output: "Done",
      metadata: { sessionId: "session-1", threadId: "thread-1" },
      metrics: {
        prompt_tokens: 10,
        completion_tokens: 2,
        tokens: 12,
        prompt_cached_tokens: 4,
      },
      startTs: 50,
      endTs: 300,
      children: [
        {
          name: "tool_call:read",
          kind: "tool",
          input: { path: "README.md" },
          output: "contents",
          metadata: {
            startTs: 100,
            endTs: 250,
            toolName: "Read",
            toolCallId: "call-1",
          },
          metrics: { tokens: 3 },
          startTs: 100,
          endTs: 250,
          children: [],
        },
        {
          name: "tool_call:execute",
          kind: "tool",
          input: { command: "pwd" },
          output: { exitCode: 0 },
          children: [],
        },
      ],
    },
  };
}
