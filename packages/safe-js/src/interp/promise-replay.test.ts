import { describe, expect, it } from "vitest";

import { PromiseReplay } from "./promise-replay.js";
import { SandboxError } from "./budget.js";

describe("PromiseReplay", () => {
  it("does not record settlements caused by stopping a failed run", async () => {
    const replay = new PromiseReplay();
    const pending = replay.track(Promise.resolve(1));
    replay.fail(new Error("stopped"));
    await pending;
    expect(replay.snapshot().settlements).toEqual([]);
  });

  it("does not replay a fatal budget rejection as a promise settlement", async () => {
    const replay = new PromiseReplay();
    const error = new SandboxError({ budget: "steps", current: 2, limit: 1 });
    await expect(replay.track(Promise.reject(error))).rejects.toBe(error);
    expect(replay.snapshot().settlements).toEqual([]);
  });

  it("gates competing continuations by their recorded AST node order", async () => {
    const replay = new PromiseReplay({
      version: 1,
      steps: 3,
      promises: 0,
      settlements: [],
      executionTrace: { start: 0, nodes: [10, 20, 30] }
    });
    let advanced = false;
    const second = Promise.resolve(replay.beforeNode(20)).then(() => {
      advanced = true;
    });
    await Promise.resolve();
    expect(advanced).toBe(false);
    await replay.beforeNode(10);
    await second;
    expect(advanced).toBe(true);
    await replay.beforeNode(30);
    expect(replay.currentStep).toBe(3);
    expect(() =>
      replay.validateNodes({ nodeId: 10, body: [{ nodeId: 20 }, { nodeId: 30 }] })
    ).not.toThrow();
    expect(() => replay.validateNodes({ nodeId: 10 })).toThrow(/execution trace/i);
  });

  it.each([
    { start: -1, nodes: [1, 2] },
    { start: 0, nodes: [] },
    { start: 0, nodes: [-1] },
    { start: 0, nodes: ["1"] }
  ])("rejects malformed execution traces", (executionTrace) => {
    expect(
      () =>
        new PromiseReplay({ version: 1, steps: 1, promises: 0, settlements: [], executionTrace })
    ).toThrow(/execution trace/i);
  });
  it("rejects pending replay work if a scheduled callback cannot start", async () => {
    const failure = new Error("missing callback implementation");
    const replay = new PromiseReplay({
      version: 1,
      steps: 1,
      promises: 2,
      settlements: [
        { id: 1, step: 1 },
        { id: 2, step: 1 }
      ],
      events: [
        { kind: "promise", id: 1, step: 1 },
        { kind: "callback-start", token: "callback", step: 1, promises: 2 },
        { kind: "callback-end", token: "callback", step: 1 },
        { kind: "promise", id: 2, step: 1 }
      ]
    });
    replay.registerCallbacks([
      {
        token: "callback",
        start: () => {
          throw failure;
        }
      }
    ]);
    replay.beforeNode();
    const first = replay.track(Promise.resolve("first"));
    const second = replay.track(new Promise<never>(() => undefined));
    const outcome = second.then(
      () => "unexpected fulfillment",
      (reason: unknown) => reason
    );
    expect(
      await Promise.race([
        outcome,
        new Promise((resolve) => setImmediate(() => resolve("stalled")))
      ])
    ).toBe(failure);
    expect(await first).toBe("first");
    expect(() => replay.beforeNode()).toThrow(failure);
  });

  it("records settlement order and interpreter positions", async () => {
    const replay = new PromiseReplay();
    replay.beforeNode();
    let resolveFirst!: (value: string) => void;
    const first = replay.track(
      new Promise<string>((resolve) => {
        resolveFirst = resolve;
      })
    );
    const second = replay.track(Promise.resolve("second"));
    expect(await second).toBe("second");
    replay.beforeNode();
    resolveFirst("first");
    expect(await first).toBe("first");
    expect(replay.snapshot()).toEqual({
      version: 1,
      steps: 2,
      promises: 2,
      settlements: [
        { id: 2, step: 1 },
        { id: 1, step: 2 }
      ]
    });
  });

  it("holds early results until their recorded interpreter position", async () => {
    const replay = new PromiseReplay({
      version: 1,
      steps: 3,
      promises: 1,
      settlements: [{ id: 1, step: 2 }]
    });
    let settled = false;
    const promise = replay.track(Promise.resolve("ready"));
    void promise.then(() => {
      settled = true;
    });
    await replay.beforeNode();
    await Promise.resolve();
    expect(settled).toBe(false);
    await replay.beforeNode();
    expect(await promise).toBe("ready");
    await replay.beforeNode();
    expect(replay.snapshot().steps).toBe(3);
  });

  it("delivers same-position settlements in recorded order", async () => {
    const replay = new PromiseReplay({
      version: 1,
      steps: 1,
      promises: 2,
      settlements: [
        { id: 2, step: 1 },
        { id: 1, step: 1 }
      ]
    });
    const delivered: string[] = [];
    const first = replay.track(Promise.resolve("first"));
    const second = replay.track(Promise.resolve("second"));
    void first.then((value) => delivered.push(value));
    void second.then((value) => delivered.push(value));
    await replay.beforeNode();
    await Promise.all([first, second]);
    expect(delivered).toEqual(["second", "first"]);
  });

  it("does not settle formerly pending work before reaching the checkpoint", async () => {
    const replay = new PromiseReplay({ version: 1, steps: 2, promises: 1, settlements: [] });
    let settled = false;
    const promise = replay.track(Promise.resolve("new result"));
    void promise.then(() => {
      settled = true;
    });
    await replay.beforeNode();
    await Promise.resolve();
    expect(settled).toBe(false);
    await replay.beforeNode();
    expect(await promise).toBe("new result");
  });

  it.each([
    { version: 2, steps: 1, promises: 1, settlements: [] },
    { version: 1, steps: -1, promises: 1, settlements: [] },
    { version: 1, steps: 1, promises: 1, settlements: [{ id: 2, step: 1 }] },
    { version: 1, steps: 1, promises: 1, settlements: [{ id: 1, step: 2 }] },
    {
      version: 1,
      steps: 1,
      promises: 1,
      settlements: [
        { id: 1, step: 1 },
        { id: 1, step: 1 }
      ]
    },
    {
      version: 1,
      steps: 2,
      promises: 2,
      settlements: [
        { id: 1, step: 2 },
        { id: 2, step: 1 }
      ]
    }
  ])("rejects a malformed settlement trace %#", (snapshot) => {
    expect(() => new PromiseReplay(snapshot)).toThrow(TypeError);
  });
});
