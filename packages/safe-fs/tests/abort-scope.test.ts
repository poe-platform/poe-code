import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeAbortSignals } from "../src/contracts/abort.js";

afterEach(() => vi.restoreAllMocks());

describe("operation-scoped signal composition", () => {
  it("creates an independently disposable non-aborted signal for no inputs", () => {
    const scope = composeAbortSignals([]);
    expect(scope.signal).toBeInstanceOf(AbortSignal);
    expect(scope.signal.aborted).toBe(false);
    scope.dispose();
    scope.dispose();
    expect(scope.signal.aborted).toBe(false);
  });

  it("selects the first already-aborted input in the supplied order", () => {
    const live = new AbortController();
    const first = new AbortController();
    const second = new AbortController();
    const reason = Object.freeze({ source: "first" });
    second.abort(new Error("aborted earlier in time"));
    first.abort(reason);
    const subscribe = vi.spyOn(live.signal, "addEventListener");
    const scope = composeAbortSignals([live.signal, first.signal, second.signal]);
    expect(scope.signal.reason).toBe(reason);
    expect(subscribe).not.toHaveBeenCalled();
    scope.dispose();
  });

  it.each([0, 1])("preserves first abort reason from input %s and detaches all inputs", (index) => {
    const inputs = [new AbortController(), new AbortController()] as const;
    const reason = Object.freeze({ source: index });
    const scope = composeAbortSignals(inputs.map((input) => input.signal));
    const abort = vi.fn(() => {
      for (const input of inputs) expect(getEventListeners(input.signal, "abort")).toEqual([]);
    });
    scope.signal.addEventListener("abort", abort, { once: true });
    inputs[index]!.abort(reason);
    inputs[index === 0 ? 1 : 0].abort(new Error("later"));
    expect(scope.signal.reason).toBe(reason);
    expect(abort).toHaveBeenCalledOnce();
    scope.dispose();
  });

  it("deduplicates subscriptions and removes them on successful operation disposal", () => {
    const caller = new AbortController();
    const scope = composeAbortSignals([caller.signal, caller.signal]);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(1);
    scope.dispose();
    scope.dispose();
    expect(getEventListeners(caller.signal, "abort")).toEqual([]);
    caller.abort(new Error("after completion"));
    expect(scope.signal.aborted).toBe(false);
  });

  it("does not dispose a borrowed parent scope when a child completes", () => {
    const caller = new AbortController();
    const parent = composeAbortSignals([caller.signal]);
    const child = composeAbortSignals([parent.signal]);
    child.dispose();
    const reason = Object.freeze({ source: "caller" });
    caller.abort(reason);
    expect(parent.signal.reason).toBe(reason);
    expect(child.signal.aborted).toBe(false);
    expect(getEventListeners(caller.signal, "abort")).toEqual([]);
    parent.dispose();
  });

  it("catches aborts between observation and listener registration", () => {
    const caller = new AbortController();
    const peer = new AbortController();
    const reason = Object.freeze({ source: "registration" });
    const add = caller.signal.addEventListener.bind(caller.signal);
    vi.spyOn(caller.signal, "addEventListener").mockImplementation((...args) => {
      caller.abort(reason);
      add(...args);
    });
    const scope = composeAbortSignals([caller.signal, peer.signal]);
    expect(scope.signal.reason).toBe(reason);
    expect(getEventListeners(caller.signal, "abort")).toEqual([]);
    expect(getEventListeners(peer.signal, "abort")).toEqual([]);
    scope.dispose();
  });

  it("unwinds existing listeners and preserves a registration failure", () => {
    const caller = new AbortController();
    const peer = new AbortController();
    const failure = new Error("listener registration failed");
    vi.spyOn(peer.signal, "addEventListener").mockImplementation(() => {
      throw failure;
    });
    expect(() => composeAbortSignals([caller.signal, peer.signal])).toThrow(failure);
    expect(getEventListeners(caller.signal, "abort")).toEqual([]);
    expect(getEventListeners(peer.signal, "abort")).toEqual([]);
  });
});
