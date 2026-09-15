import { afterEach, expect, it, vi } from "vitest";
import { withOutputFormat } from "toolcraft-design";
import { createStore } from "../../../toolcraft-design/src/dashboard/store.js";
import { streamAcpEventsToDashboard } from "./dashboard-stream.js";

afterEach(() => vi.useRealTimers());

it("shows text before execution ends and updates its existing preview", async () => {
  vi.useFakeTimers();
  const store = createStore();
  await withOutputFormat("markdown", () =>
    streamAcpEventsToDashboard({
      events: (async function* () {
        yield { event: "agent_message", text: "first" };
        expect(store.getState().output[0]!.text).toContain("first");
        yield { event: "agent_message", text: " second" };
        await vi.advanceTimersByTimeAsync(16);
        expect(store.getState().output).toHaveLength(1);
        expect(store.getState().output[0]!.text).toContain("first second");
        yield { event: "tool_start", id: "tool", kind: "exec", title: "inspect" };
        yield { event: "agent_message", text: "new block" };
        yield { event: "reasoning", text: "thinking" };
        yield { event: "error", message: "failed" };
      })(),
      onToolOutput(text, id) {
        store.appendOutput({ kind: "tool", text, id, ts: 0 });
      },
      onErrorOutput(text) {
        store.appendOutput({ kind: "error", text, ts: 0 });
      }
    })
  );
  const output = store.getState().output;
  expect(output).toHaveLength(5);
  expect(output[0]!.text).toContain("first second");
  expect(output[2]!.text).toContain("new block");
  expect(output[3]!.text).toContain("thinking");
  expect(output[4]).toMatchObject({ kind: "error" });
});

it("bounds continuous text without creating one log entry per delta", async () => {
  const store = createStore();
  const onToolOutput = vi.fn((text: string, id?: string) =>
    store.appendOutput({ kind: "tool", text, id, ts: 0 })
  );
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
  const output = store.getState().output;
  expect(output).toHaveLength(1);
  expect(output[0]!.text.length).toBeLessThanOrEqual(16_384);
  expect(output[0]!.text).toContain("Output truncated");
  expect(output[0]!.text).toContain("LATEST RESULT");
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
