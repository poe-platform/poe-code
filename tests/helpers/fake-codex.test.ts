import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

const fixture = readFileSync(new URL("../fixtures/pipeline-tui/fake-codex.mjs", import.meta.url), "utf8");

afterEach(() => vi.useRealTimers());

it("stays silent with an unfinished diagnostic until activity-timeout termination", async () => {
  vi.useFakeTimers();
  const stdout = vi.fn();
  const stderr = vi.fn();
  const exit = vi.fn();
  let terminate: (() => void) | undefined;
  runInNewContext(fixture, {
    process: {
      env: { PIPELINE_FAKE_SCENARIO: "activity-timeout" }, pid: 1234,
      stdout: { write: stdout }, stderr: { write: stderr }, exit,
      on(_signal: string, handler: () => void) { terminate = handler; }
    },
    setInterval, clearInterval, setTimeout, clearTimeout
  });
  expect(stderr).toHaveBeenCalledWith("first attempt warning\u001b]HIDDEN_UNFINISHED_OSC");
  await vi.advanceTimersByTimeAsync(600_000);
  expect(stdout).toHaveBeenCalledTimes(3);
  expect(exit).not.toHaveBeenCalled();
  terminate!();
  expect(exit).toHaveBeenCalledWith(143);
  expect(vi.getTimerCount()).toBe(0);
});

it("publishes a finite dense burst and holds completion for cancellation QA", async () => {
  vi.useFakeTimers();
  const events: Array<{ type: string; item?: { text?: string }; usage?: unknown }> = [];
  runInNewContext(fixture, {
    process: {
      env: { PIPELINE_FAKE_SCENARIO: "finite-burst" },
      pid: 1234,
      stdout: { write: (line: string) => events.push(JSON.parse(line)) },
      on() {}
    },
    setInterval, clearInterval, setTimeout, clearTimeout
  });
  await vi.advanceTimersByTimeAsync(500);
  const burst = events.filter((event) => event.item?.text?.startsWith("Burst response "));
  expect(burst).toHaveLength(60_000);
  for (let index = 0; index < burst.length; index++) {
    if (burst[index]!.item!.text !== `Burst response ${index}\n`)
      throw new Error(`Dense fixture lost message order at ${index}`);
  }
  expect(events.at(-1)?.item?.text).toBe("LATEST BURST RESULT\n");
  expect(events.some((event) => event.type === "turn.completed")).toBe(false);
  await vi.advanceTimersByTimeAsync(89_999);
  expect(events.some((event) => event.type === "turn.completed")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(events.at(-1)).toEqual({
    type: "turn.completed",
    usage: { input_tokens: 120, output_tokens: 45, cached_input_tokens: 10 }
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels a scheduled dense burst without leaving fixture timers or output", async () => {
  vi.useFakeTimers();
  const write = vi.fn();
  const exit = vi.fn();
  const stderr = vi.fn();
  let terminate: (() => void) | undefined;
  runInNewContext(fixture, {
    process: {
      env: { PIPELINE_FAKE_SCENARIO: "finite-burst" },
      pid: 1234,
      stdout: { write },
      stderr: { write: stderr },
      exit,
      on(_signal: string, handler: () => void) { terminate = handler; }
    },
    setInterval, clearInterval, setTimeout, clearTimeout
  });
  await vi.advanceTimersByTimeAsync(499);
  const initialWrites = write.mock.calls.length;
  terminate!();
  expect(exit).toHaveBeenCalledWith(143);
  expect(stderr).toHaveBeenCalledWith("FAKE_CHILD_TERMINATED\n");
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(90_001);
  expect(write).toHaveBeenCalledTimes(initialWrites);
});

it("streams ordered noisy tool pairs beyond dashboard retention until cancellation", async () => {
  vi.useFakeTimers();
  const events: Array<{ type: string; item?: { id?: string; command?: string } }> = [];
  let terminate: (() => void) | undefined;
  runInNewContext(fixture, {
    process: {
      env: { PIPELINE_FAKE_SCENARIO: "tool-burst" },
      pid: 1234,
      stdout: { write: (line: string) => events.push(JSON.parse(line)) },
      stderr: { write() {} },
      exit() {},
      on(_signal: string, handler: () => void) { terminate = handler; }
    },
    setInterval, clearInterval, setTimeout, clearTimeout
  });
  await vi.advanceTimersByTimeAsync(500);
  const tools = events.filter((event) => event.item?.id?.startsWith("tool-"));
  expect(tools).toHaveLength(400);
  for (let index = 0; index < 200; index++) {
    expect(tools[index * 2]).toMatchObject({
      type: "item.started", item: { id: `tool-${index}`, command: `fake noisy tool ${index}` }
    });
    expect(tools[index * 2 + 1]).toMatchObject({ type: "item.completed", item: { id: `tool-${index}` } });
  }
  await vi.advanceTimersByTimeAsync(1500);
  expect(events.some((event) => event.type === "turn.completed")).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
  terminate!();
  expect(vi.getTimerCount()).toBe(0);
});

it("can complete a dense burst immediately to expose slow-consumer metadata races", async () => {
  vi.useFakeTimers();
  const events: Array<{ type: string; item?: { text?: string }; usage?: unknown }> = [];
  runInNewContext(fixture, {
    process: {
      env: { PIPELINE_FAKE_SCENARIO: "finite-burst-immediate" },
      pid: 1234,
      stdout: { write: (line: string) => events.push(JSON.parse(line)) },
      on() {}
    },
    setInterval, clearInterval, setTimeout, clearTimeout
  });
  await vi.advanceTimersByTimeAsync(501);
  expect(events).toHaveLength(60_005);
  expect(events.at(-2)?.item?.text).toBe("LATEST BURST RESULT\n");
  expect(events.at(-1)).toEqual({ type: "turn.completed", usage: {
    input_tokens: 120, output_tokens: 45, cached_input_tokens: 10
  } });
  expect(vi.getTimerCount()).toBe(0);
});
