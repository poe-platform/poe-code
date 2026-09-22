import { expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";
import { Scope } from "./interp/scope.js";
import { measureSandboxData } from "./interp/values.js";
import { hasImmutableEmptyModuleEnvironment } from "./modules/empty-environment.js";

it("shares immutable empty namespace projections for source captures and preserves live object mutations", async () => {
  const original = Scope.prototype.retainedDataRoots;
  const scopes = new Set<Scope>();
  Scope.prototype.retainedDataRoots = function () {
    scopes.add(this);
    return original.call(this);
  };
  const budget = new Budget({ dataSize: 200000 });
  const realm = createRealm({
    classicScripts: true,
    budget,
    sourceResolver: () => ({
      id: "https://fixture.example/dep.js",
      source: 'export const record={text:"first"};export function update(text){record.text=text}'
    })
  });
  try {
    expect(
      await realm.evaluate(
        'import {record,update} from "dep";globalThis.update=update;export const text=record.text',
        { sourceType: "module" }
      )
    ).toMatchObject({ ok: true, returnValue: { text: "first" } });
    Scope.prototype.retainedDataRoots = original;
    const captured = [...scopes].filter(
      (scope) => scope.moduleId === "https://fixture.example/dep.js"
    );
    expect(captured.length).toBeGreaterThan(0);
    const held = captured.map((scope) => ({
      scope,
      roots: scope.retainedDataRoots()
    }));
    for (const { scope, roots } of held) {
      expect(hasImmutableEmptyModuleEnvironment(scope.moduleEnvironment!)).toBe(true);
      expect(Object.isFrozen(scope.moduleEnvironment!.namespaces)).toBe(true);
      expect(scope.retainedDataRoots()[0]).toBe(roots[0]);
    }
    const before = held.map(({ roots }) => measureSandboxData(roots));
    expect(await realm.evaluate('update("a much longer replacement");')).toMatchObject({
      ok: true
    });
    held.forEach(({ scope, roots }, index) => {
      expect(measureSandboxData(roots)).toBeGreaterThan(before[index]!);
      expect(measureSandboxData(roots)).toBe(measureSandboxData(scope.retainedDataRoots()));
    });
  } finally {
    Scope.prototype.retainedDataRoots = original;
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("retains independently loaded namespaces after an immutable classic environment admits an import", async () => {
  const budget = new Budget({ dataSize: 100000 });
  const realm = createRealm({
    classicScripts: true,
    budget,
    sourceResolver: () => ({
      id: "dep",
      source: 'export const record={text:"x".repeat(20000)}'
    })
  });
  try {
    expect(
      await realm.evaluate(
        'globalThis.load=async()=>{const ns=await import("dep");return ns.record.text.length;};'
      )
    ).toMatchObject({ ok: true });
    const result = await realm.evaluate("load();");
    expect(result.ok).toBe(true);
    if (result.ok) await expect(result.returnValue).resolves.toBe(20000);
    expect(budget.currentDataSize).toBeGreaterThanOrEqual(20000);
    expect(realm.sourceModuleStatus()).toMatchObject({
      preparedModules: 1,
      pendingImports: 0,
      fulfilledImports: 1
    });
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("keeps a caught imported allocation limit fatal with immutable empty namespaces", async () => {
  const budget = new Budget({ dataSize: 10000, stringLength: 100000 });
  const realm = createRealm({
    budget,
    sourceResolver: () => ({
      id: "dep",
      source: 'try {const record={text:"x".repeat(20000)}} catch {} export const survived=true'
    })
  });
  try {
    await expect(
      realm.evaluate('import "dep";export const survived=true', {
        sourceType: "module"
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("counts suspended imported callback locals together with later source-module allocations", async () => {
  let finish!: () => void;
  const tail = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let callback: unknown;
  const budget = new Budget({ dataSize: 50000 });
  const realm = createRealm({
    budget,
    callbackScheduling: "after-prefix",
    bindings: {
      save: (value: unknown) => {
        callback = value;
      },
      wait: () => tail
    },
    sourceResolver: (specifier) => ({
      id: specifier,
      source:
        specifier === "callback"
          ? 'export async function run(){const local={text:"x".repeat(30000)};await wait();return local}'
          : 'export const record={text:"y".repeat(30000)}'
    })
  });
  try {
    expect(
      await realm.evaluate('import {run} from "callback";save(run)', {
        sourceType: "module"
      })
    ).toMatchObject({ ok: true });
    const invocation = realm.startCallback(callback);
    const outcome = invocation.result.then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );
    await invocation.synchronous;
    expect(budget.currentDataSize).toBeGreaterThanOrEqual(30000);
    await expect(
      realm.evaluate('import "allocation";', {
        sourceType: "module",
        filename: "allocation-entry"
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await outcome).toMatchObject({ rejected: true });
  } finally {
    finish();
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("preserves registered module namespaces alongside source imports", async () => {
  const budget = new Budget({ dataSize: 100000 });
  const realm = createRealm({
    budget,
    modules: { cap: { record: { text: "registered" } } },
    sourceResolver: () => ({
      id: "dep",
      source:
        'import {record} from "cap";record.text="x".repeat(20000);export function read(){return record.text.length}'
    })
  });
  try {
    expect(
      await realm.evaluate('import {read} from "dep";export const size=read()', {
        sourceType: "module"
      })
    ).toMatchObject({ ok: true, returnValue: { size: 20000 } });
    expect(budget.currentDataSize).toBeGreaterThanOrEqual(20000);
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});
