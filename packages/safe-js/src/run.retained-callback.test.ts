import { describe, expect, it, vi } from "vitest";

import { Budget } from "./interp/budget.js";
import { declareHostOperation } from "./interp/host-bridge.js";
import { deepCopyToSandbox } from "./interp/values.js";
import { restore, type SafeJSSnapshot } from "./restore.js";
import { run, type RunOptions, type RunSnapshot } from "./run.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";

function counterSource(secondAmount: number, input: boolean) {
  return `
    const state = { total: 0, count: 0 };
    const alias = state;
    const trace = [];
    let configuration;
    const handle = await register('counter', async event => {
      state.count++;
      trace.push('callback:' + state.count);
      state.total += event.amount * configuration.rate;
      await step(state.count === 1 ? 'first:0' : 'second:0');
      trace.push('done:' + state.count);
      return state.total;
    });
    trace.push('registered');
    ${
      input
        ? `
      await boundary('registered');
      await unlock();
      configuration = await ready;
      const secondConfiguration = await readyAlias;
      trace.push('input:' + configuration.rate);
      await boundary('ready');
    `
        : "configuration = { rate: 1 };"
    }
    const first = await deliver(handle, { amount: 2 });
    await boundary('first');
    const second = await deliver(handle, { amount: ${secondAmount} });
    await boundary('second');
    return {
      total: state.total, count: state.count, first, second, alias: alias === state,
      ${input ? "inputAlias: configuration === secondConfiguration, promiseAlias: ready === readyAlias," : ""}
      trace
    };
  `;
}

const mapSource = `
  const trace = [];
  let configuration;
  const state = { total: 0, values: [] };
  const stateAlias = state;
  const skipped = { skip: true };
  let active = 0;
  let peak = 0;
  async function mapBounded(items, mapper, concurrency) {
    let cursor = 0;
    const staged = items.map(() => skipped);
    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        active++;
        peak = Math.max(peak, active);
        try {
          staged[index] = await mapper(items[index], index);
        } finally {
          active--;
        }
      }
    };
    const workers = [];
    for (let workerIndex = 0; workerIndex < concurrency; workerIndex++) workers.push(worker());
    await Promise.all(workers);
    return staged.filter(value => value !== skipped);
  }
  const handle = await register('map', async batch => {
    trace.push('callback:' + batch.label);
    const values = await mapBounded(batch.values, async (value, index) => {
      await step(batch.label + ':' + index);
      return value === 0 ? skipped : value * configuration.rate + index;
    }, 2);
    for (const value of values) { state.total += value; state.values.push(value); }
    trace.push('done:' + batch.label);
    return { values, total: state.total };
  });
  trace.push('registered');
  await boundary('registered');
  await unlock();
  configuration = await ready;
  const secondConfiguration = await readyAlias;
  trace.push('input:' + configuration.rate);
  await boundary('ready');
  const first = await deliver(handle, { label: 'first', values: [2, 0, 5] });
  await boundary('first');
  const second = await deliver(handle, { label: 'second', values: [1, 4] });
  await boundary('second');
  return {
    workflow: 'map', total: state.total, values: state.values, alias: stateAlias === state,
    inputAlias: configuration === secondConfiguration, promiseAlias: ready === readyAlias,
    first, second, active, peak, trace
  };
`;

function makeHost(rate?: number) {
  const registry = new Map<string, (event: unknown) => Promise<unknown>>();
  const steps = vi.fn(async (label: string) => label);
  const deliveries: Array<(event: unknown) => Promise<unknown>> = [];
  const register = vi.fn(async (name: string, callback: (event: unknown) => Promise<unknown>) => {
    registry.set(name, callback);
    return name;
  });
  const rebind = vi.fn((args: readonly unknown[]) => {
    registry.set(args[0] as string, args[1] as (event: unknown) => Promise<unknown>);
  });
  const bindings: RunOptions["bindings"] = {
    register: declareHostOperation(register, "re-issue", { onReplay: rebind }),
    async deliver(name: string, event: unknown) {
      const callback = registry.get(name)!;
      deliveries.push(callback);
      return await callback(event);
    },
    async unlock() {
      return { ready: true };
    },
    step: steps
  };
  if (rate !== undefined) {
    const ready = deepCopyToSandbox(Promise.resolve({ rate, opening: rate === 3 ? 10 : 0 }));
    bindings.ready = ready;
    bindings.readyAlias = ready;
  }
  return { bindings, registry, steps, deliveries, register, rebind };
}

async function execute(
  source: string,
  bindings: RunOptions["bindings"],
  snapshot?: SafeJSSnapshot,
  stopAt?: string
) {
  const clock = stopAt === undefined ? undefined : vi.spyOn(Date, "now").mockReturnValue(0);
  let saved: RunSnapshot | undefined;
  let release: (() => void) | undefined;
  try {
    const result = await run(source, {
      bindings: {
        ...bindings,
        async boundary(label: string) {
          if (label === stopAt && saved === undefined) {
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
      ...(snapshot === undefined ? {} : { snapshot: restore(snapshot, { source }) }),
      ...(stopAt === undefined
        ? {}
        : {
            snapshotIntervalMs: 1,
            snapshotBackend: {
              async read() {
                return undefined;
              },
              async remove() {},
              async write(value: SafeJSSnapshot) {
                saved = JSON.parse(serializeSafeJSSnapshot(value));
                release?.();
              }
            }
          })
    });
    if (stopAt !== undefined) expect(saved).toBeDefined();
    return { result, saved };
  } finally {
    release?.();
    clock?.mockRestore();
  }
}

const workflows = [
  ...[true, false].flatMap((input) =>
    [2, 3].map((secondAmount) => ({
      name: `counter (input: ${input}, second amount: ${secondAmount})`,
      source: counterSource(secondAmount, input),
      rate: input ? 1 : undefined,
      expected: {
        total: 2 + secondAmount,
        count: 2,
        first: 2,
        second: 2 + secondAmount,
        alias: true,
        ...(input ? { inputAlias: true, promiseAlias: true } : {}),
        trace: [
          "registered",
          ...(input ? ["input:1"] : []),
          "callback:1",
          "done:1",
          "callback:2",
          "done:2"
        ]
      },
      nextSteps: ["second:0"]
    }))
  ),
  {
    name: "bounded concurrent map",
    source: mapSource,
    rate: 3,
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
    },
    nextSteps: ["second:0", "second:1"]
  }
];

describe.each(workflows)("CBI-001 retained callback: $name", (workflow) => {
  it("delivers repeated events uninterrupted", async () => {
    const host = makeHost(workflow.rate);
    const { result } = await execute(workflow.source, host.bindings);
    expect(result).toMatchObject({ ok: true, returnValue: workflow.expected });
    expect(host.deliveries).toHaveLength(2);
    expect(host.deliveries[1]).toBe(host.deliveries[0]);
    expect(host.rebind).not.toHaveBeenCalled();
  });

  it.each(["first", "second"])("restores at %s without losing a new delivery", async (boundary) => {
    const original = await execute(
      workflow.source,
      makeHost(workflow.rate).bindings,
      undefined,
      boundary
    );
    expect(original.result).toMatchObject({ ok: true, returnValue: workflow.expected });
    const registration = original.saved!.replay!.calls.find(
      (call) => call.operation === "register"
    )!;
    expect(registration.lifecycle).toBe("consumed");
    expect(registration.callbacks).toHaveLength(boundary === "first" ? 1 : 2);
    for (let repetition = 0; repetition < 2; repetition++) {
      const host = makeHost();
      const { result } = await execute(workflow.source, host.bindings, original.saved);
      expect(result).toMatchObject({ ok: true, returnValue: workflow.expected });
      expect(host.register).not.toHaveBeenCalled();
      expect(host.rebind).toHaveBeenCalledTimes(1);
      expect(host.deliveries).toHaveLength(boundary === "first" ? 1 : 0);
      if (boundary === "first") expect(host.deliveries[0]).toBe([...host.registry.values()][0]);
      expect(host.steps.mock.calls.flat()).toEqual(boundary === "first" ? workflow.nextSteps : []);
      const restoredRegistration = result.snapshot!.replay!.calls.find(
        (call) => call.operation === "register"
      )!;
      expect(restoredRegistration.id).toBe(registration.id);
      expect(restoredRegistration.callbacks).toHaveLength(2);
      expect(restoredRegistration.callbacks!.map((callback) => callback.id)).toEqual([1, 1]);
    }
  });

  it("preserves new callback history through successive and completed checkpoints", async () => {
    const first = await execute(
      workflow.source,
      makeHost(workflow.rate).bindings,
      undefined,
      "first"
    );
    const second = await execute(workflow.source, makeHost().bindings, first.saved, "second");
    expect(second.result).toMatchObject({ ok: true, returnValue: workflow.expected });
    const finished = await execute(workflow.source, makeHost().bindings, second.saved);
    expect(finished.result).toMatchObject({ ok: true, returnValue: workflow.expected });
    const completedHost = makeHost();
    const completed = await execute(
      workflow.source,
      completedHost.bindings,
      finished.result.snapshot
    );
    expect(completed.result).toMatchObject({ ok: true, returnValue: workflow.expected });
    expect(completedHost.register).not.toHaveBeenCalled();
    expect(completedHost.deliveries).toEqual([]);
    expect(completedHost.steps).not.toHaveBeenCalled();
  });
});

it("keeps pending-operation callback argument reconciliation distinct from new delivery", async () => {
  const source =
    "let count = 0; await apply(async event => { count++; await boundary('inside'); return event.amount; }); return count;";
  const first = await execute(
    source,
    {
      async apply(callback: (event: unknown) => Promise<unknown>) {
        return await callback({ amount: 2 });
      }
    },
    undefined,
    "inside"
  );
  const matching = await execute(
    source,
    {
      async apply(callback: (event: unknown) => Promise<unknown>) {
        return await callback({ amount: 2 });
      }
    },
    first.saved
  );
  expect(matching.result).toMatchObject({ ok: true, returnValue: 1 });
  await expect(
    execute(
      source,
      {
        async apply(callback: (event: unknown) => Promise<unknown>) {
          return await callback({ amount: 3 });
        }
      },
      first.saved
    )
  ).rejects.toMatchObject({
    name: "HostCallResumabilityError",
    action: "external-reconciliation",
    callId: first.saved!.replay!.calls.find((call) => call.operation === "apply")!.id
  });
});
