import { expect, it } from "vitest";
import { FinalizationRegistryState, finalizationRegistryStates } from "./finalization-registry-state.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

it("charges held values and cells without rooting targets or unregister tokens", () => {
  const owner = Object.create(null);
  const callback = createSandboxClosure({ call: () => undefined });
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(owner, { state, callback });
  const baseline = measureSandboxData([owner]);
  const target = { payload: "target".repeat(1000) };
  const token = { payload: "token".repeat(1000) };
  const held = { payload: "held" };
  try {
    state.register(target, held, token);
    expect(measureSandboxData([owner])).toBe(baseline + 3 + measureSandboxData([held]));
    expect(measureSandboxData([owner, held])).toBe(measureSandboxData([owner]));
    expect(state.unregister(token)).toBe(true);
    expect(measureSandboxData([owner])).toBe(baseline);
  } finally {
    state.dispose();
  }
});

it("remeasures mutations to held values and releases them on disposal", () => {
  const owner = Object.create(null);
  const callback = createSandboxClosure({ call: () => undefined });
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(owner, { state, callback });
  const baseline = measureSandboxData([owner]);
  const held = { payload: "abc" };
  const target = {};
  try {
    state.register(target, held);
    const before = measureSandboxData([owner]);
    held.payload += "def";
    expect(measureSandboxData([owner])).toBe(before + 3);
    state.dispose();
    expect(measureSandboxData([owner])).toBe(baseline);
  } finally {
    state.dispose();
  }
});
