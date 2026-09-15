import { afterEach, expect, it, vi } from "vitest";
import { withOutputFormat } from "toolcraft-design";
import { streamAcpEventsToDashboard } from "./dashboard-stream.js";

afterEach(() => vi.useRealTimers());

it("closes a cancelled event source without draining its backlog or publishing pending text", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const onToolOutput = vi.fn();
  const onErrorOutput = vi.fn();
  let closed = false;
  let consumed = 0;
  await streamAcpEventsToDashboard({
    signal: controller.signal,
    events: (async function* () {
      try {
        yield { event: "agent_message", text: "visible" };
        yield { event: "agent_message", text: " pending" };
        controller.abort();
        for (let index = 0; index < 1000; index++) {
          consumed++;
          yield { event: "agent_message", text: " cancelled backlog" };
        }
        yield { event: "error", message: "cancelled backlog error" };
      } finally {
        closed = true;
      }
    })(),
    onToolOutput,
    onErrorOutput
  });
  expect(closed).toBe(true);
  expect(consumed).toBeLessThanOrEqual(1);
  expect(onToolOutput).toHaveBeenCalledTimes(1);
  expect(onToolOutput.mock.calls[0]![0]).toContain("visible");
  expect(onErrorOutput).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(onToolOutput).toHaveBeenCalledTimes(1);
});

it("shows text before execution ends and updates its existing preview", async () => {
  vi.useFakeTimers();
  const onToolOutput = vi.fn();
  const onErrorOutput = vi.fn();
  await withOutputFormat("markdown", () =>
    streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "agent_message", text: "first" };
        expect(onToolOutput.mock.calls[0]![0]).toContain("first");
        yield { event: "agent_message", text: " second" };
        await vi.advanceTimersByTimeAsync(16);
        expect(onToolOutput).toHaveBeenCalledTimes(2);
        expect(onToolOutput.mock.calls[1]![0]).toContain("first second");
        expect(onToolOutput.mock.calls[1]![1]).toBe(onToolOutput.mock.calls[0]![1]);
        yield { event: "tool_start", id: "tool", kind: "exec", title: "inspect" };
        yield { event: "agent_message", text: "new block" };
        yield { event: "reasoning", text: "thinking" };
        yield { event: "error", message: "failed" };
      })(),
      onToolOutput,
      onErrorOutput
    })
  );
  const output = onToolOutput.mock.calls;
  expect(output).toHaveLength(5);
  expect(output[1]![0]).toContain("first second");
  expect(output[3]![0]).toContain("new block");
  expect(output[4]![0]).toContain("thinking");
  expect(onErrorOutput).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("failed"));
});

it("bounds continuous text without creating one log entry per delta", async () => {
  const onToolOutput = vi.fn();
  await withOutputFormat("markdown", () =>
    streamAcpEventsToDashboard({
      events: (async function* () {
        for (let index = 0; index < 100; index += 1)
          yield { event: "agent_message", text: "x".repeat(1000) };
        yield { event: "agent_message", text: "LATEST RESULT" };
      })(),
      onToolOutput,
      onErrorOutput() {
        throw new Error("Unexpected error output");
      }
    })
  );
  const output = onToolOutput.mock.lastCall!;
  const formattingChars = onToolOutput.mock.calls[0]![0].length - 1000;
  expect(output[0].length).toBeLessThanOrEqual(16_384 + formattingChars);
  expect(output[0]).toContain("Output truncated");
  expect(output[0]).toContain("LATEST RESULT");
  expect(output[1]).toBe(onToolOutput.mock.calls[0]![1]);
  expect(onToolOutput).toHaveBeenCalledTimes(2);
});

it("flushes pending text when execution throws and leaves no scheduled writes", async () => {
  vi.useFakeTimers();
  const onToolOutput = vi.fn();
  await expect(
    withOutputFormat("markdown", () =>
      streamAcpEventsToDashboard({
        events: (async function* () {
          yield { event: "agent_message", text: "first" };
          yield { event: "agent_message", text: " latest" };
          throw new Error("Execution stopped");
        })(),
        onToolOutput,
        onErrorOutput() {}
      })
    )
  ).rejects.toThrow("Execution stopped");
  expect(onToolOutput).toHaveBeenCalledTimes(2);
  expect(onToolOutput.mock.calls[1]![0]).toContain("first latest");
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(onToolOutput).toHaveBeenCalledTimes(2);
});

it("omits usage separators from dashboard entries while preserving message paragraph breaks", async () => {
  const onToolOutput = vi.fn();
  await withOutputFormat("terminal", () =>
    streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "agent_message", text: "first\n\nsecond" };
        yield { event: "usage", inputTokens: 120, outputTokens: 45, cachedTokens: 10 };
      })(),
      onToolOutput,
      onErrorOutput() {}
    })
  );
  expect(onToolOutput.mock.calls[0]![0]).toContain("first\n\nsecond");
  expect(onToolOutput.mock.calls[1]![0].startsWith("\n")).toBe(false);
  expect(onToolOutput.mock.calls[1]![0]).toContain("tokens: 120");
});

it("aggregates a large message burst within the interactive latency budget", async () => {
  const onToolOutput = vi.fn();
  const started = performance.now();
  await streamAcpEventsToDashboard({
    events: (async function* () {
      for (let index = 0; index < 60_000; index++)
        yield { event: "agent_message", text: `Burst response ${index}\n` };
      yield { event: "agent_message", text: "LATEST BURST RESULT\n" };
    })(),
    onToolOutput,
    onErrorOutput() { throw new Error("Unexpected error output"); }
  });
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(onToolOutput).toHaveBeenCalledTimes(2);
  const final = onToolOutput.mock.calls[1]![0];
  // Rendered output includes the ACP label and styling around the bounded text preview.
  expect(final.length).toBeLessThanOrEqual(16_384 + 128);
  expect(final).toContain("Output truncated");
  expect(final).toContain("LATEST BURST RESULT");
});
