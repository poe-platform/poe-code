import {expect, it} from "vitest";
import {run} from "../run.js";

it.each([false, true])("requests %s nested dependencies while a peer resolver is pending", async nested => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const execution = run("import 'pending';import {value} from 'ready';export {value}", {
    sourceType: "module",
    sourceResolver: async id => {
      calls.push(id);
      if (id === "pending") await gate;
      return {id, source: id === "ready" && nested ? "export {value} from 'leaf'" : "export const value=7"};
    }
  });
  try {
    // Observe a host turn, then always release the resolver. A serial loader
    // fails the assertion without leaving a hanging run or using a timeout.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(calls).toEqual(nested ? ["pending", "ready", "leaf"] : ["pending", "ready"]);
  } finally {
    release();
    expect(await execution).toMatchObject({ok: true, returnValue: {value: 7}});
  }
});

it("evaluates dependencies in source order despite reversed loading completion", async () => {
  const events: string[] = [];
  const execution = run("import 'first';import 'second';export const done=true", {
    sourceType: "module", modules: {cap: {mark: (id: string) => {events.push(id);}}},
    sourceResolver: async id => {
      if (id === "first") await new Promise<void>(resolve => setImmediate(resolve));
      return {id, source: `import {mark} from 'cap';mark('${id}')`};
    }
  });
  expect(await execution).toMatchObject({ok: true});
  expect(events).toEqual(["first", "second"]);
});

it("rejects a denied graph without waiting for an unresolved peer or evaluating sources", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const events: string[] = [];
  const execution = run("import 'pending';import 'denied'", {
    sourceType: "module", modules: {cap: {mark: () => {events.push("evaluated");}}},
    sourceResolver: async id => {
      if (id === "denied") return undefined;
      await gate;
      return {id, source: "import {mark} from 'cap';mark()"};
    }
  });
  let failure: unknown;
  void execution.catch(reason => {failure = reason;});
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(failure).toMatchObject({message: "Source resolver denied 'denied' from '<realm>'."});
  } finally {
    release();
    await expect(execution).rejects.toThrow("Source resolver denied");
  }
  expect(events).toEqual([]);
});

it("cancels every outstanding graph request with the same host reason", async () => {
  const signals: AbortSignal[] = [];
  const controller = new AbortController();
  const reason = new Error("stop the graph");
  const execution = run("import 'first';import 'second'", {
    sourceType: "module", signal: controller.signal,
    sourceResolver: (_id, _referrer, context) => {
      signals.push(context.signal!);
      return new Promise(() => {});
    }
  });
  void execution.catch(() => undefined);
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(signals).toHaveLength(2);
  } finally {
    controller.abort(reason);
    await expect(execution).rejects.toBe(reason);
  }
  expect(signals.every(signal => signal.aborted && signal.reason === reason)).toBe(true);
});

it("loads a converging async cycle once and shares namespace identity", async () => {
  const sources: Record<string, string> = {
    first: "import 'shared';export {value} from 'shared'",
    second: "import 'shared';export {value} from 'shared'",
    shared: "import 'first';import {mark} from 'cap';await 0;mark();export const value={}",
  };
  let evaluations = 0;
  const execution = run("const [a,b]=await Promise.all([import('first'),import('second')]);export const same=a.value===b.value", {
    sourceType: "module", modules: {cap: {mark: () => {evaluations++;}}},
    sourceResolver: async id => {
      await Promise.resolve();
      return {id, source: sources[id]!};
    }
  });
  expect(await execution).toMatchObject({ok: true, returnValue: {same: true}});
  expect(evaluations).toBe(1);
});
