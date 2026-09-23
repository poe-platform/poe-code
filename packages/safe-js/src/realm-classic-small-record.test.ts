import { expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension } from "./core.js";
import { reconcileCompiledValues } from "./interp/values.js";
import { run } from "./run.js";

it("does not recapture warmed small classic data records", async () => {
  const realm = createRealm({ classicScripts: true });
  try {
    expect(await realm.evaluate('var record={entry0:"small",child:{text:"child"}};')).toMatchObject(
      { ok: true }
    );
    const read = vi.spyOn(Object, "getOwnPropertyDescriptor");
    let result: unknown, captures: number;
    try {
      result = await realm.evaluate("var result=0;for(var i=0;i<8;i++)result++;result;");
      captures = read.mock.calls.filter(([, key]) => key === "entry0" || key === "text").length;
    } finally {
      read.mockRestore();
    }
    expect(result).toMatchObject({ ok: true, returnValue: 8 });
    expect(captures).toBe(0);
  } finally {
    await realm.close();
  }
});

it("preserves classic aliases, descendants, prototype changes and cycles", async () => {
  const realm = createRealm({ classicScripts: true });
  try {
    expect(
      await realm.evaluate('var child={text:"small"};var record={child};var alias=record;')
    ).toMatchObject({ ok: true });
    expect(
      await realm.evaluate(`record.self=record;child.text="grown";
      Object.setPrototypeOf(record,{prototypeValue:7});
      Object.defineProperty(record,"getter",{get(){return child.text},enumerable:true,configurable:true});
      [record===alias,record.child===child,record.self===record,record.getter==="grown",record.prototypeValue===7];`)
    ).toMatchObject({ ok: true, returnValue: [true, true, true, true, true] });
    expect(
      await realm.evaluate(
        "delete record.self;delete record.getter;JSON.parse(JSON.stringify(record));"
      )
    ).toMatchObject({ ok: true, returnValue: { child: { text: "grown" } } });
  } finally {
    await realm.close();
  }
});

it("copies small classic records through host calls as native cloneable data", async () => {
  let cloned: unknown;
  const extension = defineExtension({
    manifest: { version: 1, name: "record-echo", globals: ["echo"] },
    setup() {
      return {
        globals: {
          echo(value: unknown) {
            cloned = structuredClone(value);
            return cloned;
          }
        }
      };
    }
  });
  const realm = createRealm({ classicScripts: true, extensions: [extension] });
  try {
    expect(
      await realm.evaluate(`var child={text:"small"};var record={first:child,second:child};record.self=record;
      var copied=echo(record);[copied.first===copied.second,copied.self===copied,copied.first.text==="small"];`)
    ).toMatchObject({ ok: true, returnValue: [true, true, true] });
    expect(structuredClone(cloned)).toMatchObject({
      first: { text: "small" },
      second: { text: "small" }
    });
  } finally {
    await realm.close();
  }
});

it("keeps guest structuredClone and exported ordinary records compatible", async () => {
  const realm = createRealm({ classicScripts: true });
  try {
    const result = await realm.evaluate(
      'var record={child:{text:"small"}};structuredClone(record);'
    );
    expect(result).toMatchObject({ ok: true, returnValue: { child: { text: "small" } } });
    if (!result.ok) throw new Error("Expected successful clone");
    expect(structuredClone(result.returnValue)).toEqual({ child: { text: "small" } });
  } finally {
    await realm.close();
  }
});

it.each([
  { held: false, descendant: false },
  { held: true, descendant: false },
  { held: false, descendant: true },
  { held: true, descendant: true }
])(
  "rejects native record growth after warming (held=$held, descendant=$descendant)",
  async ({ held, descendant }) => {
    class Observed extends Budget {
      captured?: Record<string, unknown>;
      override visitNode(units = 1): void {
        super.visitNode(units);
        if (this.captured !== undefined) return;
        for (const value of this.retainedValues())
          if (value && typeof value === "object" && Object.hasOwn(value, "entry0")) {
            this.captured = value as Record<string, unknown>;
            break;
          }
      }
    }
    const budget = new Observed({ dataSize: 50000 });
    const realm = createRealm({ classicScripts: true, budget });
    try {
      expect(
        await realm.evaluate('var record={entry0:"small",child:{text:"small"}};record.entry0;')
      ).toMatchObject({ ok: true });
      if (budget.captured === undefined) throw new Error("Missing retained record");
      const release = held ? budget.deferReconciliation() : undefined;
      try {
        if (descendant) (budget.captured.child as { text: string }).text = "x".repeat(50001);
        else Object.defineProperty(budget.captured, "entry0", { value: "x".repeat(50001) });
        await expect(realm.evaluate("0;")).rejects.toMatchObject({
          code: "budgetExceeded",
          budget: "dataSize"
        });
      } finally {
        release?.();
      }
    } finally {
      await realm.close();
    }
    // A hold keeps the historical floor until a fresh graph supplies usage.
    if (held) reconcileCompiledValues(budget, []);
    expect(budget.currentDataSize).toBe(0);
  }
);

it("keeps default runner small-record results natively cloneable", async () => {
  const result = await run('return {entry0:"small",child:{text:"small"}};');
  if (!result.ok) throw new Error("Expected successful runner result");
  expect(structuredClone(result.returnValue)).toEqual({
    entry0: "small",
    child: { text: "small" }
  });
});
