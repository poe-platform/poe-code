import { afterEach, expect, it, vi } from "vitest";
import { Budget, createRealm } from "./core.js";
import { run } from "./run.js";

const dictionary = `{${Array.from(
  { length: 256 },
  (_, index) => `entry${index}:"translation"`
).join(",")}}`;

afterEach(() => vi.restoreAllMocks());

it("does not rescan a bulk classic string dictionary at later checkpoints", async () => {
  const realm = createRealm({ classicScripts: true });
  try {
    expect(await realm.evaluate(`var dictionary=${dictionary};`)).toMatchObject({ ok: true });
    const reads = vi.spyOn(Object, "getOwnPropertyDescriptor");
    expect(
      await realm.evaluate("var result=0; for(var i=0;i<8;i++) result++; result;")
    ).toMatchObject({
      ok: true,
      returnValue: 8
    });
    expect(reads.mock.calls.filter(([, key]) => key === "entry0")).toHaveLength(0);
  } finally {
    await realm.close();
  }
});

it("preserves dictionary aliases, mutation, accessors, cycles and export", async () => {
  const realm = createRealm({ classicScripts: true });
  try {
    expect(
      await realm.evaluate(`var dictionary=${dictionary}; var alias=dictionary;`)
    ).toMatchObject({ ok: true });
    expect(
      await realm.evaluate(`
      dictionary.entry0="changed";
      delete dictionary.entry1;
      dictionary.child={text:"small"}; dictionary.child.text="grown";
      Object.defineProperty(dictionary,"getter",{get(){return "read"},enumerable:true});
      dictionary.self=dictionary;
      [alias===dictionary,alias.entry0,"entry1" in alias,alias.child.text,alias.getter,
        alias.self===dictionary,Object.getPrototypeOf(alias)===Object.prototype];
    `)
    ).toMatchObject({
      ok: true,
      returnValue: [true, "changed", false, "grown", "read", true, true]
    });
    expect(
      await realm.evaluate("delete dictionary.self; delete dictionary.getter; dictionary.child;")
    ).toMatchObject({
      ok: true,
      returnValue: { text: "grown" }
    });
  } finally {
    await realm.close();
  }
});

it("rejects growth of a warmed classic dictionary under its retained data quota", async () => {
  class ObservedBudget extends Budget {
    captured?: object;
    override visitNode(units = 1): void {
      super.visitNode(units);
      if (this.captured !== undefined) return;
      for (const value of this.retainedValues()) {
        if (typeof value === "object" && value !== null && Object.hasOwn(value, "entry0")) {
          this.captured = value;
          break;
        }
      }
    }
  }
  const budget = new ObservedBudget({ dataSize: 100000 });
  const realm = createRealm({ classicScripts: true, budget });
  try {
    expect(await realm.evaluate(`var dictionary=${dictionary}; dictionary.entry0;`)).toMatchObject({
      ok: true
    });
    // A trusted SDK observer can retain the builder before construction finishes.
    // Later native writes must affect the same guest identity and its warmed charge.
    if (budget.captured === undefined) throw new Error("Expected retained dictionary builder");
    Object.defineProperty(budget.captured, "entry0", { value: "native" });
    expect(await realm.evaluate("dictionary.entry0;")).toMatchObject({
      ok: true,
      returnValue: "native"
    });
    Object.defineProperty(budget.captured, "entry0", { value: "x".repeat(100000) });
    await expect(realm.evaluate("0;")).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("keeps public default runner dictionary results natively cloneable", async () => {
  const result = await run(`return ${dictionary};`);
  if (!result.ok) throw new Error("Expected successful dictionary execution");
  expect(structuredClone(result.returnValue)).toMatchObject({
    entry0: "translation",
    entry255: "translation"
  });
});
