import { setImmediate as nodeImmediate } from "node:timers";
import { afterEach, expect, it, vi } from "vitest";
import { defaultRuntime } from "./runtime.js";

afterEach(() => vi.unstubAllGlobals());

it("cooperates with a real event-loop turn without a timer delay on Node", async () => {
  const timer = vi.spyOn(globalThis, "setTimeout");
  try {
    let settled = false;
    const pending = defaultRuntime.yieldTurn(new AbortController().signal).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await pending;
    expect(settled).toBe(true);
    expect(timer).not.toHaveBeenCalled();
  } finally { timer.mockRestore(); }
});

it("retains a timer-backed turn on portable hosts without setImmediate", async () => {
  vi.stubGlobal("setImmediate", undefined);
  const timer = vi.spyOn(globalThis, "setTimeout");
  try {
    let settled = false;
    const pending = defaultRuntime.yieldTurn(new AbortController().signal).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(timer).toHaveBeenCalledTimes(1);
    await pending;
    expect(settled).toBe(true);
  } finally { timer.mockRestore(); }
});

for (const portable of [false, true]) {
  it(`preserves abort identity before and during a turn, portable=${portable}`, async () => {
    if (portable) vi.stubGlobal("setImmediate", undefined);
    const controller = new AbortController();
    const reason = new Error("cancel the codec");
    const pending = defaultRuntime.yieldTurn(controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await expect(defaultRuntime.yieldTurn(controller.signal)).rejects.toBe(reason);
  });
}

it("lets another immediate callback run between successive codec turns", async () => {
  const events: string[] = [];
  const pending = (async () => {
    await defaultRuntime.yieldTurn(new AbortController().signal);
    events.push("first");
    await defaultRuntime.yieldTurn(new AbortController().signal);
    events.push("second");
  })();
  nodeImmediate(() => events.push("other"));
  await pending;
  expect(events).toEqual(["first", "other", "second"]);
});
