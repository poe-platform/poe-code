import { expect } from "vitest";
import { dump, type RunPromise } from "../../src/index.js";

export async function waitForRetryEffects(execution: RunPromise): Promise<void> {
  // Host-call logs advance before the guest records the other worker's finally effect.
  // Yield between captures so snapshot polling cannot crowd out runnable guest jobs.
  let length: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
    const pending = JSON.parse(await dump(execution, { mode: "replay" }));
    const trace = pending.heap[pending.bindings.trace.id];
    length = trace.state.properties.properties.find(([key]: [string]) => key === "length")?.[1].value;
    // Eight events include b's final retry; c's final event remains gated.
    if (length === 8) return;
  }
  expect(length).toBe(8);
}
