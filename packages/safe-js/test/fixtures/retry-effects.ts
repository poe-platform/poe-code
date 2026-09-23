import { vi, expect } from "vitest";
import { dump, type RunPromise } from "../../src/index.js";

export async function waitForRetryEffects(execution: RunPromise): Promise<void> {
  // Host-call logs advance before the guest records the other worker's finally effect.
  await vi.waitFor(async () => {
    const pending = JSON.parse(await dump(execution, { mode: "replay" }));
    const trace = pending.heap[pending.bindings.trace.id];
    // Eight events include b's final retry; c's final event remains gated.
    expect(trace.state.properties.properties).toContainEqual([
      "length", expect.objectContaining({ value: 8 })
    ]);
  }, { interval: 1, timeout: 1000 });
}
