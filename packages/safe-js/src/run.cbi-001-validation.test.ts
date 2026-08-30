import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { Budget } from "./interp/budget.js";
import { declareHostOperation } from "./interp/host-bridge.js";
import { deepCopyToSandbox } from "./interp/values.js";
import { restore, type SafeJSSnapshot } from "./restore.js";
import { run, type RunOptions, type RunSnapshot } from "./run.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";

const originals = [
  {
    name: "counter-identical",
    source:
      "const state = { total: 0, count: 0 };\nconst alias = state;\nconst trace = [];\nlet configuration;\nconst handle = await register('counter', async event => {\n  state.count++;\n  trace.push('callback:' + state.count);\n  state.total += event.amount * configuration.rate;\n  await step(state.count === 1 ? 'first:0' : 'second:0');\n  trace.push('done:' + state.count);\n  return state.total;\n});\ntrace.push('registered');\nawait boundary('registered');\nawait unlock();\nconfiguration = await ready;\nconst secondConfiguration = await readyAlias;\ntrace.push('input:' + configuration.rate);\nawait boundary('ready');\nconst first = await deliver(handle, { amount: 2 });\nawait boundary('first');\nconst second = await deliver(handle, { amount: 2 });\nawait boundary('second');\nreturn { total: state.total, count: state.count, first, second, alias: alias === state, inputAlias: configuration === secondConfiguration, promiseAlias: ready === readyAlias, trace };\n",
    sourceSha256: "c1878b94e8502a17862be022bbc514711d6d18f75b3c1d17962edd3efe7379d7",
    configuration: { rate: 1, opening: 0 },
    expected: {
      total: 4,
      count: 2,
      first: 2,
      second: 4,
      alias: true,
      inputAlias: true,
      promiseAlias: true,
      trace: ["registered", "input:1", "callback:1", "done:1", "callback:2", "done:2"]
    }
  },
  {
    name: "counter-distinct",
    source:
      "const state = { total: 0, count: 0 };\nconst alias = state;\nconst trace = [];\nlet configuration;\nconst handle = await register('counter', async event => {\n  state.count++;\n  trace.push('callback:' + state.count);\n  state.total += event.amount * configuration.rate;\n  await step(state.count === 1 ? 'first:0' : 'second:0');\n  trace.push('done:' + state.count);\n  return state.total;\n});\ntrace.push('registered');\nawait boundary('registered');\nawait unlock();\nconfiguration = await ready;\nconst secondConfiguration = await readyAlias;\ntrace.push('input:' + configuration.rate);\nawait boundary('ready');\nconst first = await deliver(handle, { amount: 2 });\nawait boundary('first');\nconst second = await deliver(handle, { amount: 3 });\nawait boundary('second');\nreturn { total: state.total, count: state.count, first, second, alias: alias === state, inputAlias: configuration === secondConfiguration, promiseAlias: ready === readyAlias, trace };\n",
    sourceSha256: "3709e9293316fef256f07f0aee7b833539597c839d6983714e21686d83885a5e",
    configuration: { rate: 1, opening: 0 },
    expected: {
      total: 5,
      count: 2,
      first: 2,
      second: 5,
      alias: true,
      inputAlias: true,
      promiseAlias: true,
      trace: ["registered", "input:1", "callback:1", "done:1", "callback:2", "done:2"]
    }
  },
  {
    name: "map-prefulfilled",
    source:
      "const trace = [];\nlet configuration;\nconst state = { total: 0, values: [] };\nconst stateAlias = state;\nconst skipped = { skip: true };\nlet active = 0;\nlet peak = 0;\nasync function mapBounded(items, mapper, concurrency) {\n  let cursor = 0;\n  const staged = items.map(() => skipped);\n  const worker = async () => {\n    while (cursor < items.length) {\n      const index = cursor++;\n      active++;\n      peak = Math.max(peak, active);\n      try {\n        staged[index] = await mapper(items[index], index);\n      } finally {\n        active--;\n      }\n    }\n  };\n  const workers = [];\n  for (let workerIndex = 0; workerIndex < concurrency; workerIndex++) workers.push(worker());\n  await Promise.all(workers);\n  return staged.filter(value => value !== skipped);\n}\nconst handle = await register('map', async batch => {\n  trace.push('callback:' + batch.label);\n  const values = await mapBounded(batch.values, async (value, index) => {\n    await step(batch.label + ':' + index);\n    return value === 0 ? skipped : value * configuration.rate + index;\n  }, 2);\n  for (const value of values) { state.total += value; state.values.push(value); }\n  trace.push('done:' + batch.label);\n  return { values, total: state.total };\n});\ntrace.push('registered');\nawait boundary('registered');\nawait unlock();\nconfiguration = await ready;\nconst secondConfiguration = await readyAlias;\ntrace.push('input:' + configuration.rate);\nawait boundary('ready');\nconst first = await deliver(handle, { label: 'first', values: [2, 0, 5] });\nawait boundary('first');\nconst second = await deliver(handle, { label: 'second', values: [1, 4] });\nawait boundary('second');\nreturn { workflow: 'map', total: state.total, values: state.values, alias: stateAlias === state, inputAlias: configuration === secondConfiguration, promiseAlias: ready === readyAlias, first, second, active, peak, trace };\n",
    sourceSha256: "8c710793c38b14e8e43b948b94340c8b60212656e7984a7255b94949846a148c",
    configuration: { rate: 3, opening: 10 },
    expected: {
      workflow: "map",
      total: 39,
      values: [6, 17, 3, 13],
      alias: true,
      inputAlias: true,
      promiseAlias: true,
      first: { values: [6, 17], total: 23 },
      second: { values: [3, 13], total: 39 },
      active: 0,
      peak: 2,
      trace: [
        "registered",
        "input:3",
        "callback:first",
        "done:first",
        "callback:second",
        "done:second"
      ]
    }
  },
  {
    name: "counter-no-input",
    source:
      "const state = { total: 0, count: 0 };\nconst alias = state;\nconst trace = [];\nlet configuration;\nconst handle = await register('counter', async event => {\n  state.count++;\n  trace.push('callback:' + state.count);\n  state.total += event.amount * configuration.rate;\n  await step(state.count === 1 ? 'first:0' : 'second:0');\n  trace.push('done:' + state.count);\n  return state.total;\n});\ntrace.push('registered');\nconfiguration = { rate: 1 };\nconst first = await deliver(handle, { amount: 2 });\nawait boundary('first');\nconst second = await deliver(handle, { amount: 2 });\nawait boundary('second');\nreturn { total: state.total, count: state.count, first, second, alias: alias === state, trace };\n",
    sourceSha256: "dea5f9478002423f86f0e0c9ade09e46b71b3b92d04f063fb440fdbb6ca66c8f",
    configuration: null,
    expected: {
      total: 4,
      count: 2,
      first: 2,
      second: 4,
      alias: true,
      trace: ["registered", "callback:1", "done:1", "callback:2", "done:2"]
    }
  }
];

type Callback = (event: unknown) => Promise<unknown>;

function registryHost(configuration?: { rate: number; opening: number } | null) {
  const registry = new Map<string, Callback>();
  const calls: Array<{ name: string; event: unknown; callback: Callback }> = [];
  const steps = vi.fn(async (label: string) => label);
  const register = vi.fn(async (name: string, callback: Callback) => {
    registry.set(name, callback);
    return name;
  });
  const rebind = vi.fn((args: readonly unknown[]) => {
    registry.set(args[0] as string, args[1] as Callback);
  });
  const bindings: RunOptions["bindings"] = {
    register: declareHostOperation(register, "re-issue", { onReplay: rebind }),
    async deliver(name: string, event: unknown) {
      const callback = registry.get(name);
      if (callback === undefined) throw new Error("Missing registration");
      calls.push({ name, event, callback });
      return await callback(event);
    },
    async unlock() {
      return { ready: true };
    },
    async boundary(label: string) {
      return label;
    },
    step: steps
  };
  if (configuration != null) {
    const ready = deepCopyToSandbox(Promise.resolve(configuration));
    bindings.ready = ready;
    bindings.readyAlias = ready;
  }
  return { bindings, register, rebind, registry, calls, steps };
}

async function execute(
  source: string,
  bindings: RunOptions["bindings"],
  options: {
    stopAt?: string;
    snapshot?: SafeJSSnapshot;
    provider?: RunOptions["hostCallResumeProvider"];
  } = {}
) {
  const clock = options.stopAt === undefined ? undefined : vi.spyOn(Date, "now").mockReturnValue(0);
  let release: (() => void) | undefined;
  let saved: RunSnapshot | undefined;
  try {
    const result = await run(source, {
      bindings: {
        ...bindings,
        async boundary(label: string) {
          if (label === options.stopAt && saved === undefined) {
            clock!.mockReturnValue(2);
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return label;
        }
      },
      modules: {},
      budget: new Budget({
        maxSteps: 50_000,
        maxCallDepth: 64,
        arrayLength: 1024,
        dataSize: 2_000_000
      }),
      ...(options.snapshot === undefined
        ? {}
        : { snapshot: restore(options.snapshot, { source }) }),
      ...(options.provider === undefined ? {} : { hostCallResumeProvider: options.provider }),
      ...(options.stopAt === undefined
        ? {}
        : {
            snapshotIntervalMs: 1,
            snapshotBackend: {
              async read() {
                return undefined;
              },
              async remove() {},
              async write(snapshot: SafeJSSnapshot) {
                try {
                  saved = JSON.parse(serializeSafeJSSnapshot(snapshot));
                } finally {
                  release?.();
                }
              }
            }
          })
    });
    if (options.stopAt !== undefined) expect(saved).toBeDefined();
    return { result, saved };
  } finally {
    release?.();
    clock?.mockRestore();
  }
}

describe.each(originals)("CBI-001 original $name", (fixture) => {
  it("anchors the unchanged source in native JavaScript before checkpoint tests", async () => {
    expect(createHash("sha256").update(fixture.source).digest("hex")).toBe(fixture.sourceSha256);
    const host = registryHost();
    const ready = Promise.resolve(fixture.configuration);
    const bindings = {
      ...host.bindings,
      ...(fixture.configuration === null ? {} : { ready, readyAlias: ready })
    };
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>;
    const value = await new AsyncFunction(...Object.keys(bindings), fixture.source)(
      ...Object.values(bindings)
    );
    expect(value).toEqual(fixture.expected);
    expect(host.calls).toHaveLength(2);
    expect(host.calls[0]!.callback).toBe(host.calls[1]!.callback);
  });

  it.each(["first", "second", "completed"])(
    "retains original registration after %s",
    async (boundary) => {
      const first = await execute(
        fixture.source,
        registryHost(fixture.configuration).bindings,
        boundary === "completed" ? {} : { stopAt: boundary }
      );
      expect(first.result).toMatchObject({ ok: true, returnValue: fixture.expected });
      const checkpoint = first.saved ?? first.result.snapshot;
      expect(checkpoint.replay!.calls.find((call) => call.operation === "register")).toMatchObject({
        lifecycle: "consumed"
      });
      for (let repeat = 0; repeat < 2; repeat++) {
        const host = registryHost();
        const resumed = await execute(fixture.source, host.bindings, { snapshot: checkpoint });
        expect(resumed.result).toMatchObject({ ok: true, returnValue: fixture.expected });
        expect(host.register).not.toHaveBeenCalled();
        expect(host.rebind).toHaveBeenCalledTimes(1);
        expect(host.calls).toHaveLength(boundary === "first" ? 1 : 0);
        if (boundary === "first") {
          expect(host.calls[0]!.callback).toBe(host.rebind.mock.calls[0]![0][1]);
          expect(host.steps.mock.calls.map(([label]) => label)).toEqual(
            fixture.name === "map-prefulfilled" ? ["second:0", "second:1"] : ["second:0"]
          );
        } else expect(host.steps).not.toHaveBeenCalled();
        const registration = resumed.result.snapshot.replay!.calls.find(
          (call) => call.operation === "register"
        )!;
        expect(registration.callbacks).toHaveLength(2);
        expect(registration.id).toBe(
          checkpoint.replay!.calls.find((call) => call.operation === "register")!.id
        );
        if (fixture.configuration === null)
          expect(checkpoint.replay!.calls.filter((call) => call.moduleId === "<inputs>")).toEqual(
            []
          );
      }
    }
  );

  it("recaptures first to second to completed without consuming new deliveries as history", async () => {
    const first = await execute(fixture.source, registryHost(fixture.configuration).bindings, {
      stopAt: "first"
    });
    const second = await execute(fixture.source, registryHost().bindings, {
      snapshot: first.saved,
      stopAt: "second"
    });
    const completed = await execute(fixture.source, registryHost().bindings, {
      snapshot: second.saved
    });
    const terminalHost = registryHost();
    const terminal = await execute(fixture.source, terminalHost.bindings, {
      snapshot: completed.result.snapshot
    });
    for (const observation of [first, second, completed, terminal])
      expect(observation.result).toMatchObject({ ok: true, returnValue: fixture.expected });
    expect(terminalHost.calls).toEqual([]);
    expect(terminalHost.register).not.toHaveBeenCalled();
  });
});

describe("CBI-001 independent delivery versus reissue controls", () => {
  it.each([
    {
      name: "four identical old-registration events",
      amounts: [1, 1, 1, 1],
      newRegistration: false
    },
    {
      name: "different payloads on old registration",
      amounts: [1, 2, 3, 4],
      newRegistration: false
    },
    { name: "identical events on new registration", amounts: [1, 1, 1, 1], newRegistration: true }
  ])("executes $name with lexical count four", async ({ amounts, newRegistration }) => {
    const source = `
      const state = { count: 0, total: 0 };
      const alias = state;
      let multiplier = 1;
      const callback = async event => {
        state.count++;
        state.total += event.amount * multiplier;
        await step('callback:' + state.count);
        return state.count;
      };
      let handle = await register('old', callback);
      const results = [await deliver(handle, { amount: ${amounts[0]} })];
      await boundary('first');
      multiplier = 3;
      ${newRegistration ? "handle = await register('new', callback);" : ""}
      for (const amount of ${JSON.stringify(amounts.slice(1))}) results.push(await deliver(handle, { amount }));
      return { count: state.count, total: state.total, alias: alias === state, results };
    `;
    const expected = {
      count: 4,
      total: amounts[0]! + 3 * amounts.slice(1).reduce((sum, value) => sum + value, 0),
      alias: true,
      results: [1, 2, 3, 4]
    };
    const first = await execute(source, registryHost().bindings, { stopAt: "first" });
    expect(first.result).toMatchObject({ ok: true, returnValue: expected });
    const host = registryHost();
    const resumed = await execute(source, host.bindings, { snapshot: first.saved });
    expect(resumed.result).toMatchObject({ ok: true, returnValue: expected });
    expect(host.register).toHaveBeenCalledTimes(newRegistration ? 1 : 0);
    expect(host.calls).toHaveLength(3);
    expect(host.steps.mock.calls).toEqual([["callback:2"], ["callback:3"], ["callback:4"]]);
    const rebound = host.rebind.mock.calls[0]![0][1];
    for (const delivery of host.calls) {
      if (newRegistration) expect(delivery.callback).not.toBe(rebound);
      else expect(delivery.callback).toBe(rebound);
    }
    expect(
      resumed.result.snapshot
        .replay!.calls.filter((call) => call.operation === "register")
        .map((call) => call.callbacks?.length)
    ).toEqual(newRegistration ? [1, 3] : [4]);
  });

  it.each([1, 2, 3])(
    "deduplicates only actual reissue history at callback %i and runs its new suffix",
    async (stopAt) => {
      const source = `
      let count = 0;
      const seen = [];
      await apply(async amount => {
        count++;
        seen.push(count, amount);
        if (count === ${stopAt}) await boundary('inside');
        await step('callback:' + count);
        return count;
      });
      return { count, seen };
    `;
      const hostResults: unknown[][] = [];
      const operation = vi.fn(async (callback: Callback) => {
        const values = [];
        for (let index = 0; index < 4; index++) values.push(await callback(2));
        hostResults.push(values);
      });
      const first = await execute(
        source,
        { apply: operation, step: async () => undefined },
        { stopAt: "inside" }
      );
      const steps = vi.fn(async () => undefined);
      const resumed = await execute(
        source,
        { apply: operation, step: steps },
        { snapshot: first.saved }
      );
      expect(first.result).toMatchObject({
        ok: true,
        returnValue: { count: 4, seen: [1, 2, 2, 2, 3, 2, 4, 2] }
      });
      expect(resumed.result).toMatchObject({
        ok: true,
        returnValue: { count: 4, seen: [1, 2, 2, 2, 3, 2, 4, 2] }
      });
      expect(operation).toHaveBeenCalledTimes(2);
      expect(hostResults).toEqual([
        [1, 2, 3, 4],
        [1, 2, 3, 4]
      ]);
      expect(steps).toHaveBeenCalledTimes(5 - stopAt);
      expect(
        resumed.result.snapshot.replay!.calls.find((call) => call.operation === "apply")!.callbacks
      ).toHaveLength(4);
    }
  );

  it("refuses a changed historical reissue payload with the original public call ID", async () => {
    const source =
      "let count = 0; await apply(async amount => { count++; await boundary('inside'); return amount; }); return count;";
    const first = await execute(
      source,
      { apply: async (callback: Callback) => await callback(1) },
      { stopAt: "inside" }
    );
    await expect(
      execute(
        source,
        { apply: async (callback: Callback) => await callback(2) },
        { snapshot: first.saved }
      )
    ).rejects.toMatchObject({
      name: "HostCallResumabilityError",
      action: "external-reconciliation",
      callId: first.saved!.replay!.calls.find((call) => call.operation === "apply")!.id
    });
  });

  it.each([false, true])(
    "requires a completion proof and treats resumer calls as new events (joined: %s)",
    async (joined) => {
      const source =
        "let count = 0; await apply(async amount => { count++; await boundary('inside'); return count + amount; }); return count;";
      const operation = vi.fn(async (callback: Callback) => {
        for (let index = 0; index < 4; index++) await callback(2);
      });
      const apply = declareHostOperation(operation, "read-side-effect");
      const first = await execute(source, { apply }, { stopAt: "inside" });
      expect(first.result).toMatchObject({ ok: true, returnValue: 4 });
      const observations: unknown[] = [];
      const resumed = execute(
        source,
        { apply },
        {
          snapshot: first.saved,
          provider: async (request, context) => {
            expect(context!.replayed).toHaveLength(1);
            observations.push(await context!.replayed[0]!.result);
            if (joined)
              for (let index = 0; index < 3; index++)
                observations.push(await context!.callbacks.get(1)!(2));
            return {
              ...request,
              ...(joined ? { callbackDisposition: "joined" as const } : {}),
              outcome: { status: "fulfilled", value: undefined }
            };
          }
        }
      );
      if (joined) {
        expect((await resumed).result).toMatchObject({ ok: true, returnValue: 4 });
        expect(observations).toEqual([3, 4, 5, 6]);
      } else
        await expect(resumed).rejects.toMatchObject({
          name: "HostCallResumabilityError",
          action: "external-reconciliation"
        });
      expect(operation).toHaveBeenCalledTimes(1);
    }
  );
});
