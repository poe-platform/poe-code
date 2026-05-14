import { describe, expect, it } from "vitest";

import { emitToBraintrust, type BraintrustSpanLike } from "./emit-braintrust.js";
import type { AcpTrace } from "./trace.js";

describe("emitToBraintrust", () => {
  it("emits a root task span and one tool span per child", () => {
    const trace = createTrace();
    const parent = new FakeBraintrustSpan("parent");

    emitToBraintrust(trace, parent);

    expect(parent.calls.filter((call) => call.method === "startSpan")).toEqual([
      {
        span: "parent",
        method: "startSpan",
        args: { name: "agent:codex:gpt-5", type: "task" },
      },
      {
        span: "agent:codex:gpt-5",
        method: "startSpan",
        args: { name: "tool_call:read", type: "tool" },
      },
      {
        span: "agent:codex:gpt-5",
        method: "startSpan",
        args: { name: "tool_call:execute", type: "tool" },
      },
    ]);
  });

  it("logs span fields verbatim without explicit timestamps", () => {
    const trace = createTrace();
    const parent = new FakeBraintrustSpan("parent");

    emitToBraintrust(trace, parent);

    expect(parent.calls.filter((call) => call.method === "log")).toEqual([
      {
        span: "agent:codex:gpt-5",
        method: "log",
        args: {
          input: { prompt: "Say hello", mode: "edit" },
          output: "Done",
          metadata: { sessionId: "session-1" },
          metrics: { tokens: 12 },
        },
      },
      {
        span: "tool_call:read",
        method: "log",
        args: {
          input: { path: "README.md" },
          output: "contents",
          metadata: { startTs: 100, endTs: 250, toolName: "Read" },
          metrics: { tokens: 3 },
        },
      },
      {
        span: "tool_call:execute",
        method: "log",
        args: {
          input: { command: "pwd" },
          output: { exitCode: 0 },
        },
      },
    ]);
  });

  it("ends every opened span when log throws", () => {
    const trace = createTrace();
    const parent = new FakeBraintrustSpan("parent", {
      throwOnLogSpan: "tool_call:read",
    });

    expect(() => emitToBraintrust(trace, parent)).toThrow("log failed for tool_call:read");

    expect(parent.calls.filter((call) => call.method === "end")).toEqual([
      { span: "tool_call:read", method: "end" },
      { span: "agent:codex:gpt-5", method: "end" },
    ]);
  });

  it("ends the root span when root logging throws", () => {
    const trace = createTrace();
    const parent = new FakeBraintrustSpan("parent", {
      throwOnLogSpan: "agent:codex:gpt-5",
    });

    expect(() => emitToBraintrust(trace, parent)).toThrow("log failed for agent:codex:gpt-5");

    expect(parent.calls.filter((call) => call.method === "startSpan")).toEqual([
      {
        span: "parent",
        method: "startSpan",
        args: { name: "agent:codex:gpt-5", type: "task" },
      },
    ]);
    expect(parent.calls.filter((call) => call.method === "end")).toEqual([
      { span: "agent:codex:gpt-5", method: "end" },
    ]);
  });

  it("recurses through nested child spans as Braintrust tool spans", () => {
    const trace = createTrace();
    trace.root.children[0]?.children.push({
      name: "tool_call:nested",
      kind: "tool",
      input: "nested input",
      output: "nested output",
      children: [],
    });
    const parent = new FakeBraintrustSpan("parent");

    emitToBraintrust(trace, parent);

    expect(parent.calls.filter((call) => call.method === "startSpan")).toContainEqual({
      span: "tool_call:read",
      method: "startSpan",
      args: { name: "tool_call:nested", type: "tool" },
    });
    expect(parent.calls).toContainEqual({
      span: "tool_call:nested",
      method: "end",
    });
  });
});

type FakeCall =
  | {
      span: string;
      method: "startSpan";
      args: { name: string; type: "task" | "tool" };
    }
  | {
      span: string;
      method: "log";
      args: Parameters<BraintrustSpanLike["log"]>[0];
    }
  | {
      span: string;
      method: "end";
    };

interface FakeOptions {
  throwOnLogSpan?: string;
}

class FakeBraintrustSpan implements BraintrustSpanLike {
  readonly calls: FakeCall[];

  constructor(
    private readonly name: string,
    private readonly options: FakeOptions = {},
    calls?: FakeCall[],
  ) {
    this.calls = calls ?? [];
  }

  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpanLike {
    this.calls.push({ span: this.name, method: "startSpan", args });
    return new FakeBraintrustSpan(args.name, this.options, this.calls);
  }

  log(event: Parameters<BraintrustSpanLike["log"]>[0]): void {
    this.calls.push({ span: this.name, method: "log", args: event });
    if (this.options.throwOnLogSpan === this.name) {
      throw new Error(`log failed for ${this.name}`);
    }
  }

  end(): void {
    this.calls.push({ span: this.name, method: "end" });
  }
}

function createTrace(): AcpTrace {
  return {
    root: {
      name: "agent:codex:gpt-5",
      kind: "agent",
      input: { prompt: "Say hello", mode: "edit" },
      output: "Done",
      metadata: { sessionId: "session-1" },
      metrics: { tokens: 12 },
      startTs: 50,
      endTs: 300,
      children: [
        {
          name: "tool_call:read",
          kind: "tool",
          input: { path: "README.md" },
          output: "contents",
          metadata: { startTs: 100, endTs: 250, toolName: "Read" },
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
