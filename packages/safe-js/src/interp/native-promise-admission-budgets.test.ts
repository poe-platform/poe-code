import { expect, it } from "vitest";
import { admitNativePromiseProperties, Budget, dump, restore, run } from "../index.js";
import { deepCopyToSandbox, measureSandboxData } from "./values.js";
import { HostCallJournal } from "./host-call.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";

it.each(["binding", "host", "replay", "rebind"])("enforces admitted symbol and value string limits through %s", async surface => {
  for (const target of ["key", "value"] as const) for (const length of [128, 129]) {
    const key = Symbol(target === "key" ? "x".repeat(length) : "data");
    const input = Promise.resolve(7);
    Object.defineProperty(input, key, { value: target === "value" ? "x".repeat(length) : 1 });
    admitNativePromiseProperties(input, [key]);
    const budget = new Budget({ stringLength: 128 });
    const source = surface === "host" ? "const input = (await load()).input; return Object.getOwnPropertySymbols(input).length" : "return Object.getOwnPropertySymbols(input).length";
    const original = surface === "replay" ? await run(source, { bindings: { input } }) : undefined;
    const snapshot = original === undefined ? undefined : restore(JSON.parse(await dump(original)), { source });
    const outcome = await Promise.resolve().then(() => surface === "rebind"
      ? wrapCallerInjectedBindings({ input: deepCopyToSandbox(input) }, { budget, promiseReplacements: new WeakMap() })
      : run(source, { budget, snapshot, bindings: surface === "replay" ? undefined : surface === "host" ? { load: () => ({ input }) } : { input } })
    ).then(value => ({ value }), error => ({ error }));
    if (length === 129) expect(outcome, `${surface} ${target}`).toMatchObject({ error: { code: "budgetExceeded", budget: "stringLength" } });
    else expect(outcome).not.toHaveProperty("error");
  }
});

it("charges admitted symbol data and rolls back a rejected host outcome", () => {
  const key = Symbol("payload");
  const input = Promise.resolve(7);
  Object.defineProperty(input, key, { value: Array.from({ length: 32 }, () => ({ count: 1 })) });
  admitNativePromiseProperties(input, [key]);
  const value = deepCopyToSandbox({ input });
  const size = measureSandboxData([value], { ignoreClosures: true });
  const budget = new Budget({ dataSize: size });
  const journal = new HostCallJournal("source", [], undefined, undefined, budget);
  const record = journal.issue({ moduleId: "host", operation: "load", argumentDigest: "args", policy: "re-issue" }).record;
  const before = budget.currentDataSize;
  expect(() => journal.settle(record, { status: "fulfilled", value })).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" }));
  expect(budget.currentDataSize).toBe(before);
  expect(record.lifecycle).toBe("created");
  expect(record.outcome).toBeUndefined();
  const acceptedBudget = new Budget();
  const acceptedJournal = new HostCallJournal("source", [], undefined, undefined, acceptedBudget);
  const accepted = acceptedJournal.issue({ moduleId: "host", operation: "load", argumentDigest: "args", policy: "re-issue" }).record;
  const baseline = acceptedBudget.currentDataSize;
  acceptedJournal.settle(accepted, { status: "fulfilled", value });
  expect(acceptedBudget.currentDataSize - baseline).toBeGreaterThanOrEqual(size);
});
